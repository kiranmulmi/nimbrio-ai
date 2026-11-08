import { Router } from 'express';
import {
  approvalDecisionSchema,
  runChangeSchema,
  runRequestSchema,
  steerRequestSchema,
  type StreamEvent,
} from '@app/shared';
import type { RunRegistry } from './run-registry.js';
import type { RunsService } from './runs.service.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { NotFoundError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';

export function runsRouter(runsService: RunsService, registry: RunRegistry): Router {
  const router = Router();

  /** Runs one prompt and streams its progress as server-sent events, one JSON StreamEvent per frame. */
  router.post(
    '/runs',
    asyncHandler(async (req, res) => {
      const stream = await runsService.prepare(parse(runRequestSchema, req.body));

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      let isOpen = true;
      const closeCallbacks: Array<() => void> = [];
      res.on('close', () => {
        isOpen = false;
        for (const callback of closeCallbacks) callback();
      });

      await stream({
        send: (event: StreamEvent) => {
          if (isOpen) res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        onClose: (callback) => closeCallbacks.push(callback),
      });
      res.end();
    }),
  );

  /** Stops the chat's run; the stream then ends with a `stopped` result. */
  router.post('/chats/:chatId/stop', (req, res, next) => {
    try {
      if (!registry.stop(param(req, 'chatId'))) {
        throw new NotFoundError('That chat has no run in progress.');
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  /** A message for the chat's run in progress, read by the agent before its next step. */
  router.post('/chats/:chatId/run/messages', (req, res, next) => {
    try {
      const { message } = parse(steerRequestSchema, req.body);
      res.status(202).json({ data: runsService.steer(param(req, 'chatId'), message) });
    } catch (error) {
      next(error);
    }
  });

  /** Turns Auto-approve on or off for the chat's run in progress (the composer's toggle). */
  router.patch('/chats/:chatId/run', (req, res, next) => {
    try {
      const { autoApprove } = parse(runChangeSchema, req.body);
      if (!registry.setAutoApprove(param(req, 'chatId'), autoApprove)) {
        throw new NotFoundError('That chat has no run in progress.');
      }
      res.json({ data: { autoApprove } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/approvals/:approvalId', (req, res, next) => {
    try {
      const { allow } = parse(approvalDecisionSchema, req.body);
      if (!registry.settle(param(req, 'approvalId'), allow)) {
        throw new NotFoundError('That approval request is no longer waiting.');
      }
      res.json({ data: { allowed: allow } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
