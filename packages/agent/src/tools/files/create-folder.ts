import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { assertCanChange } from '../../guardrails.js';
import { locate } from './walk.js';

export const createFolder = defineTool<{ path: string }>({
  name: 'create_folder',
  description:
    'Create a folder (and any missing parent folders) in the workspace folder. Call this only for empty folders; write_file creates the folders a new file needs by itself.',
  properties: {
    path: { type: 'string', description: 'Folder path relative to the workspace folder.' },
  },
  needsApproval: true,
  async run({ path: dir }, ctx) {
    const { root, target, shown } = await locate(ctx, dir);
    await assertCanChange(root, target);
    const existing = await fs.stat(target).catch(() => null);
    if (existing) {
      throw new Error(
        `"${shown}" already exists as a ${existing.isDirectory() ? 'folder' : 'file'}.`,
      );
    }
    await fs.mkdir(target, { recursive: true });
    return `Created folder ${shown}/.`;
  },
});
