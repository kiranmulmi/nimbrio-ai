import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { errorMessage } from '../../errors.js';
import { globToRegExp, isBinary, locate, walk } from './walk.js';

const MAX_MATCHES = 150;
const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_CHARS = 200;

interface SearchInput {
  query: string;
  path?: string;
  glob?: string;
  is_regex?: boolean;
  case_sensitive?: boolean;
}

export const searchFiles = defineTool<SearchInput>({
  name: 'search_files',
  description:
    'Search the contents of text files in the workspace folder, like grep. Returns "path:line: text" for each matching line. Call this to find where something is defined or used before reading whole files.',
  properties: {
    query: { type: 'string', description: 'Text to look for, or a regular expression.' },
    path: { type: 'string', description: 'Folder or file to search. Default "." (everything).' },
    glob: {
      type: 'string',
      description: 'Only search files matching this glob, e.g. "*.ts" or "src/**/*.css".',
    },
    is_regex: {
      type: 'boolean',
      description: 'Treat query as a regular expression. Default false.',
    },
    case_sensitive: { type: 'boolean', description: 'Match case exactly. Default false.' },
  },
  optional: ['path', 'glob', 'is_regex', 'case_sensitive'],
  async run(
    { query, path: where = '.', glob, is_regex: isRegex, case_sensitive: isCaseSensitive },
    ctx,
  ) {
    if (!query) throw new Error('Say what to search for.');
    let matcher: RegExp;
    try {
      const source = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matcher = new RegExp(source, isCaseSensitive ? '' : 'i');
    } catch (error) {
      throw new Error(`Invalid regular expression: ${errorMessage(error)}`, { cause: error });
    }
    const fileFilter = glob ? globToRegExp(glob) : null;
    const { target, shown } = await locate(ctx, where);
    const isFolder = (await fs.stat(target)).isDirectory();
    const prefix = !isFolder || shown === '.' ? '' : `${shown}/`;

    const files = isFolder
      ? walk(target)
      : (async function* () {
          yield { relative: shown, absolute: target, isDirectory: false };
        })();
    const matches: string[] = [];
    let filesSearched = 0;
    for await (const entry of files) {
      if (entry.isDirectory || (fileFilter && !fileFilter.test(entry.relative))) continue;
      const stat = await fs.stat(entry.absolute).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const buffer = await fs.readFile(entry.absolute).catch(() => null);
      if (!buffer || isBinary(buffer)) continue;
      filesSearched += 1;
      const lines = buffer.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (!matcher.test(line)) continue;
        if (matches.length === MAX_MATCHES) {
          matches.push(`[Stopped at ${MAX_MATCHES} matches. Narrow the query, folder or glob.]`);
          return matches.join('\n');
        }
        const text = line.trim();
        const cut = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text;
        matches.push(`${prefix}${entry.relative}:${i + 1}: ${cut}`);
      }
    }
    return matches.length
      ? matches.join('\n')
      : `No matches for "${query}" in ${filesSearched} file(s) under ${shown}.`;
  },
});
