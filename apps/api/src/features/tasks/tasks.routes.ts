import { Router } from 'express';
import { taskStartSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { TasksService } from './tasks.service.js';

/** The Tasks tab: the workspace's running background tasks, starting one, its output, stopping it. */
export function tasksRouter(tasks: TasksService): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/tasks',
    asyncHandler(async (req, res) => {
      res.json({ data: await tasks.listRunning(param(req, 'workspaceId')) });
    }),
  );

  router.post(
    '/workspaces/:workspaceId/tasks',
    asyncHandler(async (req, res) => {
      const input = parse(taskStartSchema, req.body);
      res.status(201).json({ data: await tasks.start(param(req, 'workspaceId'), input) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId/tasks/:taskId',
    asyncHandler(async (req, res) => {
      res.json({ data: await tasks.get(param(req, 'workspaceId'), param(req, 'taskId')) });
    }),
  );

  router.delete(
    '/workspaces/:workspaceId/tasks/:taskId',
    asyncHandler(async (req, res) => {
      await tasks.stop(param(req, 'workspaceId'), param(req, 'taskId'));
      res.status(204).end();
    }),
  );

  return router;
}
