import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_AGENT_SETTINGS, LOG_LEVELS, type AgentSettings, type LogLevel } from '@app/shared';

export { LOG_LEVELS, type LogLevel };

/**
 * Everything a run needs to know. The agent's behaviour (`AgentSettings`: planning, limits,
 * approvals, search, log level) is set in the app and saved by @app/db; apps merge it over
 * `loadAgentConfig`. Only the log folder comes from env.
 * The model is not here either: it's passed to each run as `ModelSettings`.
 */
export interface AgentConfig extends AgentSettings {
  /** JSONL run logs. Workspace files live in each workspace's own folder. */
  logDir: string;
  /** times an answer with open plan steps is sent back for another pass */
  maxPlanChecks: number;
}

// Lenient on purpose: a missing, empty or invalid value falls back to its default.
const text = z.string().min(1);
const dir = text.transform((value) =>
  path.resolve(
    value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value,
  ),
);

const envSchema = z.object({
  AGENT_LOG_DIR: dir.optional().catch(undefined),
});

/**
 * The env part of the config (usually .env), with the default agent settings. Reads
 * nothing until called. Apps put the saved settings over it for each run.
 */
export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const e = envSchema.parse(env);
  return {
    ...DEFAULT_AGENT_SETTINGS,
    logDir: e.AGENT_LOG_DIR ?? path.join(os.homedir(), '.nimbrio-ai', 'logs'),
    maxPlanChecks: 1,
  };
}
