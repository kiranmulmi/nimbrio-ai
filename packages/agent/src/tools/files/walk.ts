// Helpers shared by the file tools (and the API's Files panel): walking the
// workspace without wading into generated folders, globs, and display paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { ToolContext } from '../define.js';
import { isInAppData, resolveInWorkspace } from '../../guardrails.js';

/** Dependencies, build output and caches: walking them floods the context and says little. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
]);

const SKIPPED_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db']);

export interface WalkEntry {
  /** path relative to the folder the walk started in, with "/" separators */
  relative: string;
  absolute: string;
  isDirectory: boolean;
  /** 1 for the start folder's own entries */
  depth: number;
  /** a SKIPPED_FOLDERS folder: listed, never entered */
  isSkipped: boolean;
}

/**
 * Depth-first walk, sorted by name. Symlinks are listed but never followed, so a
 * link can't lead the walk out of the workspace.
 */
export async function* walk(
  start: string,
  { maxDepth = Infinity }: { maxDepth?: number } = {},
): AsyncGenerator<WalkEntry> {
  async function* visit(dir: string, prefix: string, depth: number): AsyncGenerator<WalkEntry> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip it rather than fail the whole walk
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      // The app's own data folders are never shown: file tools can't reach them anyway.
      if (SKIPPED_FILES.has(entry.name) || isInAppData(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      const isDirectory = entry.isDirectory();
      const isSkipped = isDirectory && SKIPPED_FOLDERS.has(entry.name);
      yield { relative, absolute, isDirectory, depth, isSkipped };
      if (isDirectory && !isSkipped && depth < maxDepth) {
        yield* visit(absolute, relative, depth + 1);
      }
    }
  }
  yield* visit(start, '', 1);
}

/**
 * Every file in a workspace folder (generated folders left out), for the Files panel, and
 * the folders with nothing in them (they'd otherwise be missing from a tree of files).
 */
export async function listWorkspaceFiles(
  dir: string,
  limit: number,
): Promise<{ files: string[]; emptyFolders: string[]; isTruncated: boolean }> {
  const files: string[] = [];
  const childCount = new Map<string, number>();
  const parentOf = (relative: string) => relative.slice(0, Math.max(0, relative.lastIndexOf('/')));
  const emptyFolders = () =>
    [...childCount].filter(([, count]) => count === 0).map(([folder]) => folder);
  for await (const entry of walk(dir)) {
    const parent = parentOf(entry.relative);
    if (parent) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    if (entry.isDirectory) {
      if (!entry.isSkipped) childCount.set(entry.relative, 0);
      continue;
    }
    // Cut short, a folder not walked yet looks empty: leave them out rather than guess.
    if (files.length === limit) return { files, emptyFolders: [], isTruncated: true };
    files.push(entry.relative);
  }
  return { files, emptyFolders: emptyFolders(), isTruncated: false };
}

/** The real workspace folder and a model-supplied path resolved inside it. */
export async function locate(
  ctx: ToolContext,
  requestedPath: string,
): Promise<{ root: string; target: string; shown: string }> {
  const root = await fs.realpath(ctx.workspace);
  const target = await resolveInWorkspace(root, requestedPath);
  return { root, target, shown: shownPath(root, target) };
}

/** How a path is shown to the model: relative to the workspace, "." for the folder itself. */
export function shownPath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

/**
 * A glob as a RegExp over "/"-separated relative paths: `*` and `?` stay within one
 * folder, `**` spans folders, `{a,b}` is either. Without a "/", the glob matches
 * file names in any folder (`*.ts`), as most people expect.
 */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob.includes('/') ? glob.replace(/^\.\//, '') : `**/${glob}`;
  let source = '';
  let braceDepth = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    if (char === '*') {
      if (pattern.charAt(i + 1) === '*') {
        const isFolderPrefix = pattern.charAt(i + 2) === '/';
        source += isFolderPrefix ? '(?:.*/)?' : '.*';
        i += isFolderPrefix ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') source += '[^/]';
    else if (char === '{') {
      braceDepth += 1;
      source += '(?:';
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
      source += ')';
    } else if (char === ',' && braceDepth > 0) source += '|';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Text files only: a NUL byte near the start means binary. */
export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}
