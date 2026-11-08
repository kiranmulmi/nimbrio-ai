import { z } from 'zod';
import { LIMITS } from './limits.js';
import { REASONING_EFFORTS } from './model.js';

/** Longest prompt the "improve" button rewrites. */
export const IMPROVE_PROMPT_MAX_CHARS = 20_000;

/** POST /v1/prompts/improve: rewrite a draft prompt before it is sent. */
export const improvePromptSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Type a prompt first.')
    .max(IMPROVE_PROMPT_MAX_CHARS, 'That prompt is too long to improve.'),
  /** Left out: the default model. */
  modelId: z.string().uuid('Pick a model.').optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  /** For context: the workspace's name and instructions help the rewrite stay on topic. */
  workspaceId: z.string().uuid().optional(),
});

export type ImprovePromptRequest = z.infer<typeof improvePromptSchema>;

export interface ImprovedPrompt {
  text: string;
}

/** Longest request the instructions assistant takes ("what should the agent do here?"). */
export const INSTRUCTIONS_REQUEST_MAX_CHARS = 2000;

/**
 * POST /v1/prompts/instructions: a workspace's instructions written (or rewritten) by the
 * model from a short request, the workspace's name and folder, and the current text.
 */
export const instructionsDraftSchema = z
  .object({
    request: z
      .string()
      .trim()
      .max(INSTRUCTIONS_REQUEST_MAX_CHARS, 'Keep the request shorter.')
      .default(''),
    current: z.string().max(LIMITS.instructions).default(''),
    name: z.string().trim().max(LIMITS.workspaceName).optional(),
    path: z.string().trim().max(LIMITS.folderPath).optional(),
    /** Left out: the default model. */
    modelId: z.string().uuid('Pick a model.').optional(),
  })
  .refine((draft) => draft.request !== '' || draft.current.trim() !== '', {
    message: 'Say what the agent should do in this workspace.',
    path: ['request'],
  });

export type InstructionsDraftRequest = z.input<typeof instructionsDraftSchema>;

export interface InstructionsDraft {
  text: string;
}
