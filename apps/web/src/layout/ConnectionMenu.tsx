import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AppInfo, Workspace } from '@app/shared';
import { Badge } from '../components/Badge';
import { errorMessage } from '../lib/api';
import { useAuth } from '../features/auth/authContext';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GearIcon,
  SignInIcon,
  SignOutIcon,
  SparkIcon,
} from '../lib/icons';
import { usePopover } from '../lib/usePopover';

const ACCOUNT_ITEM =
  'flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] font-medium text-ink-2 transition-colors hover:bg-subtle hover:text-ink';

const APPROVAL_TEXT = {
  ask: 'Asks before each tool that changes something',
  auto: 'Tools that change things run without asking',
  deny: 'Tools that change things are refused',
} as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-3 px-4 py-2">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="min-w-0 text-[13px] text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function SettingsLink({
  to,
  from,
  icon,
  label,
  detail,
  onClick,
}: {
  to: string;
  from: string;
  icon: ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <Link
      to={to}
      state={{ from }}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
    >
      {icon}
      {label}
      <span className="ml-auto text-[12px] font-normal text-ink-3">{detail}</span>
      <ChevronRightIcon size={11} className="text-ink-4" />
    </Link>
  );
}

/**
 * Whether the API is reachable, as a chip in the top bar. It opens a card with how tool
 * approvals are handled, the open workspace's folder, and a link to the models.
 */
export function ConnectionMenu({
  info,
  error,
  workspace,
}: {
  info: AppInfo | null;
  error: unknown;
  workspace: Workspace | null;
}) {
  const { isOpen, setIsOpen, ref } = usePopover<HTMLDivElement>();
  const { pathname } = useLocation();
  const auth = useAuth();
  const isOffline = Boolean(error) && !info;

  const label = isOffline ? 'Offline' : !info ? 'Connecting…' : 'Connected';
  const dot = isOffline ? 'bg-danger-line' : info ? 'bg-success-line' : 'bg-ink-4';

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Server and approvals"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex h-8 min-w-0 max-w-[240px] items-center gap-2 rounded-full border bg-surface pl-2.5 pr-2 text-[13px] transition-colors hover:border-line-strong ${
          isOpen ? 'border-accent' : 'border-line'
        }`}
      >
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="hidden min-w-0 truncate font-medium text-ink sm:inline">{label}</span>
        {info?.approval === 'auto' && (
          <Badge tone="yellow" className="hidden md:inline-flex">
            auto-approve
          </Badge>
        )}
        <ChevronDownIcon
          size={11}
          className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Server and approvals"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(340px,calc(100vw-24px))] rounded-xl border border-line bg-surface shadow-float"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="text-[14px] font-bold text-ink">
              {isOffline ? "Can't reach the server" : info ? 'Connected' : 'Connecting…'}
            </span>
          </div>
          <dl className="py-1.5">
            {isOffline ? (
              <Row label="Error">
                <span className="text-danger">{errorMessage(error)}</span>
              </Row>
            ) : (
              info && (
                <>
                  <Row label="Approvals">
                    <span className="flex flex-col gap-1">
                      <Badge
                        tone={
                          info.approval === 'ask'
                            ? 'blue'
                            : info.approval === 'auto'
                              ? 'yellow'
                              : 'red'
                        }
                        className="self-start"
                      >
                        {info.approval}
                      </Badge>
                      <span className="text-[12px] text-ink-3">{APPROVAL_TEXT[info.approval]}</span>
                    </span>
                  </Row>
                </>
              )
            )}
            {workspace && (
              <Row label="Folder">
                <span className="font-mono text-[12.5px]">{workspace.path}</span>
              </Row>
            )}
          </dl>
          <div className="border-t border-line py-1">
            <SettingsLink
              to="/settings/models"
              from={pathname}
              icon={<SparkIcon size={13} className="text-accent" />}
              label="Models"
              detail="Add, edit, default"
              onClick={() => setIsOpen(false)}
            />
            <SettingsLink
              to="/settings/agent"
              from={pathname}
              icon={<GearIcon size={13} className="text-ink-3" />}
              label="Agent settings"
              detail="Approvals, limits, search"
              onClick={() => setIsOpen(false)}
            />
          </div>
          {auth && (
            <div className="border-t border-line py-1">
              {auth.kind === 'signedIn' ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    void auth.signOut();
                  }}
                  className={ACCOUNT_ITEM}
                >
                  <SignOutIcon size={13} className="text-ink-3" />
                  Sign out
                  <span className="ml-auto min-w-0 truncate text-[12px] font-normal text-ink-3">
                    {auth.user.email}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    auth.signIn();
                  }}
                  className={ACCOUNT_ITEM}
                >
                  <SignInIcon size={13} className="text-ink-3" />
                  Sign in
                  <span className="ml-auto text-[12px] font-normal text-ink-3">Guest</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
