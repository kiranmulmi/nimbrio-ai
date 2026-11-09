import { Router, type RequestHandler } from 'express';
import type { AuthUser } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import type { AuthService } from './auth.service.js';

/** Open to everyone: whether to sign in, and the public values the web app's client needs. */
export function authConfigRouter(auth: AuthService): Router {
  const router = Router();
  router.get('/auth/config', (_req, res) => {
    res.json({ data: auth.config });
  });
  return router;
}

/**
 * Checks who a request is signed in as, from its `Authorization: Bearer <access token>`, and
 * keeps the user in `res.locals.user`. Every /v1 route after this needs a signed-in user when
 * sign-in is required; when it's only offered, a request without a token is a guest's (null).
 */
export function requireUser(auth: AuthService): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    res.locals.user = await auth.userFor(req.headers.authorization);
    next();
  });
}

/** Who this request is signed in as; null when sign-in is off or for a guest. */
export function authRouter(): Router {
  const router = Router();
  router.get('/auth/me', (_req, res) => {
    const user = (res.locals.user ?? null) as AuthUser | null;
    res.json({ data: user });
  });
  return router;
}
