import type { ModelCallKind, TokenGroup, TokenGroupId, TokenItem, Usage } from '@app/shared';
import { shorten } from '../../lib/format';
import type { Turn, TurnUsage } from './conversation';

/** One reply's tokens, labelled with the message that asked for it. */
export type MessageUsage = TurnUsage & {
  /** the agent turn's key */
  key: string;
  /** the user's message the reply answers (its first line), or a stand-in */
  label: string;
  finishedAt: string | null;
};

/** A usage split into the bar's parts: input read from the cache, the rest, and output. */
export type UsageParts = {
  cached: number;
  freshInput: number;
  output: number;
  total: number;
};

export const CALL_KIND_LABELS: Record<ModelCallKind, string> = {
  step: 'Step',
  planner: 'Planning',
  compaction: 'Summarizing earlier messages',
  limit_summary: 'Summary at the limit',
};

export const TOKEN_GROUP_LABELS: Record<TokenGroupId, string> = {
  system: 'System prompt',
  tools: 'Tool definitions',
  summary: 'Summary of earlier messages',
  user: 'Your messages',
  context: 'Context the app added',
  history: "Agent's earlier replies and tool calls",
  results: 'Tool results',
  images: 'Images',
  prompt: 'Prompt for this call',
  reply: 'Reply text',
  tool_calls: 'Tool calls',
  reasoning: 'Reasoning and formatting',
};

/** Items listed per group when adding breakdowns up; the rest are summed as "Others". */
const MAX_ITEMS = 12;

/**
 * Several calls' breakdowns added up, group by group and item by item (a tool result re-sent
 * on every later step adds up to what it cost in all), largest first.
 */
export function mergeGroups(breakdowns: readonly (readonly TokenGroup[])[]): TokenGroup[] {
  const groups = new Map<TokenGroupId, Map<string, TokenItem>>();
  for (const breakdown of breakdowns) {
    for (const group of breakdown) {
      const items = groups.get(group.id) ?? new Map<string, TokenItem>();
      groups.set(group.id, items);
      for (const item of group.items) {
        const sum = items.get(item.label) ?? { label: item.label, tokens: 0, count: 0 };
        items.set(item.label, {
          label: item.label,
          tokens: sum.tokens + item.tokens,
          count: sum.count + item.count,
        });
      }
    }
  }
  return [...groups]
    .map(([id, items]): TokenGroup => {
      const all = [...items.values()];
      const others = all.filter((item) => item.label === 'Others');
      const sorted = all
        .filter((item) => item.label !== 'Others')
        .sort((a, b) => b.tokens - a.tokens);
      const listed = sorted.slice(0, MAX_ITEMS);
      const rest = [...sorted.slice(MAX_ITEMS), ...others];
      if (rest.length) {
        listed.push({
          label: 'Others',
          tokens: rest.reduce((sum, item) => sum + item.tokens, 0),
          count: rest.reduce((sum, item) => sum + item.count, 0),
        });
      }
      return { id, tokens: all.reduce((sum, item) => sum + item.tokens, 0), items: listed };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

export function usageParts(usage: Usage): UsageParts {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return {
    cached,
    freshInput: usage.inputTokens - cached,
    output: usage.outputTokens,
    total: usage.inputTokens + usage.outputTokens,
  };
}

/** Adds usages up, cache counts included. */
export function sumUsage(usages: readonly Usage[]): Usage {
  return usages.reduce<Usage>(
    (sum, usage) => ({
      inputTokens: sum.inputTokens + usage.inputTokens,
      outputTokens: sum.outputTokens + usage.outputTokens,
      cachedInputTokens: (sum.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
      cacheWriteTokens: (sum.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 },
  );
}

/**
 * Each finished reply in the chat with its tokens, oldest first, labelled with the message it
 * answers: the user turn before it. A message sent mid-run (steering) joins that run's reply,
 * so the label is the message that started the run.
 */
export function messageUsages(turns: readonly Turn[]): MessageUsage[] {
  const rows: MessageUsage[] = [];
  let asked: string | null = null;
  for (const turn of turns) {
    if (turn.role === 'user') {
      if (!turn.isSteer) asked = turn.text;
      continue;
    }
    if (!turn.usage) continue;
    rows.push({
      ...turn.usage,
      key: turn.key,
      label: messageLabel(asked),
      finishedAt: turn.finishedAt,
    });
  }
  return rows;
}

function messageLabel(text: string | null): string {
  const line = text?.trim().split('\n')[0]?.trim() ?? '';
  return line ? shorten(line, 120) : '(files only)';
}

/** "850 ms", "4.2 s", "1 min 5 s". */
export function callDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${whole % 60} s`;
}
