import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { errorCode, expandHome } from '@app/agent';
import type { FolderCheck, FolderListing } from '@app/shared';
import type { AppContext } from '../../context.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';

/**
 * Folder names on this machine, one level at a time, for choosing where a
 * workspace lives. Only names of folders are returned, never file contents; the
 * API is reachable from this machine only (see middleware/local-only.ts).
 */
export function createFoldersService({ store }: AppContext) {
  return {
    /** Whether a workspace could use the folder (another one may already); nothing is created. */
    async check(requested: string, workspaceId?: string): Promise<FolderCheck> {
      return { problem: await store.folderProblem(requested, workspaceId) };
    },

    async browse(requested?: string): Promise<FolderListing> {
      const home = os.homedir();
      const expanded = expandHome(requested?.trim() || home);
      if (!path.isAbsolute(expanded)) throw new ValidationError('Use an absolute path.');
      const dir = path.resolve(expanded);
      let names: string[];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        names = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
      } catch (error) {
        const code = errorCode(error);
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          throw new NotFoundError(`There is no folder at ${dir}.`);
        }
        if (code === 'EACCES' || code === 'EPERM') {
          throw new ForbiddenError(`You don't have permission to open ${dir}.`);
        }
        throw error;
      }
      const parent = path.dirname(dir);
      return { path: dir, parent: parent === dir ? null : parent, home, folders: names };
    },
  };
}

export type FoldersService = ReturnType<typeof createFoldersService>;
