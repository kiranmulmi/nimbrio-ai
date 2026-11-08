import type { NextFunction, Request, Response } from 'express';
import { ALLOWED_HOSTS } from '../config/env.js';
import { ForbiddenError, UnsupportedMediaTypeError } from '../lib/errors.js';

/** Only answer requests addressed to this machine, which blocks DNS-rebinding tricks. */
export function localHostOnly(req: Request, _res: Response, next: NextFunction): void {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  next(ALLOWED_HOSTS.has(host) ? undefined : new ForbiddenError('Forbidden host.'));
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** Requiring JSON on writes blocks plain HTML form posts from other websites. */
export function requireJson(req: Request, _res: Response, next: NextFunction): void {
  const isJson = req.headers['content-type']?.startsWith('application/json') ?? false;
  next(BODY_METHODS.has(req.method) && !isJson ? new UnsupportedMediaTypeError() : undefined);
}
