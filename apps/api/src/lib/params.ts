import type { Request } from 'express';
import { NotFoundError } from './errors.js';

/** A route parameter Express matched; missing only if the route and the handler disagree. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw new NotFoundError();
  return value;
}
