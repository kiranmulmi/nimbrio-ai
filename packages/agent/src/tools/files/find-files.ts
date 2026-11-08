import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { globToRegExp, locate, walk } from './walk.js';

const MAX_RESULTS = 200;

export const findFiles = defineTool<{ pattern: string; path?: string }>({
  name: 'find_files',
  description:
    'Find files in the workspace folder by name or path pattern (a glob such as "*.test.ts", "src/**/*.tsx" or "README*"). Call this when you know roughly what a file is called but not where it is.',
  properties: {
    pattern: {
      type: 'string',
      description:
        'Glob. Without a "/" it matches file names in any folder; "**" spans folders; {a,b} matches either.',
    },
    path: {
      type: 'string',
      description: 'Folder to search in. Default "." (the whole workspace).',
    },
  },
  optional: ['path'],
  async run({ pattern, path: dir = '.' }, ctx) {
    const { target, shown } = await locate(ctx, dir);
    if (!(await fs.stat(target)).isDirectory()) throw new Error(`"${shown}" is not a folder.`);
    const matcher = globToRegExp(pattern);
    const prefix = shown === '.' ? '' : `${shown}/`;
    const found: string[] = [];
    for await (const entry of walk(target)) {
      if (entry.isDirectory || !matcher.test(entry.relative)) continue;
      if (found.length === MAX_RESULTS) {
        found.push(`[Stopped at ${MAX_RESULTS} files. Use a narrower pattern or folder.]`);
        break;
      }
      found.push(`${prefix}${entry.relative}`);
    }
    return found.length ? found.join('\n') : `No files match "${pattern}" in ${shown}/.`;
  },
});
