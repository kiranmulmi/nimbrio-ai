import { Router } from 'express';
import { chatRenameSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { ChatsService } from './chats.service.js';

export function chatsRouter(chats: ChatsService): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/chats',
    asyncHandler(async (req, res) => {
      res.json({ data: await chats.list(param(req, 'workspaceId')) });
    }),
  );

  router.get(
    '/chats/:chatId',
    asyncHandler(async (req, res) => {
      res.json({ data: await chats.get(param(req, 'chatId')) });
    }),
  );

  router.patch(
    '/chats/:chatId',
    asyncHandler(async (req, res) => {
      const { title } = parse(chatRenameSchema, req.body);
      res.json({ data: await chats.rename(param(req, 'chatId'), title) });
    }),
  );

  router.delete(
    '/chats/:chatId',
    asyncHandler(async (req, res) => {
      await chats.remove(param(req, 'chatId'));
      res.status(204).end();
    }),
  );

  return router;
}
