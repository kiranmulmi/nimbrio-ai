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
 * Every /v1 route after this needs a signed-in user (when sign-in is on): the request's
 * `Authorization: Bearer <access token>`. The user is kept in `res.locals.user`.
 */
export function requireUser(auth: AuthService): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    res.locals.user = await auth.userFor(req.headers.authorization);
    next();
  });
}

/** Who this request is signed in as; null when sign-in is off. */
export function authRouter(): Router {
  const router = Router();
  router.get('/auth/me', (_req, res) => {
    const user = (res.locals.user ?? null) as AuthUser | null;
    res.json({ data: user });
  });
  return router;
}
