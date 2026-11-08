import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAgentConfig } from '@app/agent';
import { z } from 'zod';

// One .env at the repo root serves the API and the CLI.
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (fs.existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const env = schema.parse(process.env);

export const agentConfig = loadAgentConfig(process.env);

/** The agent can write files, so the API only ever listens on this machine. */
export const HOST = '127.0.0.1';

export const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
