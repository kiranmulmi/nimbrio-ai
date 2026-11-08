import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { defineTool } from './define.js';
import { commandEnv, refuseCommand } from '../guardrails.js';
import { locate } from './files/walk.js';
import { BoundedOutput, isProcessGroup, shellFor, signalGroup } from './shell.js';

const DEFAULT_TIMEOUT_SECONDS = 120;
/** A background command's first output (or early exit) is reported after this long. */
const BACKGROUND_STARTUP_MS = 4_000;
const MAX_TIMEOUT_SECONDS = 600;
/** After the shell exits or times out: how long leftovers get to stop before SIGKILL. */
const KILL_GRACE_MS = 1_500;

interface CommandInput {
  command: string;
  cwd?: string;
  timeout_seconds?: number;
  background?: boolean;
}

interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  isTimedOut: boolean;
  output: string;
  durationMs: number;
}

export const runCommand = defineTool<CommandInput>({
  name: 'run_command',
  description:
    'Run a bash command in the workspace folder and get its exit code and output (stdout and stderr together). Call this to install dependencies, run tests, builds, linters, type checks, scripts or git commands, and to check that a change works. Not for reading, searching or editing files: the file tools do that better. Commands get no input, so use non-interactive flags. Anything a command leaves running is stopped when it finishes. To keep something running after it returns (a dev server, a watcher), set background: true: it starts as a background task, the reply has its first few seconds of output, task_output reads more and stop_task ends it.',
  properties: {
    command: {
      type: 'string',
      description: 'The bash command line, e.g. "npm test" or "npm run build && npm run lint".',
    },
    cwd: {
      type: 'string',
      description: 'Folder to run it in, relative to the workspace folder. Default "." (the root).',
    },
    timeout_seconds: {
      type: 'integer',
      description: `Stop the command after this many seconds, 1 to ${MAX_TIMEOUT_SECONDS}. Default ${DEFAULT_TIMEOUT_SECONDS}. Not used with background.`,
    },
    background: {
      type: 'boolean',
      description:
        "Keep it running as a background task (no timeout) and return after its first few seconds. For servers and watchers only; don't add & to the command.",
    },
  },
  optional: ['cwd', 'timeout_seconds', 'background'],
  needsApproval: true,
  async run({ command, cwd = '.', timeout_seconds: timeoutSeconds, background = false }, ctx) {
    if (!command.trim()) throw new Error('The command is empty.');
    const refusal = refuseCommand(command);
    if (refusal) throw new Error(`${refusal} This command was not run.`);
    const { target, shown } = await locate(ctx, cwd);
    if (!(await fs.stat(target)).isDirectory()) throw new Error(`"${shown}" is not a folder.`);
    const where = shown === '.' ? '' : ` (in ${shown}/)`;

    if (background) {
      if (!ctx.tasks) {
        throw new Error("Background tasks aren't available here. Run it without background.");
      }
      const task = ctx.tasks.start(command, target, shown);
      const hasStopped = await ctx.tasks.waitForStop(task.id, BACKGROUND_STARTUP_MS, ctx.signal);
      const now = ctx.tasks.get(task.id);
      const output = now?.output.trimEnd() || '(no output yet)';
      const status = hasStopped
        ? `background task ${task.id} already stopped: ${
            now?.exitCode === null || now?.exitCode === undefined
              ? 'ended by a signal'
              : `exit code ${now.exitCode}`
          }`
        : `running in the background as task ${task.id} (pid ${task.pid ?? '?'}); read more with task_output, end it with stop_task`;
      return `$ ${command}${where}\n${status}\n\n${output}`;
    }

    const seconds = Math.min(
      Math.max(timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS, 1),
      MAX_TIMEOUT_SECONDS,
    );
    const result = await runShell(command, target, seconds * 1000, ctx.signal);

    const took = `${(result.durationMs / 1000).toFixed(1)}s`;
    const status = result.isTimedOut
      ? `stopped after ${seconds}s (timeout); raise timeout_seconds if it needs longer`
      : result.exitCode !== null
        ? `exit code ${result.exitCode} · ${took}`
        : `killed by ${result.signal ?? 'a signal'} · ${took}`;
    return `$ ${command}${where}\n${status}\n\n${result.output.trimEnd() || '(no output)'}`;
  },
});

/**
 * Run a command in its own process group, so a timeout or the end of the command
 * can stop everything it started, including servers it put in the background.
 */
function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const started = Date.now();
  const { file, args } = shellFor(command);
  const child = spawn(file, args, {
    cwd,
    env: commandEnv(process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: isProcessGroup,
    windowsHide: true,
  });

  const output = new BoundedOutput();
  child.stdout.on('data', (chunk: Buffer) => output.add(chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => output.add(chunk.toString('utf8')));

  const killAll = (signal: NodeJS.Signals) => signalGroup(child, signal);
  let isTimedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  const stopEverything = () => {
    killAll('SIGTERM');
    killTimer ??= setTimeout(() => killAll('SIGKILL'), KILL_GRACE_MS);
  };
  const timeout = setTimeout(() => {
    isTimedOut = true;
    stopEverything();
  }, timeoutMs);
  // The user stopped the run: end the command (and anything it started) now.
  signal?.addEventListener('abort', stopEverything, { once: true });

  return new Promise((resolve, reject) => {
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Couldn't start the shell: ${error.message}`, { cause: error }));
    });
    // The shell is done; background leftovers would keep the output open, so stop them.
    child.on('exit', (code, signal) => {
      exit = { code, signal };
      stopEverything();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const final = exit ?? { code, signal };
      resolve({
        exitCode: final.code,
        signal: final.signal,
        isTimedOut,
        output: output.text(),
        durationMs: Date.now() - started,
      });
    });
  });
}
