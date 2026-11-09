import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import type { ProvidersService } from './providers.service.js';

/** Settings → Model providers: who is signed in, and Cursor's browser sign-in. */
export function providersRouter(providers: ProvidersService): Router {
  const router = Router();

  router.get(
    '/providers',
    asyncHandler(async (_req, res) => {
      res.json({ data: await providers.list() });
    }),
  );

  router.delete(
    '/providers/cursor',
    asyncHandler(async (_req, res) => {
      await providers.signOutCursor();
      res.status(204).end();
    }),
  );

  router.get(
    '/providers/cursor/models',
    asyncHandler(async (_req, res) => {
      res.json({ data: await providers.cursorModels() });
    }),
  );

  router.post('/providers/cursor/logins', (_req, res) => {
    res.status(201).json({ data: providers.startCursorLogin() });
  });

  router.get(
    '/providers/cursor/logins/:loginId',
    asyncHandler(async (req, res) => {
      res.json({ data: await providers.cursorLoginStatus(param(req, 'loginId')) });
    }),
  );

  router.delete('/providers/cursor/logins/:loginId', (req, res) => {
    providers.cancelCursorLogin(param(req, 'loginId'));
    res.status(204).end();
  });

  return router;
}
