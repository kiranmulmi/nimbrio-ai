import { Router } from 'express';
import { mcpEnabledSchema, mcpServerInputSchema, mcpServerPatchSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { McpService } from './mcp.service.js';

export function mcpRouter(mcp: McpService): Router {
  const router = Router();

  // ---------- The app's servers (Settings -> MCP servers) ----------

  router.get(
    '/mcp/servers',
    asyncHandler(async (_req, res) => {
      res.json({ data: await mcp.list() });
    }),
  );

  router.post(
    '/mcp/servers',
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: await mcp.add(parse(mcpServerInputSchema, req.body)) });
    }),
  );

  router.get(
    '/mcp/servers/:name',
    asyncHandler(async (req, res) => {
      res.json({ data: await mcp.get(param(req, 'name')) });
    }),
  );

  router.put(
    '/mcp/servers/:name',
    asyncHandler(async (req, res) => {
      const input = parse(mcpServerInputSchema, req.body);
      res.json({ data: await mcp.replace(param(req, 'name'), input) });
    }),
  );

  router.delete(
    '/mcp/servers/:name',
    asyncHandler(async (req, res) => {
      await mcp.remove(param(req, 'name'));
      res.status(204).end();
    }),
  );

  // ---------- One workspace: which servers are on, their tools ----------

  const base = '/workspaces/:workspaceId/mcp';

  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json({ data: await mcp.overview(param(req, 'workspaceId')) });
    }),
  );

  router.get(
    `${base}/enabled`,
    asyncHandler(async (req, res) => {
      res.json({ data: await mcp.enabled(param(req, 'workspaceId')) });
    }),
  );

  router.put(
    `${base}/enabled`,
    asyncHandler(async (req, res) => {
      const { enabled } = parse(mcpEnabledSchema, req.body);
      res.json({ data: await mcp.setEnabled(param(req, 'workspaceId'), enabled) });
    }),
  );

  router.patch(
    `${base}/servers/:name`,
    asyncHandler(async (req, res) => {
      const patch = parse(mcpServerPatchSchema, req.body);
      res.json({ data: await mcp.patch(param(req, 'workspaceId'), param(req, 'name'), patch) });
    }),
  );

  router.post(
    `${base}/servers/:name/restart`,
    asyncHandler(async (req, res) => {
      res.json({ data: await mcp.restart(param(req, 'workspaceId'), param(req, 'name')) });
    }),
  );

  router.post(
    `${base}/approve`,
    asyncHandler(async (req, res) => {
      res.json({ data: await mcp.approve(param(req, 'workspaceId')) });
    }),
  );

  return router;
}
