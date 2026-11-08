import { Router } from 'express';
import { workspaceInputSchema, workspaceUpdateSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { WorkspacesService } from './workspaces.service.js';

export function workspacesRouter(workspaces: WorkspacesService): Router {
  const router = Router();

  router.get(
    '/workspaces',
    asyncHandler(async (_req, res) => {
      res.json({ data: await workspaces.list() });
    }),
  );

  router.post(
    '/workspaces',
    asyncHandler(async (req, res) => {
      const input = parse(workspaceInputSchema, req.body);
      res.status(201).json({ data: await workspaces.create(input) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId',
    asyncHandler(async (req, res) => {
      res.json({ data: await workspaces.get(param(req, 'workspaceId')) });
    }),
  );

  router.patch(
    '/workspaces/:workspaceId',
    asyncHandler(async (req, res) => {
      const changes = parse(workspaceUpdateSchema, req.body);
      res.json({ data: await workspaces.update(param(req, 'workspaceId'), changes) });
    }),
  );

  router.delete(
    '/workspaces/:workspaceId',
    asyncHandler(async (req, res) => {
      res.json({ data: await workspaces.remove(param(req, 'workspaceId')) });
    }),
  );

  return router;
}
