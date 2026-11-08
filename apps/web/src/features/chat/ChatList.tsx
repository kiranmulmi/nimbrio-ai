import { useCallback, useMemo, useState } from 'react';
import type { ChatSummary } from '@app/shared';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { errorMessage } from '../../lib/api';
import { ChatIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { deleteChat, renameChat } from './api';
import { groupChatsByDay } from './chatGroups';
import { ChatListItem } from './ChatListItem';

const SHIMMER =
  'block animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--line-2)_50%,var(--surface-2)_100%)] bg-[length:200%_100%] motion-reduce:animate-none';

/** The workspace's saved chats grouped by day, filtered by `query`, with rename and delete. */
export function ChatList({
  workspaceId,
  chats,
  query,
  error,
  activeChatId,
  isBusy,
  onRenamed,
  onDeleted,
}: {
  workspaceId: string;
  chats: ChatSummary[] | null;
  query: string;
  error: unknown;
  activeChatId: string | null;
  isBusy: boolean;
  onRenamed: (chat: ChatSummary) => void;
  onDeleted: (chatId: string) => void;
}) {
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const rename = async (chat: ChatSummary, title: string) => {
    try {
      onRenamed(await renameChat(chat.id, title));
      toast('Chat renamed');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't rename the chat."), 'error');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteChat(pendingDelete.id);
      onDeleted(pendingDelete.id);
      toast('Chat deleted');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the chat."), 'error');
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matching = needle
      ? (chats ?? []).filter((chat) => chat.title.toLowerCase().includes(needle))
      : (chats ?? []);
    return groupChatsByDay(matching);
  }, [chats, needle]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pt-1">
        {error && !chats ? (
          <p
            role="alert"
            className="mx-2.5 mt-2 border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-3 py-2 text-[13px] text-danger"
          >
            {errorMessage(error, "Couldn't load the chats.")}
          </p>
        ) : null}

        {!chats && !error && (
          <div aria-hidden className="flex flex-col gap-3.5 px-4 pt-4">
            <span className={`${SHIMMER} h-2.5 w-14`} />
            {[78, 62, 70].map((width) => (
              <span key={width} className="flex items-center gap-2.5">
                <span className={`${SHIMMER} h-4 w-4 shrink-0`} />
                <span className={`${SHIMMER} h-3`} style={{ width: `${width}%` }} />
              </span>
            ))}
          </div>
        )}

        {chats && chats.length === 0 && (
          <div className="flex flex-col items-center px-6 pt-10 text-center">
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink-3">
              <ChatIcon size={18} />
            </span>
            <p className="text-[13px] font-medium text-ink">No chats yet</p>
            <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
              Your conversations in this workspace are saved here.
            </p>
          </div>
        )}

        {chats && chats.length > 0 && groups.length === 0 && (
          <p className="px-4 pt-4 text-[13px] leading-snug text-ink-3">
            No chats match <span className="font-medium text-ink-2">“{query.trim()}”</span>.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="pt-3">
            <h2 className="px-7 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-4">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.chats.map((chat) => {
                const isActive = chat.id === activeChatId;
                return (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    workspaceId={workspaceId}
                    isActive={isActive}
                    isRunning={chat.isRunning || (isBusy && isActive)}
                    isLocked={isBusy}
                    onRename={rename}
                    onDelete={setPendingDelete}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        title="Delete this chat?"
        message={
          <>
            <strong className="text-ink">{pendingDelete?.title}</strong> and its messages and plan
            are deleted. The workspace's memories and files stay.
          </>
        }
        busy={isDeleting}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
