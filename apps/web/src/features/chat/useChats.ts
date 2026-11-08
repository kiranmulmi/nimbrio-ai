import { useCallback } from 'react';
import type { ChatSummary } from '@app/shared';
import { useAsync } from '../../lib/useAsync';
import { fetchChats } from './api';

/** The workspace's chats, newest first, with local updates for what this tab just did. */
export function useChats(workspaceId: string) {
  const load = useCallback(() => fetchChats(workspaceId), [workspaceId]);
  const resource = useAsync(load);
  const { setData } = resource;

  /** Puts a chat at the top of the list, or updates it in place if it's already there. */
  const upsert = useCallback(
    (chat: ChatSummary) =>
      setData((list) => {
        const current = list ?? [];
        return current.some((item) => item.id === chat.id)
          ? current.map((item) => (item.id === chat.id ? { ...item, ...chat } : item))
          : [chat, ...current];
      }),
    [setData],
  );

  const remove = useCallback(
    (chatId: string) => setData((list) => (list ?? []).filter((item) => item.id !== chatId)),
    [setData],
  );

  return { ...resource, upsert, remove };
}
