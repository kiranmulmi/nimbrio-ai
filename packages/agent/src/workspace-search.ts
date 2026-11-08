// Search for the Files panel: file names, or the text inside files. Uses the same walk as the
// file tools (generated folders skipped, symlinks never followed, the app's data left out).
import fs from 'node:fs/promises';
import type { FileContentMatch } from '@app/shared';
import { isBinary, walk } from './tools/files/walk.js';

const MAX_WALKED = 50_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_CHARS = 240;
const MAX_LINES_PER_FILE = 50;
const TIME_LIMIT_MS = 6_000;

export interface NameSearch {
  paths: string[];
  isTruncated: boolean;
}

/**
 * Files whose path contains `query` (any case). Name matches come before folder-only
 * matches, then shorter paths.
 */
export async function findFilesByName(
  dir: string,
  query: string,
  limit: number,
): Promise<NameSearch> {
  const needle = query.toLowerCase();
  const found: { path: string; rank: number }[] = [];
  let walked = 0;
  for await (const entry of walk(dir)) {
    if (++walked > MAX_WALKED) break;
    if (entry.isDirectory) continue;
    const lower = entry.relative.toLowerCase();
    if (!lower.includes(needle)) continue;
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    found.push({
      path: entry.relative,
      rank: name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : 2,
    });
  }
  found.sort(
    (a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path),
  );
  return {
    paths: found.slice(0, limit).map((item) => item.path),
    isTruncated: found.length > limit || walked > MAX_WALKED,
  };
}

export interface ContentSearch {
  files: FileContentMatch[];
  matchCount: number;
  filesSearched: number;
  isTruncated: boolean;
}

/** Lines that contain `query` (plain text, any case) in the folder's text files. */
export async function searchFileContents(
  dir: string,
  query: string,
  limit: number,
): Promise<ContentSearch> {
  const needle = query.toLowerCase();
  const startedAt = Date.now();
  const files: FileContentMatch[] = [];
  let matchCount = 0;
  let filesSearched = 0;
  let walked = 0;
  for await (const entry of walk(dir)) {
    if (++walked > MAX_WALKED || Date.now() - startedAt > TIME_LIMIT_MS) {
      return { files, matchCount, filesSearched, isTruncated: true };
    }
    if (entry.isDirectory) continue;
    const stat = await fs.lstat(entry.absolute).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
    const buffer = await fs.readFile(entry.absolute).catch(() => null);
    if (!buffer || isBinary(buffer)) continue;
    filesSearched++;
    const lines = buffer.toString('utf8').split('\n');
    const hits: FileContentMatch['lines'] = [];
    let extra = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? '';
      const at = line.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      if (hits.length >= MAX_LINES_PER_FILE) {
        extra++;
        continue;
      }
      // Long lines: keep a window around the match so it stays visible.
      const from = line.length > MAX_LINE_CHARS ? Math.max(0, at - 60) : 0;
      const text = line.slice(from, from + MAX_LINE_CHARS).replace(/\s+$/, '');
      hits.push({ line: index + 1, text: from > 0 ? `…${text}` : text });
    }
    if (hits.length === 0) continue;
    files.push({ path: entry.relative, lines: hits, moreLines: extra });
    matchCount += hits.length + extra;
    if (matchCount >= limit) return { files, matchCount, filesSearched, isTruncated: true };
  }
  return { files, matchCount, filesSearched, isTruncated: false };
}
