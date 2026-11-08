import { Router } from 'express';
import { agentSettingsSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { parse } from '../../lib/validate.js';
import type { AppSettings } from './app-settings.js';

export function settingsRouter(settings: AppSettings): Router {
  const router = Router();

  router.get('/settings', (_req, res) => {
    res.json({ data: settings.current });
  });

  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      res.json({ data: await settings.save(parse(agentSettingsSchema, req.body)) });
    }),
  );

  return router;
}
