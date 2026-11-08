import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, type ChatSummary } from '@app/shared';
import { timeAgo } from '../../lib/format';
import { ChatIcon, EditIcon, TrashIcon } from '../../lib/icons';

const ACTION =
  'grid h-6 w-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink';

/** One saved chat: click to open, double-click or ✎ to rename, trash to delete. */
export function ChatListItem({
  chat,
  workspaceId,
  isActive,
  isRunning,
  isLocked,
  onRename,
  onDelete,
}: {
  chat: ChatSummary;
  workspaceId: string;
  isActive: boolean;
  isRunning: boolean;
  /** Another chat is running in this tab, so this one can't be opened yet. */
  isLocked: boolean;
  onRename: (chat: ChatSummary, title: string) => Promise<void>;
  onDelete: (chat: ChatSummary) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const finishRename = (save: boolean) => {
    if (draft === null) return;
    const title = draft.trim();
    setDraft(null);
    if (save && title && title !== chat.title) void onRename(chat, title);
  };

  if (draft !== null) {
    return (
      <li className="px-2">
        <input
          autoFocus
          value={draft}
          maxLength={LIMITS.chatTitle}
          aria-label="Chat name"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => finishRename(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finishRename(true);
            if (event.key === 'Escape') finishRename(false);
          }}
          className="w-full rounded-lg border border-accent bg-surface px-2.5 py-[6px] text-[13px] outline-none ring-2 ring-accent-bg"
        />
      </li>
    );
  }

  const content = (
    <>
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        {isRunning ? (
          <span role="img" aria-label="Working" className="live-dot" />
        ) : (
          <ChatIcon
            size={15}
            className={`transition-colors ${isActive ? 'text-accent' : 'text-ink-4 group-hover:text-ink-3'}`}
          />
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
        {chat.title}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-4 group-focus-within:hidden group-hover:hidden [@media(hover:none)]:hidden">
        {timeAgo(chat.updatedAt ?? chat.createdAt)}
      </span>
    </>
  );
  const rowClass =
    'flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-4 pr-2 text-left text-[13px] outline-none';

  return (
    <li
      className={`group relative mx-3 flex items-center rounded-r-xl transition-colors has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus ${
        isActive
          ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent'
          : 'text-ink-2 hover:bg-subtle hover:text-ink'
      }`}
    >
      {isLocked && !isActive ? (
        <span
          title="Wait for the agent to finish"
          className={`${rowClass} cursor-not-allowed opacity-55`}
        >
          {content}
        </span>
      ) : (
        <Link
          to={`/workspaces/${workspaceId}/chats/${chat.id}`}
          title={chat.title}
          aria-current={isActive ? 'page' : undefined}
          onDoubleClick={(event) => {
            event.preventDefault();
            setDraft(chat.title);
          }}
          className={rowClass}
        >
          {content}
        </Link>
      )}
      <span className="hidden shrink-0 gap-0.5 pr-1 group-focus-within:flex group-hover:flex [@media(hover:none)]:flex">
        <button
          type="button"
          title="Rename"
          aria-label={`Rename ${chat.title}`}
          onClick={() => setDraft(chat.title)}
          className={ACTION}
        >
          <EditIcon size={12} />
        </button>
        <button
          type="button"
          title="Delete chat"
          aria-label={`Delete ${chat.title}`}
          onClick={() => onDelete(chat)}
          className={`${ACTION} hover:!bg-danger-bg hover:!text-danger`}
        >
          <TrashIcon size={12} />
        </button>
      </span>
    </li>
  );
}
