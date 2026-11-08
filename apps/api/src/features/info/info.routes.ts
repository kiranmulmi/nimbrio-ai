import { Router } from 'express';
import type { AppInfo } from '@app/shared';
import type { AppContext } from '../../context.js';

export function infoRouter({ settings }: AppContext): Router {
  const router = Router();

  router.get('/info', (_req, res) => {
    const data: AppInfo = { approval: settings.current.approval };
    res.json({ data });
  });

  return router;
}
