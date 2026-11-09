import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AppInfo } from '@app/shared';
import { errorMessage } from '../../lib/api';
import { GearIcon, InstallIcon, PlusIcon, WarnIcon } from '../../lib/icons';
import { useInstallApp } from '../../lib/installApp';
import { useToast } from '../../lib/toast';

const ROW = 'flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium text-ink-2';

function SidebarLink({
  to,
  icon,
  label,
  isBusy,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  /** the agent is working: the page waits until it's done */
  isBusy: boolean;
}) {
  const { pathname } = useLocation();
  const iconBox = (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2">
      {icon}
    </span>
  );
  if (isBusy) {
    return (
      <span title="Wait for the agent to finish" className={`${ROW} cursor-not-allowed opacity-50`}>
        {iconBox}
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  }
  return (
    <Link
      to={to}
      state={{ from: pathname }}
      className={`${ROW} transition-colors hover:bg-subtle hover:text-ink`}
    >
      {iconBox}
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

/**
 * The bottom of the chats sidebar: the open workspace's settings, New workspace, and Install app while Chrome
 * offers it. A warning takes the top when the server can't be reached. The app-wide settings
 * (models, MCP servers, agent) open from Preferences in the footer; who is signed in, and Sign
 * out, are in `AccountMenu` below the workspace switcher.
 */
export function SidebarLinks({
  info,
  error,
  workspaceId,
  isBusy,
}: {
  info: AppInfo | null;
  error: unknown;
  workspaceId: string;
  isBusy: boolean;
}) {
  const isOffline = Boolean(error) && !info;
  const { canInstall, install } = useInstallApp();
  const toast = useToast();
  return (
    <div className="shrink-0 px-3 pb-2 pt-3">
      {isOffline && (
        <p
          role="alert"
          title={errorMessage(error)}
          className="mb-2 flex items-center gap-2 rounded-xl border border-danger-line bg-danger-bg px-3 py-2 text-[12.5px] font-medium text-danger"
        >
          <WarnIcon size={13} className="shrink-0" />
          Can&apos;t reach the server
        </p>
      )}
      <span className="block px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-4">
        Settings
      </span>
      <SidebarLink
        to={`/workspaces/${workspaceId}/settings`}
        icon={<GearIcon size={12} />}
        label="Workspace settings"
        isBusy={isBusy}
      />
      <SidebarLink
        to="/workspaces/new"
        icon={<PlusIcon size={12} />}
        label="New workspace"
        isBusy={isBusy}
      />
      {/* Only while Chrome offers it: gone once installed, and inside the installed app. */}
      {canInstall && (
        <button
          type="button"
          onClick={() => {
            void install().then((isInstalled) => {
              if (isInstalled) toast('Installed. Open Nimbrio AI from your apps.');
            });
          }}
          title="Open Nimbrio AI in its own window, from your dock or start menu"
          className={`${ROW} w-full text-left transition-colors hover:bg-subtle hover:text-ink`}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent text-on-accent">
            <InstallIcon size={12} />
          </span>
          Install app
        </button>
      )}
    </div>
  );
}
