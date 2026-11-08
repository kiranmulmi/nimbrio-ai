import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { locate, walk } from './walk.js';

const MAX_ENTRIES = 400;

export const listFiles = defineTool<{ path?: string; depth?: number }>({
  name: 'list_files',
  description:
    "List the files and folders in the workspace folder as an indented tree. Call this to get your bearings in a project or before reading a file whose exact name you don't know. Generated folders such as node_modules and .git are shown but not opened.",
  properties: {
    path: {
      type: 'string',
      description: 'Folder to list, relative to the workspace folder. Default "." (the root).',
    },
    depth: {
      type: 'integer',
      description: 'How many levels of subfolders to show, 1 to 6. Default 2.',
    },
  },
  optional: ['path', 'depth'],
  async run({ path: dir = '.', depth = 2 }, ctx) {
    const { target, shown } = await locate(ctx, dir);
    if (!(await fs.stat(target)).isDirectory()) {
      throw new Error(`"${shown}" is a file; use read_file instead.`);
    }
    const lines: string[] = [];
    for await (const entry of walk(target, { maxDepth: Math.min(Math.max(depth, 1), 6) })) {
      if (lines.length === MAX_ENTRIES) {
        lines.push(`[Stopped at ${MAX_ENTRIES} entries. List a subfolder or use a smaller depth.]`);
        break;
      }
      const name = entry.relative.split('/').pop() ?? entry.relative;
      const suffix = entry.isDirectory ? (entry.isSkipped ? '/ (not opened)' : '/') : '';
      lines.push(`${'  '.repeat(entry.depth - 1)}${name}${suffix}`);
    }
    return lines.length ? `${shown}/\n${lines.join('\n')}` : `${shown}/ is empty.`;
  },
});
