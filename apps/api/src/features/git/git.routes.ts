import { Router } from 'express';
import { gitDiffQuerySchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { GitService } from './git.service.js';

/** The Git diff tab: what changed in the workspace's folder since the last commit. */
export function gitRouter(git: GitService): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/git',
    asyncHandler(async (req, res) => {
      res.json({ data: await git.changes(param(req, 'workspaceId')) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId/git/diff',
    asyncHandler(async (req, res) => {
      const { path } = parse(gitDiffQuerySchema, req.query);
      res.json({ data: await git.diff(param(req, 'workspaceId'), path) });
    }),
  );

  return router;
}
