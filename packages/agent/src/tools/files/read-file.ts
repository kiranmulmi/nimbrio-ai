import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { isBinary, locate } from './walk.js';

const MAX_FILE_BYTES = 5_000_000;
/** Kept under the tool output limit, so a long file is cut at a line, with a note. */
const MAX_CHARS = 18_000;

export const readFile = defineTool<{ path: string; start_line?: number; end_line?: number }>({
  name: 'read_file',
  description:
    'Read a text file in the workspace folder. Call this when you need what a file says, and before changing part of it. Long files come back in parts with line numbers in the header; ask for the next part with start_line.',
  properties: {
    path: { type: 'string', description: 'File path relative to the workspace folder.' },
    start_line: { type: 'integer', description: 'First line to read (1-based). Default 1.' },
    end_line: {
      type: 'integer',
      description: 'Last line to read, inclusive. Default: as far as fits.',
    },
  },
  optional: ['start_line', 'end_line'],
  async run({ path: file, start_line: startLine, end_line: endLine }, ctx) {
    const { target, shown } = await locate(ctx, file);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new Error(`"${shown}" is a folder; use list_files instead.`);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `"${shown}" is ${stat.size} bytes, too large to read. Use search_files to find the part you need.`,
      );
    }
    const buffer = await fs.readFile(target);
    if (isBinary(buffer)) return `"${shown}" is a binary file (${stat.size} bytes).`;

    const lines = buffer.toString('utf8').split('\n');
    const first = Math.max(startLine ?? 1, 1);
    if (first > lines.length) {
      throw new Error(`"${shown}" has ${lines.length} lines; start_line ${first} is past the end.`);
    }
    const last = Math.min(endLine ?? lines.length, lines.length);
    const shownLines: string[] = [];
    let chars = 0;
    for (let i = first - 1; i < last; i += 1) {
      const line = lines[i] ?? '';
      if (chars + line.length > MAX_CHARS && shownLines.length > 0) break;
      shownLines.push(line);
      chars += line.length + 1;
    }
    const until = first + shownLines.length - 1;
    const text = shownLines.join('\n');
    if (first === 1 && until === lines.length) return text;
    const more = until < lines.length ? ` Continue with start_line ${until + 1}.` : '';
    return `[${shown}: lines ${first}-${until} of ${lines.length}.${more}]\n${text}`;
  },
});
