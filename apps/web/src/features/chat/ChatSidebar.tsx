import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { AppInfo, ChatSummary, Workspace } from '@app/shared';
import { IconButton } from '../../components/IconButton';
import { BrandLink } from '../../layout/BrandLink';
import {
  ChevronRightIcon,
  ComposeIcon,
  CrossIcon,
  FolderTintIcon,
  PanelIcon,
  SearchIcon,
} from '../../lib/icons';
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher';
import { ChatList } from './ChatList';
import { AccountMenu } from '../auth/AccountMenu';
import { SidebarLinks } from './SidebarLinks';
import { SidebarResizer } from './SidebarResizer';
import type { useSidebarWidth } from './useSidebarWidth';

/**
 * The workspace's full folder path on one line after a folder icon, its folders split by
 * chevrons. When it's wider
 * than the sidebar it scrolls sideways (no scrollbar), starting at the end so the workspace's
 * own folder shows; a fade marks the side with more.
 */
function WorkspacePath({ path }: { path: string }) {
  const folders = path.split(/[\\/]/).filter(Boolean);
  const [edges, setEdges] = useState({ hasMoreBefore: false, hasMoreAfter: false });
  const readEdges = useCallback((node: HTMLElement) => {
    const max = node.scrollWidth - node.clientWidth;
    setEdges({ hasMoreBefore: node.scrollLeft > 1, hasMoreAfter: node.scrollLeft < max - 1 });
  }, []);
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
    readEdges(node);
  }, [path, readEdges]);

  const fade = [
    edges.hasMoreBefore ? 'transparent, black 20px' : 'black',
    edges.hasMoreAfter ? 'black calc(100% - 20px), transparent' : 'black',
  ].join(', ');

  return (
    <div title={path} className="mt-1.5 flex min-w-0 items-center gap-1">
      {/* Outside the scrolling part, so it stays put. */}
      <FolderTintIcon size={12} className="shrink-0 text-accent" />
      <div
        ref={scroller}
        onScroll={(event) => readEdges(event.currentTarget)}
        style={{ maskImage: `linear-gradient(to right, ${fade})` }}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[11px] leading-snug tracking-tighter text-ink-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {folders.map((folder, index) => {
          const isLast = index === folders.length - 1;
          return (
            <span key={index} className="flex shrink-0 items-center gap-0.5">
              <span className={isLast ? 'font-medium text-ink-2' : ''}>{folder}</span>
              {!isLast && <ChevronRightIcon size={7} className="shrink-0 text-ink-4" />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The brand, the open workspace's name, new chat, search and the workspace's chats, with the
 * settings links and the workspace switcher at the bottom: a column on wide screens
 * (collapsible, sliding away as its column shrinks), a drawer on small ones.
 */
export function ChatSidebar({
  isOpen,
  isCollapsed,
  onCollapse,
  onClose,
  width,
  workspaceId,
  workspace,
  workspaces,
  onOpenWorkspaces,
  info,
  infoError,
  chats,
  chatsError,
  activeChatId,
  isBusy,
  onNewChat,
  onRenamed,
  onDeleted,
}: {
  isOpen: boolean;
  /** wide screens: hidden, its column at 0 (ChatScreen) */
  isCollapsed: boolean;
  onCollapse: () => void;
  onClose: () => void;
  width: ReturnType<typeof useSidebarWidth>;
  workspaceId: string;
  workspace: Workspace | null;
  workspaces: Workspace[];
  onOpenWorkspaces: () => void;
  info: AppInfo | null;
  infoError: unknown;
  chats: ChatSummary[] | null;
  chatsError: unknown;
  activeChatId: string | null;
  isBusy: boolean;
  onNewChat: () => void;
  onRenamed: (chat: ChatSummary) => void;
  onDeleted: (chatId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const hasChats = chats !== null && chats.length > 0;

  return (
    <>
      {isOpen && (
        <div aria-hidden onClick={onClose} className="fixed inset-0 z-30 bg-overlay xl:hidden" />
      )}
      <nav
        id="chat-sidebar"
        aria-label="Chats"
        className={`fixed inset-y-0 left-0 z-40 flex min-h-0 w-[min(300px,86vw)] flex-col border-r border-line bg-surface shadow-dialog transition-[transform,visibility,opacity] duration-300 xl:relative xl:z-10 xl:w-auto xl:translate-x-0 xl:overflow-hidden xl:border-line-2 xl:shadow-none xl:[&>*:not([role=separator])]:min-w-[var(--sidebar-w)] ${
          isOpen ? 'translate-x-0' : '-translate-x-full max-xl:invisible'
        } ${isCollapsed ? 'xl:invisible xl:opacity-0' : ''}`}
      >
        <SidebarResizer width={width.width} onResize={width.setWidth} onReset={width.reset} />
        <div className="titlebar flex h-12 shrink-0 items-center gap-1 border-b border-line pl-[calc(1rem+var(--titlebar-inset))] pr-2">
          <BrandLink />
          <IconButton onClick={onClose} aria-label="Hide chats" className="ml-auto xl:hidden">
            <ChevronRightIcon size={12} className="rotate-180" />
          </IconButton>
          <IconButton
            onClick={onCollapse}
            aria-label="Collapse the sidebar"
            title="Collapse the sidebar"
            className="ml-auto hidden xl:grid"
          >
            <PanelIcon size={15} className="-scale-x-100" />
          </IconButton>
        </div>

        <div className="flex shrink-0 flex-col gap-2 px-3 pt-4">
          {workspace && (
            // Where you are: plain text on the sidebar's background, no card.
            <div title={workspace.path} className="mb-1 flex min-w-0 items-center px-3 py-1">
              <span className="flex min-w-0 flex-col leading-tight">
                <h2 className="truncate text-[14.5px] font-extrabold tracking-tight text-ink">
                  {workspace.name}
                </h2>
                <WorkspacePath path={workspace.path} />
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onNewChat}
            disabled={isBusy}
            title={isBusy ? 'Wait for the agent to finish' : 'Start a new chat'}
            className="flex h-9 w-full items-center gap-2.5 rounded-xl bg-accent-soft px-3 text-[13px] font-semibold text-accent-2 transition-colors hover:bg-accent-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ComposeIcon size={14} />
            New chat
          </button>
        </div>

        {hasChats && (
          <div className="shrink-0 px-3 pt-1">
            <label className="group/search relative flex items-center">
              <span className="sr-only">Search chats</span>
              <SearchIcon
                size={14}
                className="pointer-events-none absolute left-3 text-ink-3 transition-colors group-focus-within/search:text-accent"
              />
              <input
                type="search"
                value={query}
                placeholder="Search chats"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setQuery('');
                }}
                className="h-9 w-full rounded-xl border border-transparent bg-transparent pl-[34px] pr-7 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:bg-subtle focus:border-line focus:bg-surface [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 grid h-5 w-5 place-items-center rounded text-ink-3 hover:text-ink"
                >
                  <CrossIcon size={11} />
                </button>
              )}
            </label>
          </div>
        )}

        <ChatList
          workspaceId={workspaceId}
          chats={chats}
          query={query}
          error={chatsError}
          activeChatId={activeChatId}
          isBusy={isBusy}
          onRenamed={onRenamed}
          onDeleted={onDeleted}
        />

        <SidebarLinks info={info} error={infoError} workspaceId={workspaceId} isBusy={isBusy} />

        <div className="shrink-0">
          <WorkspaceSwitcher
            variant="sidebar"
            opensUp
            current={workspace}
            workspaces={workspaces}
            disabled={isBusy}
            onOpen={onOpenWorkspaces}
          />
        </div>

        <AccountMenu />
      </nav>
    </>
  );
}
