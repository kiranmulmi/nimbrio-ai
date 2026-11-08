import fs from 'node:fs/promises';
import path from 'node:path';
import { defineTool } from '../define.js';
import { assertCanChange } from '../../guardrails.js';
import { locate } from './walk.js';

export const movePath = defineTool<{ from: string; to: string }>({
  name: 'move_path',
  description:
    'Move or rename a file or folder inside the workspace folder. Call this to rename or reorganise files instead of copying and deleting them. Never overwrites: it fails if the destination exists.',
  properties: {
    from: { type: 'string', description: 'Existing file or folder, relative to the workspace.' },
    to: {
      type: 'string',
      description: 'New path, relative to the workspace. Missing folders are created.',
    },
  },
  needsApproval: true,
  async run({ from, to }, ctx) {
    const source = await locate(ctx, from);
    const destination = await locate(ctx, to);
    await assertCanChange(source.root, source.target);
    await assertCanChange(destination.root, destination.target);
    await fs.stat(source.target); // a clear ENOENT if it doesn't exist
    if (await fs.stat(destination.target).catch(() => null)) {
      throw new Error(
        `"${destination.shown}" already exists. Delete it first or pick another name.`,
      );
    }
    if (`${destination.target}${path.sep}`.startsWith(`${source.target}${path.sep}`)) {
      throw new Error("A folder can't be moved into itself.");
    }
    await fs.mkdir(path.dirname(destination.target), { recursive: true });
    await fs.rename(source.target, destination.target);
    return `Moved ${source.shown} to ${destination.shown}.`;
  },
});
