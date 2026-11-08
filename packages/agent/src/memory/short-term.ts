// Short-term memory: the conversation sent to the model on every call, in the
// OpenAI chat format. (The system prompt is added by llm.ts, not stored here.)
//
// It is append-only on purpose: many servers cache a repeated prompt prefix,
// and editing earlier turns throws that cache away. To start fresh, call reset().
// When a chat nears the model's context window, older messages are summarized
// (context.ts): the summary is appended as one more message (`summaryOf`), and
// forModel() sends it in place of the messages it covers. Nothing is deleted, so the
// chat still shows everything.
// Images reach the model as attachment ids on a user message (`images`); llm.ts turns them
// into image parts when it sends the request, so the saved chat stays small.
//
// The app saves each chat's conversation in the workspace folder
// (.nimbrio-ai/chats/<id>/messages.jsonl) and rebuilds it with fromRows() for the next request.

import type { Attachment } from '@app/shared';

/** One function call the model asked for, matched to its result by `id`. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type UserMessage = {
  role: 'user';
  content: string;
  /** Attachment ids of images the model should see with this message (view_image). */
  images?: string[];
};
export type AssistantMessage = { role: 'assistant'; content: string; tool_calls?: ToolCall[] };
export type ToolMessage = { role: 'tool'; tool_call_id: string; content: string };

/** A message exactly as it is sent to the model. */
export type ModelMessage = UserMessage | AssistantMessage | ToolMessage;

/**
 * A stored message (one line of a chat's messages.jsonl): the model message plus
 *   internal: written by the agent framework, not the user
 *   display: what the user actually typed, when `content` also carries context the agent added
 *   attachments: the files the user attached to it
 *   skills: the names of the skills the user picked for it
 *   summaryOf: on a summary (an internal user message): the messages before this index are the
 *     ones it stands in for
 *   steeredAt: on a message the user sent while the agent worked (steering): when they sent it
 */
export type ChatMessage = ModelMessage & {
  internal?: boolean;
  display?: string | null;
  attachments?: Attachment[];
  skills?: string[];
  summaryOf?: number;
  steeredAt?: string;
};

export interface AddUserOptions {
  internal?: boolean;
  display?: string;
  attachments?: readonly Attachment[];
  skills?: readonly string[];
  images?: readonly string[];
  /** sent while the agent worked (ISO time): read by the run under way, not a new request */
  steeredAt?: string;
}

export class Conversation {
  #messages: ModelMessage[] = [];
  #internal = new Set<number>(); // messages the agent added itself (checks, notes), hidden from the chat UI
  #display = new Map<number, string>(); // index -> what the user typed, when the agent added context around it
  #attachments = new Map<number, Attachment[]>(); // index -> files the user attached
  #skills = new Map<number, string[]>(); // index -> skills the user picked
  #summaries = new Map<number, number>(); // index of a summary -> the messages before this index it covers
  #steered = new Map<number, string>(); // index -> when the user sent it, for messages sent mid-run

  get messages(): ModelMessage[] {
    return this.#messages;
  }

  addUser(
    text: string,
    { internal = false, display, attachments, skills, images, steeredAt }: AddUserOptions = {},
  ): void {
    const index = this.#messages.length;
    if (internal) this.#internal.add(index);
    if (steeredAt !== undefined) this.#steered.set(index, steeredAt);
    if (display !== undefined) this.#display.set(index, display);
    if (attachments?.length) this.#attachments.set(index, [...attachments]);
    if (skills?.length) this.#skills.set(index, [...skills]);
    const message: UserMessage = { role: 'user', content: text };
    if (images?.length) message.images = [...images];
    this.#messages.push(message);
  }

  /**
   * Appends a summary of the messages before `upTo` (context compaction). From now on the
   * model gets it in their place; they stay stored and shown.
   */
  addSummary(text: string, upTo: number): void {
    const index = this.#messages.length;
    this.#internal.add(index);
    this.#summaries.set(index, upTo);
    this.#messages.push({ role: 'user', content: text });
  }

  /** The latest summary: where it is and the messages before `upTo` it covers. */
  latestSummary(): { index: number; upTo: number } | null {
    let latest: { index: number; upTo: number } | null = null;
    for (const [index, upTo] of this.#summaries) {
      if (!latest || index > latest.index) latest = { index, upTo };
    }
    return latest;
  }

  /**
   * What the model is sent: everything, or since a summary, the summary first, then the
   * messages it doesn't cover (in order, without older summaries). `indexes` maps each
   * message back to its place in `messages`.
   */
  forModel(): { messages: ModelMessage[]; indexes: number[] } {
    const summary = this.latestSummary();
    const all = this.#messages.map((_, i) => i);
    const indexes = summary
      ? [
          summary.index,
          ...all.filter((i) => i >= summary.upTo && i !== summary.index && !this.#summaries.has(i)),
        ]
      : all;
    return {
      messages: indexes.map((i) => this.#messages[i]).filter((m): m is ModelMessage => !!m),
      indexes,
    };
  }

  /** Whether the user attached files to any message of this conversation. */
  hasAttachments(): boolean {
    return this.#attachments.size > 0;
  }

  /** The files the user attached to message `index`. */
  attachmentsOf(index: number): Attachment[] {
    return this.#attachments.get(index) ?? [];
  }

  isInternal(index: number): boolean {
    return this.#internal.has(index);
  }

  /** The message text as the user sees it (without context the agent added). */
  displayText(index: number): string | undefined {
    return this.#display.get(index) ?? this.#messages[index]?.content;
  }

  /** The conversation as the user sees it: no internal messages, no added context. */
  visible(): ModelMessage[] {
    return this.#messages
      .map((m, i): ModelMessage => {
        const display = this.#display.get(i);
        return display === undefined ? m : { ...m, content: display };
      })
      .filter((_, i) => !this.#internal.has(i));
  }

  /**
   * Store the assistant turn, keeping its tool calls so later tool results can
   * refer to them. Only standard fields are kept: some servers reject extras
   * they returned themselves (e.g. `reasoning_content`).
   */
  addAssistant(message: { content?: string | null; tool_calls?: ToolCall[] | null }): void {
    const turn: AssistantMessage = { role: 'assistant', content: message.content ?? '' };
    if (message.tool_calls?.length) turn.tool_calls = message.tool_calls;
    this.#messages.push(turn);
  }

  /** One `tool` message per call, each matched to its call by tool_call_id. */
  addToolResult(toolCallId: string, content: string): void {
    this.#messages.push({ role: 'tool', tool_call_id: toolCallId, content });
  }

  /** Rebuild a saved conversation from rows of the messages table (see rows()). */
  static fromRows(rows: readonly ChatMessage[]): Conversation {
    const conversation = new Conversation();
    for (const r of rows) {
      if (r.role === 'user' && r.summaryOf !== undefined) {
        conversation.addSummary(r.content, r.summaryOf);
      } else if (r.role === 'user') {
        conversation.addUser(r.content, {
          internal: r.internal,
          display: r.display ?? undefined,
          attachments: r.attachments,
          skills: r.skills,
          images: r.images,
          steeredAt: r.steeredAt,
        });
      } else if (r.role === 'assistant') {
        conversation.addAssistant({ content: r.content, tool_calls: r.tool_calls });
      } else if (r.role === 'tool') {
        conversation.addToolResult(r.tool_call_id, r.content);
      }
    }
    return conversation;
  }

  /** Messages from index `from` on, with their flags, ready to save. */
  rows(from = 0): ChatMessage[] {
    return this.#messages.slice(from).map((m, i) => {
      const attachments = this.#attachments.get(from + i);
      const skills = this.#skills.get(from + i);
      const summaryOf = this.#summaries.get(from + i);
      const steeredAt = this.#steered.get(from + i);
      return {
        ...m,
        internal: this.#internal.has(from + i),
        display: this.#display.get(from + i) ?? null,
        ...(attachments ? { attachments } : {}),
        ...(skills ? { skills } : {}),
        ...(summaryOf !== undefined ? { summaryOf } : {}),
        ...(steeredAt !== undefined ? { steeredAt } : {}),
      };
    });
  }

  reset(): void {
    this.#messages = [];
    this.#internal.clear();
    this.#display.clear();
    this.#attachments.clear();
    this.#skills.clear();
    this.#summaries.clear();
    this.#steered.clear();
  }
}
