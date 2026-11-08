import { Router } from 'express';
import { skillInputSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { SkillsService } from './skills.service.js';

export function skillsRouter(skills: SkillsService): Router {
  const router = Router();
  const base = '/workspaces/:workspaceId/skills';

  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json({ data: await skills.list(param(req, 'workspaceId')) });
    }),
  );

  router.post(
    base,
    asyncHandler(async (req, res) => {
      const input = parse(skillInputSchema, req.body);
      res.status(201).json({ data: await skills.create(param(req, 'workspaceId'), input) });
    }),
  );

  router.get(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      res.json({ data: await skills.get(param(req, 'workspaceId'), param(req, 'name')) });
    }),
  );

  /** Saves the skill; a different `name` in the body renames it (409 if that name is taken). */
  router.put(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      const input = parse(skillInputSchema, req.body);
      const skill = await skills.update(param(req, 'workspaceId'), param(req, 'name'), input);
      res.json({ data: skill });
    }),
  );

  router.delete(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      await skills.remove(param(req, 'workspaceId'), param(req, 'name'));
      res.status(204).end();
    }),
  );

  return router;
}
