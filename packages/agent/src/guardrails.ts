// Guardrails: checks that keep the agent inside safe limits no matter what the
// model decides. They run in code, outside the model, so a prompt can't talk
// its way past them.
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import type { ApprovalMode, ModelCallUsage, Usage } from '@app/shared';
import type { AgentConfig } from './config.js';
import { errorCode } from './errors.js';

/** Prompts the human and returns their answer. */
export type AskFn = (question: string) => Promise<string>;

/** Decides whether a tool with side effects may run with this input. */
export type ApproveFn = (toolName: string, input: unknown) => Promise<boolean>;

// ---------- Input checks ----------

export type InputCheck = { ok: true } | { ok: false; reason: string };

export function checkInput(
  text: string,
  { maxInputChars }: Pick<AgentConfig, 'maxInputChars'>,
): InputCheck {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'The prompt is empty.' };
  }
  if (text.length > maxInputChars) {
    return {
      ok: false,
      reason: `The prompt is ${text.length} characters; the limit is ${maxInputChars}.`,
    };
  }
  return { ok: true };
}

// ---------- Run budget (steps + tokens per user prompt) ----------

export class Budget {
  steps = 0;
  inputTokens = 0;
  outputTokens = 0;
  cachedInputTokens = 0;
  cacheWriteTokens = 0;
  /** each model call, in order, for the token usage breakdown */
  readonly calls: ModelCallUsage[] = [];
  readonly maxSteps: number;
  readonly maxTotalTokens: number;

  constructor({ maxSteps, maxTotalTokens }: Pick<AgentConfig, 'maxSteps' | 'maxTotalTokens'>) {
    this.maxSteps = maxSteps;
    this.maxTotalTokens = maxTotalTokens;
  }

  recordCall(
    usage: Partial<Usage> = {},
    call: Omit<ModelCallUsage, keyof Usage> = {
      kind: 'step',
      model: null,
      durationMs: 0,
      toolCalls: [],
      input: [],
      output: [],
    },
  ): void {
    const counts: Usage = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    };
    this.steps += 1;
    this.inputTokens += counts.inputTokens;
    this.outputTokens += counts.outputTokens;
    this.cachedInputTokens += counts.cachedInputTokens ?? 0;
    this.cacheWriteTokens += counts.cacheWriteTokens ?? 0;
    this.calls.push({ ...call, ...counts });
  }

  /** The request's tokens so far, cache included. */
  usage(): Usage {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedInputTokens: this.cachedInputTokens,
      cacheWriteTokens: this.cacheWriteTokens,
    };
  }

  /** A reason string when the run must stop, otherwise null. */
  exceeded(): string | null {
    if (this.steps >= this.maxSteps) return `reached the limit of ${this.maxSteps} steps`;
    if (this.inputTokens + this.outputTokens >= this.maxTotalTokens) {
      return `used its token budget (${this.maxTotalTokens.toLocaleString()} tokens)`;
    }
    return null;
  }
}

// ---------- File sandbox ----------

/**
 * Each workspace folder keeps the app's own data (chats, memory, settings) in this
 * subfolder. File tools can't read or change it: the history and memory are only
 * reachable through the app, so the model can't rewrite or wipe them.
 */
export const APP_DATA_FOLDER = '.nimbrio-ai';

/**
 * The data folder's name before the app was renamed. @app/db moves it to APP_DATA_FOLDER on
 * start; until then (or when both existed) file tools can't reach it either.
 */
export const LEGACY_APP_DATA_FOLDER = '.agentic-ai';

/**
 * Whether a relative path goes through an APP_DATA_FOLDER (or its old name), at any depth (a
 * workspace nested in another keeps its own) and in any letter case (macOS disks ignore case).
 */
export function isInAppData(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((part) => {
    const name = part.toLowerCase();
    return name === APP_DATA_FOLDER || name === LEGACY_APP_DATA_FOLDER;
  });
}

/**
 * Resolve a model-supplied path inside the workspace folder, or throw.
 * Relative paths start at the workspace; absolute ones ("~/" too) must land in it.
 * Model output is untrusted: "..", other absolute paths and symlinks that lead
 * out are all refused, judged by the real path after following symlinks.
 * @returns the real path (symlinks followed for the part that exists)
 */
export async function resolveInWorkspace(dir: string, requestedPath: string): Promise<string> {
  if (typeof requestedPath !== 'string' || requestedPath.includes('\0')) {
    throw new Error('Invalid path.');
  }
  const root = await fs.realpath(dir);
  const target = await realTarget(path.resolve(root, expandHome(requestedPath) || '.'));
  if (!isInside(root, target)) {
    throw new Error(
      `That path is outside the workspace folder (${root}), which is the only place file tools can reach.`,
    );
  }
  if (isInAppData(path.relative(root, target))) {
    throw new Error(
      `${APP_DATA_FOLDER}/ holds this app's own chats, memory and settings; file tools can't reach it. Use the memory tools for memories.`,
    );
  }
  return target;
}

/**
 * Refuse changes the file tools must never make: removing or moving the workspace
 * folder itself, and touching git's internals (history would be at stake).
 */
export async function assertCanChange(dir: string, target: string): Promise<void> {
  const root = await fs.realpath(dir);
  const relative = path.relative(root, target);
  if (relative === '') throw new Error("The workspace folder itself can't be changed.");
  if (relative.split(path.sep).includes('.git')) {
    throw new Error("Files inside .git can't be changed by the agent.");
  }
}

/**
 * Check a folder the user chose for a workspace and create it if it's missing.
 * The agent may change anything inside, so the filesystem root and the home
 * folder itself are refused: that would expose every key and credential file.
 * @returns the real absolute path
 */
export async function prepareWorkspaceFolder(requestedPath: string): Promise<string> {
  const expanded = expandHome(requestedPath.trim());
  if (!path.isAbsolute(expanded)) {
    throw new Error('Use an absolute path for the workspace folder, like /Users/you/projects/app.');
  }
  const resolved = path.resolve(expanded);
  await fs.mkdir(resolved, { recursive: true }).catch((error: unknown) => {
    if (errorCode(error) === 'EEXIST') throw new Error(`"${resolved}" is a file, not a folder.`);
    throw new Error(
      `Couldn't create the folder "${resolved}": ${errorCode(error) ?? 'unknown error'}.`,
    );
  });
  const real = await fs.realpath(resolved);
  if (!(await fs.stat(real)).isDirectory())
    throw new Error(`"${resolved}" is a file, not a folder.`);
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir());
  if (real === path.parse(real).root || real === home) {
    throw new Error(
      'Pick a project folder, not the whole disk or your home folder: the agent can change anything inside it.',
    );
  }
  return real;
}

/** "~" and "~/x" mean the user's home folder; anything else is returned as is. */
export function expandHome(requestedPath: string): string {
  if (requestedPath === '~' || requestedPath.startsWith('~/')) {
    return path.join(os.homedir(), requestedPath.slice(1));
  }
  return requestedPath;
}

/** The real path of `target`, following symlinks for whatever part of it already exists. */
async function realTarget(target: string): Promise<string> {
  const missing: string[] = [];
  let existing = target;
  while (true) {
    const real = await realpathOrNull(existing);
    if (real !== null) return path.join(real, ...missing);
    const parent = path.dirname(existing);
    if (parent === existing) return target;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  return !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

// ---------- Shell commands ----------

/**
 * A backstop under human approval, not a sandbox: commands that could wreck the
 * machine or run code from the internet are refused even in "auto" mode, in case
 * a misread request or an injected instruction slips past.
 * @returns why the command is refused, or null when it may run
 */
export function refuseCommand(command: string): string | null {
  for (const segment of command.split(/&&|\|\||[;&|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    const [program = '', ...args] = words;
    if (['sudo', 'su', 'doas'].includes(program)) {
      return 'Commands may not run as another user (sudo, su).';
    }
    if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(program) || /^mkfs/.test(program)) {
      return 'Commands may not shut down the machine or format disks.';
    }
    if (program === 'rm' && args.some((arg) => /^-\w*[rR]|^--recursive$/.test(arg))) {
      const danger = args.find((arg) =>
        /^["']?(\/\*?|~\/?\*?|\$HOME\/?\*?|\.\.\/?\*?)["']?$/.test(arg),
      );
      if (danger) return `Commands may not recursively delete ${danger}.`;
    }
    if (program === 'dd' && args.some((arg) => arg.startsWith('of=/dev/'))) {
      return 'Commands may not write to devices.';
    }
  }
  if (/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/.test(command)) return 'Fork bombs are refused.';
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(command)) {
    return 'Commands may not pipe a download into a shell. Download it, read it, then run it.';
  }
  return null;
}

/** This app's own settings and npm's per-script variables: never handed to a command. */
const APP_ENV =
  /^(OPENAI_|AGENT_|EVAL_|SEARXNG_|VITE_|npm_)|^(DATABASE_URL|TEST_DATABASE_URL|PORT|HOST|CORS_ORIGIN|LOG_LEVEL|INIT_CWD|NODE_ENV|SUPABASE_URL|SUPABASE_ANON_KEY|AUTH_ALLOWED_EMAILS)$/;

/**
 * The environment for a command: the user's (PATH, HOME, ...) minus this app's
 * secrets, set up so tools don't wait for input or page their output.
 */
/** `base` without this app's own settings and secrets (database URL, model keys, ...). */
export function withoutAppSecrets(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!APP_ENV.test(key)) env[key] = value;
  }
  return env;
}

export function commandEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...withoutAppSecrets(base),
    CI: 'true',
    TERM: 'dumb',
    NO_COLOR: '1',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  };
}

// ---------- Tool output size ----------

const MAX_TOOL_OUTPUT_CHARS = 20_000;

/**
 * Long tool output fills the context window fast; cut it and say so. The agent passes a smaller
 * cap for models with a small window (context.ts `contextLimits`).
 */
export function limitToolOutput(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[Output truncated: ${omitted} more characters not shown.]`;
}

// ---------- Human approval for tools with side effects ----------

/**
 * @param mode "ask" prompts the human, "auto" allows everything, "deny" allows nothing
 * @param ask prompts the human; required for "ask"
 */
export function createApprover(mode: ApprovalMode, ask?: AskFn): ApproveFn {
  return async function approve(toolName, input) {
    if (mode === 'auto') return true;
    if (mode === 'deny' || !ask) return false;
    const reason =
      typeof input === 'object' && input !== null && 'reason' in input ? input.reason : null;
    const preview = JSON.stringify(input, null, 2);
    const shown = preview.length > 1500 ? `${preview.slice(0, 1500)}\n...` : preview;
    const why = typeof reason === 'string' && reason.trim() ? `Why: ${reason.trim()}\n` : '';
    const answer = await ask(
      `\nThe agent wants to run ${toolName}.\n${why}With:\n${shown}\nAllow? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  };
}

// ---------- Web fetching: public internet only ----------

/**
 * Throw unless the URL is http(s) and every address its host resolves to is a
 * public internet address. Pages are untrusted: without this, a page could
 * steer the agent into reading services on this machine or the local network
 * (the model server, routers, admin panels).
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`"${rawUrl}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links can be opened.');
  }
  if (url.username || url.password) {
    throw new Error("Links with embedded credentials can't be opened.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error("Local and private network addresses can't be opened.");
  }
  let addresses: { address: string }[];
  try {
    addresses = net.isIP(host)
      ? [{ address: host }]
      : await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Couldn't find the website "${host}".`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Local and private network addresses can't be opened.");
  }
  return url;
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7)); // IPv4-mapped
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb')
  );
}
