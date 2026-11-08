// Running git read-only for the API (the Git diff tab, the Files panel's ignored paths):
// settings that could run a program (fsmonitor, external diff, textconv) are off, no pager or
// prompt, no optional locks, and none of this app's secrets in the environment.
import { spawn } from 'node:child_process';
import { withoutAppSecrets } from '@app/agent';

/** Output kept by default: enough for a big repository's status. */
const MAX_GIT_OUTPUT_BYTES = 4_000_000;
const TIMEOUT_MS = 15_000;
const GIT_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '--no-pager'];

export interface GitResult {
  code: number | null;
  stdout: string;
  isTruncated: boolean;
}

/** Runs git without a shell; null when git can't start (not installed, folder missing). */
export function runGit(
  cwd: string,
  args: string[],
  maxBytes = MAX_GIT_OUTPUT_BYTES,
): Promise<GitResult | null> {
  return new Promise((resolve) => {
    const child = spawn('git', [...GIT_ARGS, ...args], {
      cwd,
      env: {
        ...withoutAppSecrets(process.env),
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let isTruncated = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      if (isTruncated) return;
      if (size + chunk.length > maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - size));
        isTruncated = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), isTruncated });
    });
  });
}
