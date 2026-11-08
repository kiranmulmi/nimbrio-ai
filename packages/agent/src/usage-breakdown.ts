// What a model call's tokens went to, for the token usage breakdown. The server reports only
// totals, so each part is counted from the text sent (the same estimate the context meter
// uses) and scaled so the parts add up to the reported total.

import type { TokenGroup, TokenGroupId } from '@app/shared';
import { IMAGE_TOKENS, textTokens } from './context.js';
import type { ModelReply } from './llm.js';
import type { ModelMessage } from './memory/short-term.js';
import type { PromptSection } from './prompt.js';
import type { ToolDefinition } from './tools/define.js';

/** How a message of a step's request came about (by position in the messages sent). */
export interface MessageInfo {
  /** written by the agent itself (a plan check, a note), not the user */
  isInternal: boolean;
  /** what the user typed, when the message also carries context the app added */
  display: string | undefined;
  /** the summary standing in for older messages */
  isSummary: boolean;
}

/** What a step's request is made of, beyond what the request itself says. */
export interface StepParts {
  sections: readonly PromptSection[];
  /** one per message sent, in order */
  infos: readonly MessageInfo[];
}

/** Roles, separators and the like that each message or tool call adds (as context.ts). */
const OVERHEAD = 4;
/** Items listed per group; the rest are summed as "Others". */
const MAX_ITEMS = 8;
const LABEL_CHARS = 80;

/** Tokens added up by group, then item. */
class Tally {
  readonly #groups = new Map<TokenGroupId, Map<string, { tokens: number; count: number }>>();

  add(group: TokenGroupId, label: string, tokens: number, count = 1): void {
    if (tokens <= 0) return;
    const items = this.#groups.get(group) ?? new Map<string, { tokens: number; count: number }>();
    this.#groups.set(group, items);
    const item = items.get(label) ?? { tokens: 0, count: 0 };
    item.tokens += tokens;
    item.count += count;
    items.set(label, item);
  }

  get raw(): number {
    let sum = 0;
    for (const items of this.#groups.values()) {
      for (const item of items.values()) sum += item.tokens;
    }
    return sum;
  }

  /** The groups, largest first, each item scaled by `scale`. */
  groups(scale: number): TokenGroup[] {
    return [...this.#groups]
      .map(([id, items]) => {
        const sorted = [...items]
          .map(([label, item]) => ({
            label,
            tokens: Math.round(item.tokens * scale),
            count: item.count,
          }))
          .sort((a, b) => b.tokens - a.tokens);
        const listed = sorted.length > MAX_ITEMS ? sorted.slice(0, MAX_ITEMS - 1) : sorted;
        const rest = sorted.slice(listed.length);
        if (rest.length) {
          listed.push({
            label: 'Others',
            tokens: rest.reduce((sum, item) => sum + item.tokens, 0),
            count: rest.reduce((sum, item) => sum + item.count, 0),
          });
        }
        return { id, tokens: sorted.reduce((sum, item) => sum + item.tokens, 0), items: listed };
      })
      .filter((group) => group.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
  }
}

function oneLine(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 1)}…` : line;
}

/** "read_file: src/app.ts": the tool and its first text argument (a path, command, URL...). */
function callLabel(name: string, args: string): string {
  let detail = '';
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed === 'object' && parsed !== null) {
      const first = Object.values(parsed).find(
        (value): value is string => typeof value === 'string' && value.trim() !== '',
      );
      detail = first ? oneLine(first) : '';
    }
  } catch {
    // Arguments that aren't JSON: the tool name alone.
  }
  return detail ? `${name}: ${detail}` : name;
}

/**
 * What a request's input went to. `step` (a step of the agent loop) names the system prompt's
 * sections and tells the user's messages from what the app added; any other call's own
 * instructions and prompt count as one part each.
 */
export function inputBreakdown(
  request: { system: string; messages: readonly ModelMessage[]; tools?: readonly ToolDefinition[] },
  inputTokens: number,
  step?: StepParts,
): TokenGroup[] {
  const tally = new Tally();
  if (step) {
    for (const section of step.sections)
      tally.add('system', section.label, textTokens(section.text));
  } else {
    tally.add('system', 'Instructions for this call', textTokens(request.system));
  }
  for (const tool of request.tools ?? []) {
    tally.add('tools', tool.function.name, textTokens(JSON.stringify(tool)));
  }

  const calls = new Map<string, string>();
  request.messages.forEach((message, index) => {
    const info = step?.infos[index];
    if (message.role === 'assistant') {
      tally.add('history', 'Reply text and notes', textTokens(message.content ?? '') + OVERHEAD);
      for (const call of message.tool_calls ?? []) {
        const label = callLabel(call.function.name, call.function.arguments);
        calls.set(call.id, label);
        tally.add(
          'history',
          `Tool call: ${call.function.name}`,
          OVERHEAD + textTokens(call.function.name + call.function.arguments),
        );
      }
      return;
    }
    if (message.role === 'tool') {
      tally.add(
        'results',
        calls.get(message.tool_call_id) ?? 'Tool result',
        textTokens(message.content) + OVERHEAD,
      );
      return;
    }
    const tokens = textTokens(message.content) + OVERHEAD;
    const images = message.images?.length ?? 0;
    if (images) tally.add('images', 'Images', images * IMAGE_TOKENS, images);
    if (!info) {
      tally.add('prompt', 'Prompt for this call', tokens);
    } else if (info.isSummary) {
      tally.add('summary', 'Summary of earlier messages', tokens);
    } else if (info.isInternal) {
      tally.add('context', `Agent note: ${oneLine(message.content)}`, tokens);
    } else if (info.display !== undefined && info.display !== message.content) {
      const typed = textTokens(info.display) + OVERHEAD;
      const label = oneLine(info.display) || '(files only)';
      tally.add('user', label, typed);
      tally.add('context', `Added to “${oneLine(label)}”`, Math.max(0, tokens - typed));
    } else {
      tally.add('user', oneLine(message.content) || '(files only)', tokens);
    }
  });

  const raw = tally.raw;
  return tally.groups(inputTokens > 0 && raw > 0 ? inputTokens / raw : 1);
}

/**
 * What a response's output went to: its text and tool calls, counted the same way. Whatever
 * the server counted beyond them is reasoning and formatting the response doesn't show.
 */
export function outputBreakdown(message: ModelReply, outputTokens: number): TokenGroup[] {
  const tally = new Tally();
  tally.add('reply', 'Reply text', textTokens(message.content ?? ''));
  for (const call of message.tool_calls ?? []) {
    tally.add(
      'tool_calls',
      callLabel(call.function.name, call.function.arguments),
      OVERHEAD + textTokens(call.function.arguments),
    );
  }
  const raw = tally.raw;
  if (outputTokens > raw) {
    tally.add('reasoning', 'Reasoning and formatting', outputTokens - raw);
    return tally.groups(1);
  }
  return tally.groups(outputTokens > 0 && raw > 0 ? outputTokens / raw : 1);
}
