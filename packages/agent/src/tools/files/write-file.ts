import fs from 'node:fs/promises';
import path from 'node:path';
import { defineTool } from '../define.js';
import { assertCanChange } from '../../guardrails.js';
import { locate } from './walk.js';

export const writeFile = defineTool<{ path: string; content: string }>({
  name: 'write_file',
  description:
    'Create a file in the workspace folder, or replace one completely. Call this for new files or full rewrites; to change part of an existing file, use edit_file instead.',
  properties: {
    path: {
      type: 'string',
      description: 'File path relative to the workspace folder. Missing folders are created.',
    },
    content: { type: 'string', description: 'The complete file contents.' },
  },
  needsApproval: true,
  async run({ path: file, content }, ctx) {
    const { root, target, shown } = await locate(ctx, file);
    await assertCanChange(root, target);
    const existing = await fs.stat(target).catch(() => null);
    if (existing?.isDirectory()) throw new Error(`"${shown}" is a folder.`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return `${existing ? 'Replaced' : 'Created'} ${shown} (${Buffer.byteLength(content)} bytes).`;
  },
});
