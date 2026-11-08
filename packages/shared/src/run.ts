import { z } from 'zod';
import { ATTACHMENT_LIMITS } from './attachment.js';
import type { ChatSummary } from './chat.js';
import { REASONING_EFFORTS } from './model.js';
import { SKILL_LIMITS, skillNameSchema } from './skill.js';
import type { NumberedPlanStep, Plan } from './plan.js';

export const RUN_STATUSES = [
  'done',
  'rejected',
  'refused',
  'truncated',
  'budget_exceeded',
  'stopped',
  'error',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface Usage {
  /** All input the model read, cached or not. */
  inputTokens: number;
  outputTokens: number;
  /** Of the input: read from the server's prompt cache (billed far lower). */
  cachedInputTokens?: number;
  /** Of the input: written to the prompt cache (a new chat's start; billed a little higher). */
  cacheWriteTokens?: number;
}

/**
 * What a model call was for: a step of the agent loop, the planner deciding whether to plan,
 * summarizing older messages to fit the context window, or the summary written at a limit.
 */
export const MODEL_CALL_KINDS = ['step', 'planner', 'compaction', 'limit_summary'] as const;

export type ModelCallKind = (typeof MODEL_CALL_KINDS)[number];

/**
 * The parts a model call's tokens went to. Input: the system prompt's sections, the tool
 * definitions, a summary of older messages, the user's messages, context the app added to
 * them (memories, files, notes), the agent's earlier replies and tool calls, tool results,
 * images, and (for a call that isn't a step) its own prompt. Output: reply text, tool calls,
 * and the rest (reasoning and formatting the response doesn't show).
 */
export const TOKEN_GROUPS = [
  'system',
  'tools',
  'summary',
  'user',
  'context',
  'history',
  'results',
  'images',
  'prompt',
  'reply',
  'tool_calls',
  'reasoning',
] as const;

export type TokenGroupId = (typeof TOKEN_GROUPS)[number];

/** One thing inside a group, e.g. one tool's definition or one tool call's result. */
export interface TokenItem {
  label: string;
  tokens: number;
  /** how many of it were sent (a result re-sent on every later step counts each time) */
  count: number;
}

/**
 * Tokens of one part of a call. Counted from the text sent and scaled so a call's parts add
 * up to what the model server reported, so they're estimates; the largest items are listed,
 * the rest summed as "Others".
 */
export interface TokenGroup {
  id: TokenGroupId;
  tokens: number;
  items: TokenItem[];
}

/** One request to the model and its response, for the token usage breakdown. */
export interface ModelCallUsage extends Usage {
  kind: ModelCallKind;
  /** the model the server says answered, null if it didn't say */
  model: string | null;
  /** from sending the request to the end of the response */
  durationMs: number;
  /** the tools the response asked to run, in order (a step only) */
  toolCalls: string[];
  /** what the input tokens went to, largest first (empty if not known) */
  input: TokenGroup[];
  /** what the output tokens went to, largest first (empty if not known) */
  output: TokenGroup[];
}

/** How one user prompt ended. */
export interface RunResult {
  text: string;
  status: RunStatus;
  steps: number;
  toolsUsed: string[];
  usage: Usage;
  /** each model call the request made, in order; `usage` is their sum */
  calls: ModelCallUsage[];
}

/** Live progress the agent reports while it works on one prompt. */
export type AgentEvent =
  | { type: 'planning' }
  | { type: 'route'; mode: 'direct' | 'plan'; reason: string; steps: number }
  | { type: 'model_call'; step: number }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; preview: string }
  | { type: 'plan'; plan: Plan | null }
  | { type: 'check'; unfinished: NumberedPlanStep[] }
  | { type: 'limit'; reason: string }
  /** After each model call: how full the model's context window was (input plus output). */
  | { type: 'context'; usedTokens: number; windowTokens: number }
  /** Older messages were summarized to stay inside the context window. */
  | { type: 'compaction'; summarizedMessages: number; tokensBefore: number; tokensAfter: number }
  /**
   * A message the user sent during the run (`POST /v1/chats/:id/run/messages`) reached the
   * model: it was added to the conversation before this step. `id` is the one that POST gave.
   */
  | { type: 'steer'; id: string; text: string; sentAt: string };

/**
 * Everything `POST /v1/runs` streams, one per server-sent event as `data: <json>`.
 * `chat` comes first, then agent events and approval requests, then `done` or `error`.
 */
export type StreamEvent =
  | AgentEvent
  | { type: 'chat'; chat: ChatSummary }
  | { type: 'approval'; id: string; tool: string; input: unknown }
  | { type: 'approval_closed'; id: string; allowed: boolean }
  | { type: 'done'; result: RunResult }
  | { type: 'error'; message: string };

export const runRequestSchema = z
  .object({
    workspaceId: z.string().uuid('Pick a workspace.'),
    chatId: z.string().uuid().optional(),
    /** May be empty when files are attached. */
    message: z.string(),
    /** Files uploaded first with POST /v1/workspaces/:id/attachments. */
    attachmentIds: z
      .array(z.string().uuid('Unknown attachment.'))
      .max(
        ATTACHMENT_LIMITS.perMessage,
        `Attach at most ${ATTACHMENT_LIMITS.perMessage} files to one message.`,
      )
      .optional(),
    /** Left out: the default model. */
    modelId: z.string().uuid('Pick a model.').optional(),
    /** Left out: the server's default. Ignored for models without reasoning support. */
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    /**
     * Run tools without asking, for this run only (the composer's Auto-approve). Only matters
     * when approvals are set to ask; never turns on a tool that approvals set to refuse.
     */
    autoApprove: z.boolean().optional(),
    /** Skills the user picked for this message (by name): they come with it in full. */
    skills: z
      .array(skillNameSchema)
      .max(SKILL_LIMITS.perMessage, `Pick at most ${SKILL_LIMITS.perMessage} skills.`)
      .optional(),
  })
  .refine((run) => run.message.trim() !== '' || (run.attachmentIds?.length ?? 0) > 0, {
    message: 'Type a message first.',
    path: ['message'],
  });

export type RunRequest = z.infer<typeof runRequestSchema>;

export const approvalDecisionSchema = z.object({
  allow: z.boolean(),
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/**
 * `POST /v1/chats/:id/run/messages`: a message for the chat's run in progress. The agent reads
 * it before its next step (a `steer` event says when); text only, no files or skills.
 */
export const steerRequestSchema = z.object({
  message: z.string().refine((text) => text.trim() !== '', 'Type a message first.'),
});

export type SteerRequest = z.infer<typeof steerRequestSchema>;

/** The answer to a `steer` request: the id its `steer` event will carry. */
export interface SteerAccepted {
  id: string;
}

/** `PATCH /v1/chats/:id/run`: turns Auto-approve on or off for the chat's run in progress. */
export const runChangeSchema = z.object({
  autoApprove: z.boolean(),
});

export type RunChange = z.infer<typeof runChangeSchema>;
