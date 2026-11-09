import { execFile } from 'node:child_process';

const MARKER = '__NIMBRIO_PATH__';
const TIMEOUT_MS = 5000;

/**
 * The PATH printed between the markers; shell start-up files may print other text around it.
 * null when the output has no complete marked PATH.
 */
export function parseMarkedPath(output: string): string | null {
  const start = output.indexOf(MARKER);
  if (start === -1) return null;
  const end = output.indexOf(MARKER, start + MARKER.length);
  if (end === -1) return null;
  const value = output.slice(start + MARKER.length, end).trim();
  return value || null;
}

/** Every folder of `preferred` first, then the ones only `fallback` has, without repeats. */
export function mergePaths(preferred: string, fallback: string, separator = ':'): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const dir of [...preferred.split(separator), ...fallback.split(separator)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    merged.push(dir);
  }
  return merged.join(separator);
}

/**
 * Apps opened from the Dock or Finder get only the system PATH (/usr/bin:/bin:...), so the
 * agent's commands and the terminal couldn't find node, npm or Homebrew tools. The user's login
 * shell knows the PATH they use in Terminal, so ask it once at start-up. null on Windows (which
 * has no such gap) or when the shell doesn't answer in time.
 */
export function loginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null);
  const shell = env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '%s' "${MARKER}$PATH${MARKER}"`],
      { timeout: TIMEOUT_MS, env, encoding: 'utf8' },
      (_error, stdout) => resolve(parseMarkedPath(stdout)),
    );
  });
}
