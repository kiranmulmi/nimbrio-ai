import { Router } from 'express';
import type { TerminalTicket } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import type { TerminalService } from './terminal.service.js';

export function terminalRouter(terminals: TerminalService): Router {
  const router = Router();

  /** A one-time ticket to open the workspace's terminal over the WebSocket. */
  router.post(
    '/workspaces/:workspaceId/terminal',
    asyncHandler(async (req, res) => {
      const data: TerminalTicket = await terminals.ticket(param(req, 'workspaceId'));
      res.status(201).json({ data });
    }),
  );

  /** Stop the workspace's shell (Restart opens a new one). */
  router.delete('/workspaces/:workspaceId/terminal', (req, res) => {
    terminals.kill(param(req, 'workspaceId'));
    res.status(204).end();
  });

  return router;
}
