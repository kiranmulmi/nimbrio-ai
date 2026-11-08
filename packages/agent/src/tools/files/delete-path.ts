import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { assertCanChange } from '../../guardrails.js';
import { locate } from './walk.js';

export const deletePath = defineTool<{ path: string; recursive?: boolean }>({
  name: 'delete_path',
  description:
    'Delete a file or folder in the workspace folder. Call this only when the user wants something removed; it cannot be undone. A folder with contents needs recursive set to true.',
  properties: {
    path: { type: 'string', description: 'File or folder path relative to the workspace folder.' },
    recursive: {
      type: 'boolean',
      description: 'Required to delete a folder that is not empty. Default false.',
    },
  },
  optional: ['recursive'],
  needsApproval: true,
  async run({ path: requested, recursive: isRecursive = false }, ctx) {
    const { root, target, shown } = await locate(ctx, requested);
    await assertCanChange(root, target);
    const stat = await fs.lstat(target);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target);
      if (entries.length > 0 && !isRecursive) {
        throw new Error(
          `"${shown}" is a folder with ${entries.length} entries. Set recursive to true to delete it with everything inside.`,
        );
      }
      await fs.rm(target, { recursive: true });
      return `Deleted folder ${shown}/.`;
    }
    await fs.rm(target);
    return `Deleted ${shown}.`;
  },
});
