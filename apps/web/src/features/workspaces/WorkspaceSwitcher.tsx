import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Workspace } from '@app/shared';
import {
  CheckIcon,
  ChevronDownIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
  SwitchIcon,
} from '../../lib/icons';
import { usePopover } from '../../lib/usePopover';
import { WorkspaceAvatar } from './WorkspaceAvatar';

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle';

const activity = (workspace: Workspace): number =>
  Date.parse(workspace.lastActiveAt ?? workspace.updatedAt ?? workspace.createdAt ?? '') || 0;

/** Most recently active first (a chat used, else the workspace edited); ties by name. */
function byRecentActivity(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => activity(b) - activity(a) || a.name.localeCompare(b.name));
}

/**
 * The menu's search box over the workspaces it matches (by name or folder). It lives inside
 * the open menu, so the query clears each time the menu closes. Enter opens the first match.
 */
function WorkspaceOptions({
  current,
  workspaces,
  onPick,
}: {
  current: Workspace | null;
  workspaces: Workspace[];
  onPick: () => void;
}) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const needle = query.trim().toLowerCase();
  const sorted = useMemo(() => byRecentActivity(workspaces), [workspaces]);
  const matches = needle
    ? sorted.filter(
        (workspace) =>
          workspace.name.toLowerCase().includes(needle) ||
          workspace.path.toLowerCase().includes(needle),
      )
    : sorted;

  return (
    <>
      <div className="shrink-0 border-b border-line-2 p-2">
        <label className="group/search relative flex items-center">
          <span className="sr-only">Search workspaces</span>
          <SearchIcon
            size={14}
            className="pointer-events-none absolute left-2.5 text-ink-3 transition-colors group-focus-within/search:text-accent"
          />
          <input
            type="search"
            value={query}
            placeholder="Search workspaces"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !matches[0]) return;
              event.preventDefault();
              onPick();
              navigate(`/workspaces/${matches[0].id}`);
            }}
            className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>
      {/* Only the list scrolls; the search box and the actions below stay put. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
        <p className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
          {needle ? `${matches.length} of ${workspaces.length}` : 'Workspaces'}
        </p>
        {matches.length === 0 && (
          <p className="px-2 py-2 text-[12.5px] text-ink-3">No workspaces match “{query.trim()}”</p>
        )}
        {matches.map((workspace) => {
          const isCurrent = workspace.id === current?.id;
          return (
            <Link
              key={workspace.id}
              to={`/workspaces/${workspace.id}`}
              role="menuitemradio"
              aria-checked={isCurrent}
              onClick={onPick}
              title={workspace.path}
              className={`${ITEM} ${isCurrent ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2'}`}
            >
              <WorkspaceAvatar id={workspace.id} name={workspace.name} size="sm" />
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {isCurrent ? (
                <CheckIcon size={14} className="shrink-0 text-accent" aria-label="Current" />
              ) : workspace.chatCount ? (
                <span
                  title={`${workspace.chatCount} chat${workspace.chatCount === 1 ? '' : 's'}`}
                  className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] font-medium leading-5 tabular-nums text-ink-3"
                >
                  {workspace.chatCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </>
  );
}

/**
 * A menu to switch to another workspace or make a new one. `breadcrumb` sits in the top bar
 * and shows the current workspace; `sidebar` fills the chat sidebar's width as a "Switch
 * workspace" button (the sidebar's top names the workspace), and at its foot opens upward
 * (`opensUp`).
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
  disabled,
  onOpen,
  variant = 'breadcrumb',
  opensUp = false,
}: {
  current: Workspace | null;
  workspaces: Workspace[];
  disabled: boolean;
  onOpen: () => void;
  variant?: 'breadcrumb' | 'sidebar';
  /** the menu opens above the button (it sits at the bottom of the screen) */
  opensUp?: boolean;
}) {
  const isSidebar = variant === 'sidebar';
  const { isOpen, setIsOpen, ref } = usePopover<HTMLDivElement>();
  const { pathname } = useLocation();

  useEffect(() => setIsOpen(false), [pathname, setIsOpen]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    );
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        title={
          disabled ? 'Wait for the agent to finish' : isSidebar ? current?.name : current?.path
        }
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          if (!isOpen) onOpen();
          setIsOpen(!isOpen);
        }}
        className={`flex min-w-0 items-center text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isSidebar
            ? // Edge to edge across the sidebar's foot, with no border of its own.
              `h-14 w-full gap-2.5 px-4 ${isOpen ? 'bg-subtle' : 'hover:bg-subtle'}`
            : `h-9 max-w-[260px] gap-2 rounded-lg px-2 hover:bg-surface-2 ${isOpen ? 'bg-surface-2' : ''}`
        }`}
      >
        {isSidebar ? (
          // The sidebar's top already names the workspace, so this is just the action.
          <>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <SwitchIcon size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
              Switch workspace
            </span>
          </>
        ) : (
          <>
            {current ? (
              <WorkspaceAvatar id={current.id} name={current.name} size="sm" />
            ) : (
              <span className="h-6 w-6 shrink-0 rounded-md bg-surface-2" />
            )}
            <span className="min-w-0 truncate text-[14px] font-medium text-ink">
              {current?.name ?? 'Workspaces'}
            </span>
          </>
        )}
        <ChevronDownIcon
          size={12}
          className={`shrink-0 text-ink-3 transition-transform ${isOpen !== opensUp ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Workspaces"
          onKeyDown={onMenuKeyDown}
          className={`absolute z-30 flex max-h-[min(560px,70vh)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float ${
            isSidebar
              ? // A floating card inset from the sidebar's edges, just above (or below) the button.
                `inset-x-2 ${opensUp ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'}`
              : 'left-0 top-[calc(100%+6px)] w-[min(300px,calc(100vw-24px))]'
          }`}
        >
          <WorkspaceOptions
            current={current}
            workspaces={workspaces}
            onPick={() => setIsOpen(false)}
          />
          {/* The sidebar has these in its Settings section; the top bar's menu keeps them. */}
          {!isSidebar && (
            <div className="shrink-0 border-t border-line-2 p-1.5">
              {current && (
                <Link
                  to={`/workspaces/${current.id}/settings`}
                  state={{ from: pathname }}
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                  className={`${ITEM} text-ink-2`}
                >
                  <span className="grid h-6 w-6 place-items-center text-ink-3">
                    <GearIcon size={14} />
                  </span>
                  Workspace settings
                </Link>
              )}
              <Link
                to="/workspaces/new"
                state={{ from: pathname }}
                role="menuitem"
                onClick={() => setIsOpen(false)}
                className={`${ITEM} font-medium text-accent`}
              >
                <span className="grid h-6 w-6 place-items-center rounded-md bg-accent-soft">
                  <PlusIcon size={12} />
                </span>
                New workspace
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
