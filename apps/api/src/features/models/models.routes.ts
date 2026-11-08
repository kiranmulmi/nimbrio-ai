import { Router } from 'express';
import { modelInputSchema, modelUpdateSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { ModelsService } from './models.service.js';

export function modelsRouter(models: ModelsService): Router {
  const router = Router();

  router.get(
    '/models',
    asyncHandler(async (_req, res) => {
      res.json({ data: await models.list() });
    }),
  );

  router.post(
    '/models',
    asyncHandler(async (req, res) => {
      const input = parse(modelInputSchema, req.body);
      res.status(201).json({ data: await models.create(input) });
    }),
  );

  router.get(
    '/models/:modelId',
    asyncHandler(async (req, res) => {
      res.json({ data: await models.get(param(req, 'modelId')) });
    }),
  );

  router.put(
    '/models/:modelId',
    asyncHandler(async (req, res) => {
      const changes = parse(modelUpdateSchema, req.body);
      res.json({ data: await models.update(param(req, 'modelId'), changes) });
    }),
  );

  router.post(
    '/models/:modelId/default',
    asyncHandler(async (req, res) => {
      res.json({ data: await models.makeDefault(param(req, 'modelId')) });
    }),
  );

  router.delete(
    '/models/:modelId',
    asyncHandler(async (req, res) => {
      await models.remove(param(req, 'modelId'));
      res.status(204).end();
    }),
  );

  return router;
}
