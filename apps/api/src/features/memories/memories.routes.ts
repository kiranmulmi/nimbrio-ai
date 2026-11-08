import { Router } from 'express';
import type { MemoryRemoval } from '@app/shared';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

export function memoriesRouter({ store }: AppContext, workspaces: WorkspacesService): Router {
  const router = Router();

  const memoryOf = async (workspaceId: string) => {
    const workspace = await workspaces.require(workspaceId);
    return store.memory(workspace);
  };

  router.get(
    '/workspaces/:workspaceId/memories',
    asyncHandler(async (req, res) => {
      const memory = await memoryOf(param(req, 'workspaceId'));
      res.json({ data: await memory.all() });
    }),
  );

  router.delete(
    '/workspaces/:workspaceId/memories',
    asyncHandler(async (req, res) => {
      const memory = await memoryOf(param(req, 'workspaceId'));
      const removed = await memory.clear();
      const data: MemoryRemoval = { removed: removed.length, memories: await memory.all() };
      res.json({ data });
    }),
  );

  router.delete(
    '/workspaces/:workspaceId/memories/:memoryId',
    asyncHandler(async (req, res) => {
      const memory = await memoryOf(param(req, 'workspaceId'));
      const removed = await memory.remove([param(req, 'memoryId')]);
      const data: MemoryRemoval = { removed: removed.length, memories: await memory.all() };
      res.json({ data });
    }),
  );

  return router;
}
