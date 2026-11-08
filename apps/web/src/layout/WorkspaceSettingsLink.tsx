import { Link, useLocation, useMatch } from 'react-router-dom';
import type { Workspace } from '@app/shared';
import { GearIcon } from '../lib/icons';

const BASE =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed';

/** The gear that opens the workspace's settings, or closes them when they're open. */
export function WorkspaceSettingsLink({
  workspace,
  isBusy,
}: {
  workspace: Workspace;
  isBusy: boolean;
}) {
  const isSettings = useMatch('/workspaces/:workspaceId/settings') !== null;
  const { pathname } = useLocation();

  if (isBusy && !isSettings) {
    return (
      <span
        title="Wait for the agent to finish"
        className={`${BASE} cursor-not-allowed text-ink-2 opacity-50`}
      >
        <GearIcon size={16} />
      </span>
    );
  }
  return (
    <Link
      to={isSettings ? `/workspaces/${workspace.id}` : `/workspaces/${workspace.id}/settings`}
      state={isSettings ? undefined : { from: pathname }}
      aria-label={isSettings ? 'Close workspace settings' : 'Workspace settings'}
      aria-current={isSettings ? 'page' : undefined}
      title={isSettings ? 'Back to the chat' : 'Workspace settings'}
      className={`${BASE} ${
        isSettings ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      <GearIcon size={16} />
    </Link>
  );
}
