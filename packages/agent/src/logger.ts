// Observability: every step of a run goes to the console (readable) and to a
// JSONL file in ~/.nimbrio-ai/logs/ (one event per line, AGENT_LOG_DIR to move it), so you can see why the agent did
// what it did after the fact. The console level is set in the app (Settings -> Agent).
import fs from 'node:fs';
import path from 'node:path';
import type { LogLevel } from './config.js';

export interface AgentLogger {
  /** The JSONL log file, or null when logging to a file is off. */
  file: string | null;
  event(name: string, data?: object): void;
  step(text: string): void;
  warn(text: string, data?: object): void;
  error(text: string, data?: object): void;
}

export interface LoggerOptions {
  /** A function is asked on every line, so a server can follow a setting changed in the app. */
  level?: LogLevel | (() => LogLevel);
  logDir?: string;
  sessionName?: string;
}

const colors = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

export function createLogger({
  level = 'info',
  logDir,
  sessionName = 'session',
}: LoggerOptions = {}): AgentLogger {
  let file: string | null = null;
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    file = path.join(logDir, `${sessionName}-${stamp}.jsonl`);
  }

  const write = (event: string, data: object) => {
    if (file) {
      fs.appendFileSync(
        file,
        `${JSON.stringify({ time: new Date().toISOString(), event, ...data })}\n`,
      );
    }
  };
  const currentLevel = typeof level === 'function' ? level : () => level;
  const print = (text: string) => {
    if (currentLevel() !== 'silent') process.stderr.write(`${text}\n`);
  };

  return {
    file,
    event(event, data = {}) {
      write(event, data);
      if (currentLevel() === 'debug') print(colors.dim(`[${event}] ${JSON.stringify(data)}`));
    },
    step(text) {
      print(colors.cyan(`  > ${text}`));
    },
    warn(text, data = {}) {
      write('warning', { message: text, ...data });
      print(colors.yellow(`  ! ${text}`));
    },
    error(text, data = {}) {
      write('error', { message: text, ...data });
      print(colors.red(`  x ${text}`));
    },
  };
}
