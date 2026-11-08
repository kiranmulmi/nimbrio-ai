import type { NextFunction, Request, Response } from 'express';
import { errorEnvelope } from '@app/shared';
import { InputError } from '@app/db';
import { HttpError } from '../lib/errors.js';
import { logger } from '../logger.js';

/** Errors thrown by express.json() for bad or oversized bodies. */
function bodyParserStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('type' in err)) return null;
  if (err.type === 'entity.parse.failed') return 400;
  if (err.type === 'entity.too.large') return 413;
  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    logger.error({ err, path: req.path }, 'request failed after the response started');
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json(errorEnvelope(err.code, err.message));
    return;
  }
  if (err instanceof InputError) {
    res.status(400).json(errorEnvelope('VALIDATION_ERROR', err.message));
    return;
  }
  const bodyStatus = bodyParserStatus(err);
  if (bodyStatus === 400) {
    res.status(400).json(errorEnvelope('VALIDATION_ERROR', 'Invalid JSON.'));
    return;
  }
  if (bodyStatus === 413) {
    res.status(413).json(errorEnvelope('PAYLOAD_TOO_LARGE', 'Request too large.'));
    return;
  }
  logger.error({ err, method: req.method, path: req.path }, 'request failed');
  res.status(500).json(errorEnvelope('INTERNAL_ERROR', 'Something went wrong'));
}
