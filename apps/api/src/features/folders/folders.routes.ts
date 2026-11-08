import { Router } from 'express';
import {
  folderCheckQuerySchema,
  folderPickSchema,
  folderQuerySchema,
  type FolderPick,
} from '@app/shared';
import { ConflictError } from '../../lib/errors.js';
import { pickFolderWithSystemDialog } from './folder-dialog.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { parse } from '../../lib/validate.js';
import type { FoldersService } from './folders.service.js';

export function foldersRouter(folders: FoldersService): Router {
  const router = Router();

  router.get(
    '/folders',
    asyncHandler(async (req, res) => {
      const { path } = parse(folderQuerySchema, req.query);
      res.json({ data: await folders.browse(path) });
    }),
  );

  router.get(
    '/folders/check',
    asyncHandler(async (req, res) => {
      const { path, workspaceId } = parse(folderCheckQuerySchema, req.query);
      res.json({ data: await folders.check(path, workspaceId) });
    }),
  );

  /** Opens the system's folder dialog and waits for the user's choice (null: cancelled). */
  router.post(
    '/folders/pick',
    asyncHandler(async (req, res) => {
      const { startAt } = parse(folderPickSchema, req.body);
      const result = await pickFolderWithSystemDialog(startAt);
      if (result.isBusy) throw new ConflictError('A folder window is already open.');
      const data: FolderPick = { path: result.path, isSupported: result.isSupported };
      res.json({ data });
    }),
  );

  return router;
}
