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
  // Sign-in with Supabase Auth: on when both are set (see .env.example).
  SUPABASE_URL: z.string().trim().default(''),
  SUPABASE_ANON_KEY: z.string().trim().default(''),
  /** Comma-separated emails that may sign in; empty lets any user of the project in. */
  AUTH_ALLOWED_EMAILS: z.string().default(''),
  /** `off` keeps sign-in off even with the Supabase values set (the desktop app sets it). */
  SIGN_IN: z.enum(['auto', 'off']).default('auto'),
});

export const env = schema.parse(process.env);

/** The Supabase project users sign in with, and who may; null when sign-in is off. */
export interface AuthSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** lower-case; empty means every user of the project */
  allowedEmails: string[];
}

/** Read the sign-in settings; half of them set is a mistake worth stopping for. */
export function readAuthSettings(values: typeof env): AuthSettings | null {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey } = values;
  if (values.SIGN_IN === 'off' || (!url && !anonKey)) return null;
  if (!url || !anonKey) {
    throw new Error(
      'Set both SUPABASE_URL and SUPABASE_ANON_KEY in .env to turn on sign-in, or neither.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SUPABASE_URL is not a URL: "${url}".`);
  }
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== '127.0.0.1' &&
    parsed.hostname !== 'localhost'
  ) {
    throw new Error('SUPABASE_URL must use https (http only for a local Supabase).');
  }
  return {
    supabaseUrl: parsed.origin,
    supabaseAnonKey: anonKey,
    allowedEmails: values.AUTH_ALLOWED_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  };
}

export const agentConfig = loadAgentConfig(process.env);

/** The agent can write files, so the API only ever listens on this machine. */
export const HOST = '127.0.0.1';

export const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
