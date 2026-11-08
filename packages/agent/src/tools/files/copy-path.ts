import fs from 'node:fs/promises';
import path from 'node:path';
import { defineTool } from '../define.js';
import { assertCanChange } from '../../guardrails.js';
import { locate } from './walk.js';

export const copyPath = defineTool<{ from: string; to: string }>({
  name: 'copy_path',
  description:
    'Copy a file or a whole folder to a new path inside the workspace folder. Call this to duplicate something as a starting point. Never overwrites: it fails if the destination exists.',
  properties: {
    from: { type: 'string', description: 'Existing file or folder, relative to the workspace.' },
    to: { type: 'string', description: 'Path of the copy, relative to the workspace.' },
  },
  needsApproval: true,
  async run({ from, to }, ctx) {
    const source = await locate(ctx, from);
    const destination = await locate(ctx, to);
    await assertCanChange(destination.root, destination.target);
    const stat = await fs.stat(source.target);
    if (await fs.stat(destination.target).catch(() => null)) {
      throw new Error(`"${destination.shown}" already exists. Pick another path.`);
    }
    if (`${destination.target}${path.sep}`.startsWith(`${source.target}${path.sep}`)) {
      throw new Error("A folder can't be copied into itself.");
    }
    await fs.mkdir(path.dirname(destination.target), { recursive: true });
    // Links are copied as links, so a copy can't pull in files from outside the workspace.
    await fs.cp(source.target, destination.target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    return `Copied ${stat.isDirectory() ? 'folder ' : ''}${source.shown} to ${destination.shown}.`;
  },
});
