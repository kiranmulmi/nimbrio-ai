import type { AppInfo, Workspace } from '@app/shared';
import { IconButton } from '../components/IconButton';
import { WorkspaceSwitcher } from '../features/workspaces/WorkspaceSwitcher';
import { MenuIcon } from '../lib/icons';
import { BrandLink } from './BrandLink';
import { ConnectionMenu } from './ConnectionMenu';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceSettingsLink } from './WorkspaceSettingsLink';

/**
 * The bar across the top of every page: brand and workspace as a breadcrumb, then the
 * connection, theme and workspace settings. On the chat screen it also opens the chats
 * drawer, and on wide screens it gives way to the sidebar entirely.
 */
export function AppNav({
  workspace,
  workspaces,
  onOpenWorkspaces,
  info,
  infoError,
  isBusy = false,
  chatsToggle,
  hasSidebar = false,
}: {
  workspace: Workspace | null;
  workspaces: Workspace[];
  onOpenWorkspaces: () => void;
  info: AppInfo | null;
  infoError: unknown;
  isBusy?: boolean;
  /** The chat screen's drawer button, shown where the chat list isn't a column. */
  chatsToggle?: { isOpen: boolean; onToggle: () => void };
  /**
   * The chat sidebar carries the brand, workspace switcher, connection, theme and settings,
   * so where the sidebar is a column (xl and up) the bar isn't shown at all.
   */
  hasSidebar?: boolean;
}) {
  return (
    <header
      className={`relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-5 ${
        hasSidebar ? 'xl:hidden' : ''
      }`}
    >
      {chatsToggle && (
        <IconButton
          onClick={chatsToggle.onToggle}
          aria-controls="chat-sidebar"
          aria-expanded={chatsToggle.isOpen}
          aria-label={chatsToggle.isOpen ? 'Hide chats' : 'Show chats'}
          className="-ml-1 xl:hidden"
        >
          <MenuIcon />
        </IconButton>
      )}

      <BrandLink isNameHiddenOnPhone />

      <span aria-hidden className={`shrink-0 select-none text-[20px] font-light text-line-strong`}>
        /
      </span>

      <div className="min-w-0">
        <WorkspaceSwitcher
          current={workspace}
          workspaces={workspaces}
          disabled={isBusy}
          onOpen={onOpenWorkspaces}
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        <ConnectionMenu info={info} error={infoError} workspace={workspace} />
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <ThemeToggle />
        {workspace && <WorkspaceSettingsLink workspace={workspace} isBusy={isBusy} />}
      </div>
    </header>
  );
}
