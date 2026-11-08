import { z } from 'zod';

/**
 * A skill: instructions for one kind of task (a workflow, a checklist, a house style),
 * written by the user in the Skills tab and kept in the workspace's
 * `.nimbrio-ai/skills/<name>.md`. The agent sees every skill's name and description and
 * loads one with `use_skill` when a task matches it; the user can also pick skills for a
 * message in the composer, and those come with the message in full.
 */
export interface Skill {
  /** kebab-case, also the file name: "jira-ticket-fix" */
  name: string;
  /** when to use it, in a sentence or two: this is what the agent decides by */
  description: string;
  /** the instructions themselves (Markdown) */
  body: string;
  /** when the file last changed (ISO) */
  updatedAt: string | null;
}

export const SKILL_LIMITS = {
  nameLength: 64,
  descriptionLength: 500,
  bodyChars: 40_000,
  /** skills one workspace can have (all of them are listed to the agent) */
  count: 100,
  /** skills the user can pick for one message */
  perMessage: 5,
} as const;

/** Lower-case words joined by single hyphens: safe as a file name everywhere. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const skillNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the skill a name.')
  .max(SKILL_LIMITS.nameLength, `Keep the name to ${SKILL_LIMITS.nameLength} characters.`)
  .regex(
    SKILL_NAME_PATTERN,
    'Use lower-case letters, digits and single hyphens, e.g. "jira-ticket-fix".',
  );

/** `POST /v1/workspaces/:id/skills` and `PUT …/skills/:name` (a different `name` renames it). */
export const skillInputSchema = z.object({
  name: skillNameSchema,
  description: z
    .string()
    .trim()
    .min(1, 'Say when the agent should use it: this is how it decides.')
    .max(
      SKILL_LIMITS.descriptionLength,
      `Keep the description to ${SKILL_LIMITS.descriptionLength} characters.`,
    ),
  body: z
    .string()
    .trim()
    .min(1, 'Write the instructions.')
    .max(SKILL_LIMITS.bodyChars, `Keep the instructions to ${SKILL_LIMITS.bodyChars} characters.`),
});

export type SkillInput = z.infer<typeof skillInputSchema>;

/** Longest request the skill writer takes ("what should this skill do?"). */
export const SKILL_REQUEST_MAX_CHARS = 2000;

/**
 * `POST /v1/prompts/skill`: the skill form's AI writer. Writes the instructions from a request
 * (an empty box: from scratch), changes them as asked, or with no request tidies them; plus a
 * suggested "when to use it" line. Nothing is saved.
 */
export const skillImproveSchema = z
  .object({
    /** What the user asked for; empty: tidy the current instructions. */
    request: z
      .string()
      .trim()
      .max(SKILL_REQUEST_MAX_CHARS, 'Keep the request shorter.')
      .default(''),
    name: z.string().trim().max(SKILL_LIMITS.nameLength).optional(),
    description: z.string().max(SKILL_LIMITS.descriptionLength).optional(),
    body: z
      .string()
      .trim()
      .max(SKILL_LIMITS.bodyChars, 'Those instructions are too long to improve.')
      .default(''),
    /** Left out: the default model. */
    modelId: z.string().uuid('Pick a model.').optional(),
  })
  .refine((draft) => draft.request !== '' || draft.body !== '', {
    message: 'Say what the skill should do, or write some instructions first.',
    path: ['request'],
  });

export type SkillImproveRequest = z.input<typeof skillImproveSchema>;

export interface ImprovedSkill {
  body: string;
  /** A suggested description; empty when the model gave none. */
  description: string;
}

/** A name typed into a field, as a skill name: "Jira Ticket Fix!" → "jira-ticket-fix". */
export function toSkillName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_LIMITS.nameLength)
    .replace(/-+$/, '');
}
