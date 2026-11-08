import { Link, useLocation } from 'react-router-dom';
import type { ApprovalMode } from '@app/shared';
import { Badge } from '../../components/Badge';
import { GearIcon } from '../../lib/icons';

/**
 * The footer's Preferences: opens the app settings (Models, MCP servers, Agent) in a popup.
 * When approvals aren't "ask", a badge beside it says so, since that changes what the agent
 * may do without asking.
 */
export function PreferencesLink({ approval }: { approval: ApprovalMode | null }) {
  const { pathname } = useLocation();
  return (
    <>
      {approval === 'auto' ? (
        <Badge tone="yellow">auto-approve</Badge>
      ) : approval === 'deny' ? (
        <Badge tone="red">refuse</Badge>
      ) : null}
      <Link
        to="/settings/models"
        state={{ from: pathname }}
        title="Models, MCP servers and agent settings"
        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <GearIcon size={14} />
        Preferences
      </Link>
    </>
  );
}
