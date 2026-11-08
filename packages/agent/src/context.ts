// Context management: what each model call is sent, kept inside the model's context window.
//
//   - The request's size is estimated (characters / 4), then corrected by the input token
//     counts the server reports for what was actually sent (`ContextMeter`).
//   - At 80% of the usable window (the window minus room for the reply), the older part of the
//     conversation is summarized (the agent loop calls the model; `compactionCut` says where to
//     cut, `transcriptChunks` what to send). Recent messages stay word for word.
//   - If a request is still too big after that, the oldest tool results are shortened for that
//     call only (`shrinkToolResults`); the saved chat keeps them.
// Tool output and saved memories are also capped relative to the window (`contextLimits`).
import type { ModelMessage } from './memory/short-term.js';
import type { ToolDefinition } from './tools/define.js';

/** Summarize older messages once a request reaches this share of the usable window. */
export const COMPACT_AT = 0.8;
/** Past this share (after summarizing), the oldest tool results are shortened for the call. */
export const HARD_LIMIT = 0.95;
/** The newest messages kept word for word when summarizing: this share of the usable window. */
const KEEP_RECENT = 0.25;
/** One summarizing call reads at most this share of the usable window of transcript. */
const SUMMARY_CHUNK = 0.5;

const CHARS_PER_TOKEN = 4;
/** Roles, separators and the like that every message adds. */
const MESSAGE_OVERHEAD = 4;
/** What an attached image roughly costs (it depends on its size and the model). */
export const IMAGE_TOKENS = 1_500;

export function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function messageTokens(message: ModelMessage): number {
  let tokens = MESSAGE_OVERHEAD + textTokens(message.content ?? '');
  if (message.role === 'assistant') {
    for (const call of message.tool_calls ?? []) {
      tokens += MESSAGE_OVERHEAD + textTokens(call.function.name + call.function.arguments);
    }
  }
  if (message.role === 'user') tokens += (message.images?.length ?? 0) * IMAGE_TOKENS;
  return tokens;
}

/** The window, the room kept for the reply, and what's left for the request. */
export interface ContextBudget {
  window: number;
  reserve: number;
  usable: number;
}

/**
 * The reply's room is the model's max output when set (at most half the window), otherwise a
 * tenth of the window.
 */
export function contextBudget(window: number, maxOutputTokens: number | null): ContextBudget {
  const reserve = Math.min(maxOutputTokens ?? Math.round(window * 0.1), Math.round(window / 2));
  return { window, reserve, usable: window - reserve };
}

/** Caps relative to the window, so a small local model isn't flooded by one tool result. */
export function contextLimits({ usable }: ContextBudget): {
  toolOutputChars: number;
  memoryChars: number;
} {
  const chars = usable * CHARS_PER_TOKEN;
  return {
    toolOutputChars: Math.max(2_000, Math.min(20_000, Math.floor(chars * 0.15))),
    memoryChars: Math.max(1_000, Math.min(6_000, Math.floor(chars * 0.05))),
  };
}

export interface RequestSize {
  /** the plain estimate */
  raw: number;
  /** corrected by what the server reported for earlier calls */
  tokens: number;
}

/** Estimates a request's size, learning from the server's own counts as calls are made. */
export class ContextMeter {
  #ratio = 1;

  estimate(system: string, tools: readonly ToolDefinition[], messages: readonly ModelMessage[]) {
    const raw =
      textTokens(system) +
      (tools.length ? textTokens(JSON.stringify(tools)) : 0) +
      messages.reduce((sum, message) => sum + messageTokens(message), 0);
    return { raw, tokens: Math.ceil(raw * this.#ratio) };
  }

  /** The tokens the server counted for a request estimated at `raw`. */
  calibrate(raw: number, actualInputTokens: number): void {
    // Tiny counts are a server (or a test) not reporting usage properly: ignore them.
    if (raw < 100 || actualInputTokens < 100) return;
    this.#ratio = Math.min(3, Math.max(0.5, actualInputTokens / raw));
  }

  /** Corrected tokens back to the plain estimate's units. */
  toRaw(tokens: number): number {
    return Math.ceil(tokens / this.#ratio);
  }
}

/**
 * Where to cut the model's view for a summary: messages from the cut on (at most `keepTokens`)
 * stay word for word, the ones before are summarized. A kept part never starts with a tool
 * result, which must follow its call. `messages.length` keeps nothing; null when there's
 * nothing worth summarizing.
 */
export function compactionCut(
  messages: readonly ModelMessage[],
  keepTokens: number,
): number | null {
  let kept = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 1; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    kept += messageTokens(message);
    if (kept > keepTokens) break;
    if (message.role !== 'tool') cut = i;
  }
  // Summarizing a single message (often just the earlier summary) frees too little.
  return cut >= 2 ? cut : null;
}

/** The share of the usable window kept word for word when summarizing. */
export function keepRecentTokens({ usable }: ContextBudget): number {
  return Math.floor(usable * KEEP_RECENT);
}

/**
 * Messages as plain text for the summarizing call, split so each part fits one call. Long tool
 * results and arguments are cut: the summary needs what they showed, not every line.
 */
export function transcriptChunks(
  messages: readonly ModelMessage[],
  { usable }: ContextBudget,
): string[] {
  const perItem = Math.max(500, Math.min(4_000, Math.floor(usable * CHARS_PER_TOKEN * 0.05)));
  const cut = (text: string) =>
    text.length > perItem
      ? `${text.slice(0, perItem)}… [${text.length - perItem} more characters]`
      : text;
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      lines.push(`User: ${cut(message.content)}`);
      if (message.images?.length)
        lines.push(`(The user's message had ${message.images.length} image(s).)`);
    } else if (message.role === 'assistant') {
      if (message.content) lines.push(`Agent: ${cut(message.content)}`);
      for (const call of message.tool_calls ?? []) {
        lines.push(`Agent called ${call.function.name}: ${cut(call.function.arguments)}`);
      }
    } else {
      lines.push(`Tool result: ${cut(message.content)}`);
    }
  }

  const maxChars = Math.max(4_000, Math.floor(usable * SUMMARY_CHUNK * CHARS_PER_TOKEN));
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 2 > maxChars) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${line}` : line.slice(0, maxChars);
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * The view with the oldest tool results shortened until about `overBy` (plain-estimate) tokens
 * are freed. The results of the latest tool calls are left alone: the model is working on them.
 */
export function shrinkToolResults(
  messages: readonly ModelMessage[],
  overBy: number,
): ModelMessage[] {
  let lastAssistant = -1;
  messages.forEach((message, i) => {
    if (message.role === 'assistant') lastAssistant = i;
  });
  let freed = 0;
  return messages.map((message, i) => {
    if (freed >= overBy || message.role !== 'tool' || i > lastAssistant) return message;
    const stub = `[This tool result (${message.content.length} characters) was left out to fit the model's context window. Run the tool again if you need it.]`;
    const saved = textTokens(message.content) - textTokens(stub);
    if (saved <= 0) return message;
    freed += saved;
    return { ...message, content: stub };
  });
}
