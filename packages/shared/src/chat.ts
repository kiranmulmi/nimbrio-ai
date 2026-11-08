import { z } from 'zod';
import type { Attachment } from './attachment.js';
import type { Plan } from './plan.js';
import type { ModelCallUsage, RunStatus } from './run.js';

export interface ChatSummary {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  isRunning: boolean;
}

/** How much of a tool result the chat shows (live and after a reload); the model gets all of it. */
export const TOOL_RESULT_PREVIEW_CHARS = 600;

/**
 * A tool result as the chat shows it. The chat format has no error flag on tool results,
 * so the agent marks errors with an "Error: " prefix.
 */
export function toolResultPreview(result: string): { ok: boolean; preview: string } {
  return { ok: !result.startsWith('Error: '), preview: result.slice(0, TOOL_RESULT_PREVIEW_CHARS) };
}

/** One bubble of a saved chat, as the UI shows it. */
export type HistoryItem =
  | {
      role: 'user';
      text: string;
      attachments: Attachment[];
      skills: string[];
      /** when the user sent it (ISO), null if unknown */
      sentAt: string | null;
      /** sent while the agent worked on the message before it, and read by that same run */
      steer?: boolean;
    }
  | { role: 'assistant'; text: string }
  /** `result` is the start of the saved result (see `toolResultPreview`), null if none was saved. */
  | { role: 'tool'; name: string; args: string; ok: boolean; result: string | null }
  /** Here the messages before were summarized for the model (the chat keeps them all). */
  | { role: 'compaction'; summarizedMessages: number }
  | {
      role: 'meta';
      status: RunStatus;
      steps: number;
      inputTokens: number;
      outputTokens: number;
      /** of inputTokens, read from the prompt cache */
      cachedInputTokens: number;
      /** of inputTokens, written to the prompt cache */
      cacheWriteTokens: number;
      /** each model call, in order; empty for replies saved before calls were recorded */
      calls: ModelCallUsage[];
      /** when the reply finished (ISO) */
      finishedAt: string | null;
    };

export interface ChatDetail {
  chat: ChatSummary;
  history: HistoryItem[];
  plan: Plan | null;
  /** The chat's earlier plans, oldest first: each new plan moves the current one here. */
  earlierPlans: Plan[];
}

export const chatRenameSchema = z.object({
  title: z.string().trim().min(1, 'Give the chat a title.'),
});

export type ChatRename = z.infer<typeof chatRenameSchema>;
