import { earlierPlansOf, historyForUi, type Chat } from '@app/db';
import type { ChatDetail, ChatSummary } from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

export function createChatsService({ store, runs }: AppContext, workspaces: WorkspacesService) {
  const summarize = (chat: Chat): ChatSummary => ({
    id: chat.id,
    workspaceId: chat.workspaceId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    isRunning: runs.isRunning(chat.id),
  });

  /** A chat, optionally checked to belong to a workspace. */
  async function require(id: string, workspaceId?: string): Promise<Chat> {
    const chat = await store.getChat(id);
    if (!chat || (workspaceId && chat.workspaceId !== workspaceId)) {
      throw new NotFoundError("That chat doesn't exist in this workspace.");
    }
    return chat;
  }

  return {
    require,
    summarize,

    async list(workspaceId: string): Promise<ChatSummary[]> {
      await workspaces.require(workspaceId);
      return (await store.listChats(workspaceId)).map(summarize);
    },

    async get(id: string): Promise<ChatDetail> {
      const chat = await require(id);
      const [rows, runRecords] = await Promise.all([store.loadMessages(id), store.loadRuns(id)]);
      return {
        chat: summarize(chat),
        history: historyForUi(rows, runRecords),
        plan: chat.plan,
        earlierPlans: earlierPlansOf(chat, rows),
      };
    },

    async rename(id: string, title: string): Promise<ChatSummary> {
      await require(id);
      const renamed = await store.renameChat(id, title);
      if (!renamed) throw new NotFoundError("That chat doesn't exist.");
      return summarize(renamed);
    },

    async remove(id: string): Promise<void> {
      await require(id);
      if (runs.isRunning(id))
        throw new ConflictError('Wait for the agent to finish in this chat first.');
      await store.deleteChat(id);
    },
  };
}

export type ChatsService = ReturnType<typeof createChatsService>;
