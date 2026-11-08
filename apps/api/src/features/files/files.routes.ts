import { Router } from 'express';
import {
  fileContentQuerySchema,
  fileCreateSchema,
  fileDeleteQuerySchema,
  fileRenameSchema,
  fileSearchQuerySchema,
  fileWriteSchema,
} from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { FilesService } from './files.service.js';

export function filesRouter(files: FilesService): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/files',
    asyncHandler(async (req, res) => {
      res.json({ data: await files.list(param(req, 'workspaceId')) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId/files/search',
    asyncHandler(async (req, res) => {
      const { q, mode } = parse(fileSearchQuerySchema, req.query);
      res.json({ data: await files.search(param(req, 'workspaceId'), q, mode) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId/files/content',
    asyncHandler(async (req, res) => {
      const { path } = parse(fileContentQuerySchema, req.query);
      res.json({ data: await files.read(param(req, 'workspaceId'), path) });
    }),
  );

  /** The user saves a file edited in the preview (not the agent: no approval step). */
  router.put(
    '/workspaces/:workspaceId/files/content',
    asyncHandler(async (req, res) => {
      const input = parse(fileWriteSchema, req.body);
      res.json({ data: await files.write(param(req, 'workspaceId'), input) });
    }),
  );

  /** The user creates an empty file or folder from the Files tab. */
  router.post(
    '/workspaces/:workspaceId/files',
    asyncHandler(async (req, res) => {
      const input = parse(fileCreateSchema, req.body);
      res.status(201).json({ data: await files.create(param(req, 'workspaceId'), input) });
    }),
  );

  /** The user renames or moves a file or folder from the Files tab. */
  router.patch(
    '/workspaces/:workspaceId/files',
    asyncHandler(async (req, res) => {
      const input = parse(fileRenameSchema, req.body);
      res.json({ data: await files.rename(param(req, 'workspaceId'), input) });
    }),
  );

  /** The user deletes a file or folder from the Files tab (after confirming in the app). */
  router.delete(
    '/workspaces/:workspaceId/files',
    asyncHandler(async (req, res) => {
      const { path } = parse(fileDeleteQuerySchema, req.query);
      await files.remove(param(req, 'workspaceId'), path);
      res.status(204).end();
    }),
  );

  return router;
}
