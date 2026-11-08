// Running bash for the agent: the shell to use, killing a command's whole process group, and
// keeping a long output's start and end. Used by run_command and background tasks.
import { existsSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';

/** Output kept: the start (what ran) and the end (where errors and summaries are). */
const HEAD_CHARS = 3_000;
const TAIL_CHARS = 12_000;

/** The shell to run commands with: bash where there is one, as the tool promises. */
export function shellFor(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
  return { file: existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', args: ['-c', command] };
}

/** Whether commands run in their own process group (so all they start can be stopped). */
export const isProcessGroup = process.platform !== 'win32';

/** Sends a signal to the command and everything it started (its process group). */
export function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (isProcessGroup && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // already gone
  }
}

/** Keeps the start and the end of a long output, without holding all of it in memory. */
export class BoundedOutput {
  private head = '';
  private tail = '';
  private omitted = 0;

  add(text: string): void {
    const clean = stripAnsi(text);
    if (this.head.length < HEAD_CHARS) {
      const room = HEAD_CHARS - this.head.length;
      this.head += clean.slice(0, room);
      this.tail += clean.slice(room);
    } else {
      this.tail += clean;
    }
    if (this.tail.length > TAIL_CHARS * 2) this.trim();
  }

  text(): string {
    this.trim();
    if (this.omitted === 0) return this.head + this.tail;
    return `${this.head}\n\n[… ${this.omitted} characters of output not shown …]\n\n${this.tail}`;
  }

  private trim(): void {
    if (this.tail.length <= TAIL_CHARS) return;
    this.omitted += this.tail.length - TAIL_CHARS;
    this.tail = this.tail.slice(-TAIL_CHARS);
  }
}

// Colour and cursor codes some tools print even with NO_COLOR set (ESC [ ... and ESC ] ... BEL).
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]|${ESC}\\][^${BEL}]*${BEL}`, 'g');

function stripAnsi(text: string): string {
  return text.replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
}
