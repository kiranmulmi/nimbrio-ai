import { z } from 'zod';
import { APPROVAL_MODES, type ApprovalMode } from './info.js';

export const LOG_LEVELS = ['debug', 'info', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const PLANNING_MODES = ['auto', 'off'] as const;
export type PlanningMode = (typeof PLANNING_MODES)[number];

/**
 * How the agent behaves, app-wide, set in Settings -> Agent. Server options (PORT, ...)
 * stay in .env.
 */
export interface AgentSettings {
  /** auto: before each request, a planning step decides whether to plan first. */
  planning: PlanningMode;
  /** Model calls per user prompt. */
  maxSteps: number;
  /** Input + output token budget per user prompt. */
  maxTotalTokens: number;
  /** Prompts longer than this many characters are rejected. */
  maxInputChars: number;
  /** Tools that change things: ask before each, run without asking, or refuse. */
  approval: ApprovalMode;
  /** The SearXNG instance the web_search tool uses. */
  searxngUrl: string;
  /** What the agent prints to the server's terminal. The JSONL run logs are always written. */
  logLevel: LogLevel;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  planning: 'auto',
  maxSteps: 30,
  maxTotalTokens: 400_000,
  maxInputChars: 20_000,
  approval: 'ask',
  searxngUrl: 'http://localhost:8080',
  logLevel: 'info',
};

/** Bounds the API enforces and the settings form shows. */
export const SETTINGS_LIMITS = {
  maxSteps: { min: 1, max: 200 },
  maxTotalTokens: { min: 1_000, max: 50_000_000 },
  maxInputChars: { min: 100, max: 1_000_000 },
  searxngUrl: 500,
} as const;

const wholeNumber = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .number({ invalid_type_error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min.toLocaleString('en')}.`)
    .max(max, `${label} can be at most ${max.toLocaleString('en')}.`);

export const agentSettingsSchema = z.object({
  planning: z.enum(PLANNING_MODES),
  maxSteps: wholeNumber('Max steps', SETTINGS_LIMITS.maxSteps),
  maxTotalTokens: wholeNumber('The token budget', SETTINGS_LIMITS.maxTotalTokens),
  maxInputChars: wholeNumber('The prompt limit', SETTINGS_LIMITS.maxInputChars),
  approval: z.enum(APPROVAL_MODES),
  searxngUrl: z
    .string()
    .trim()
    .max(SETTINGS_LIMITS.searxngUrl, `Keep the URL under ${SETTINGS_LIMITS.searxngUrl} characters.`)
    .regex(/^https?:\/\/[^\s]+$/i, 'Use an http:// or https:// URL, like http://localhost:8080.')
    .transform((value) => value.replace(/\/+$/, '')),
  logLevel: z.enum(LOG_LEVELS),
});

export type AgentSettingsInput = z.input<typeof agentSettingsSchema>;

/**
 * Saved settings, read leniently: a missing or invalid value (an older row, a hand edit)
 * falls back to its default instead of stopping the app.
 */
export function readAgentSettings(raw: unknown): AgentSettings {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { shape } = agentSettingsSchema;
  const field = <K extends keyof AgentSettings>(key: K): AgentSettings[K] => {
    const parsed = shape[key].safeParse(stored[key]);
    return parsed.success ? (parsed.data as AgentSettings[K]) : DEFAULT_AGENT_SETTINGS[key];
  };
  return {
    planning: field('planning'),
    maxSteps: field('maxSteps'),
    maxTotalTokens: field('maxTotalTokens'),
    maxInputChars: field('maxInputChars'),
    approval: field('approval'),
    searxngUrl: field('searxngUrl'),
    logLevel: field('logLevel'),
  };
}
