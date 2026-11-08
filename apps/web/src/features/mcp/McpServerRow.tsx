import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { McpServerState, McpServerStatus } from '@app/shared';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { plural } from '../../lib/format';
import { ChevronRightIcon, EditIcon, RefreshIcon } from '../../lib/icons';

const STATE: Record<McpServerState, { dot: string; label: string; tone: BadgeTone }> = {
  connected: { dot: 'bg-success-line', label: 'Running', tone: 'green' },
  error: { dot: 'bg-danger-line', label: "Didn't start", tone: 'red' },
  disabled: { dot: 'bg-ink-4', label: 'Off', tone: 'grey' },
  untrusted: { dot: 'bg-warn-line', label: 'Needs review', tone: 'yellow' },
};

const TRANSPORT_LABEL = { stdio: 'Local', http: 'HTTP', sse: 'SSE' } as const;

const BUSY_TITLE = 'Wait for the agent to finish';

/** Small row actions: shown on hover or focus (always on touch screens). */
const ACTION =
  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed [@media(hover:none)]:opacity-100';

/** What starts the server: its command line, or its URL. */
function launchLine(server: McpServerStatus): string {
  if (server.transport !== 'stdio') return server.config.url ?? '';
  return [server.config.command ?? '', ...(server.config.args ?? [])].join(' ');
}

/**
 * One MCP server as a single line: status dot, name, on/off. How it starts is in the
 * tooltip (shown in full while it needs review); its tools and "Always allow" fold open.
 */
export function McpServerRow({
  server,
  isBusy,
  pending,
  onToggle,
  onRestart,
  onAutoApprove,
}: {
  server: McpServerStatus;
  /** the agent is working in this workspace: changes wait */
  isBusy: boolean;
  /** the change being saved right now, if any */
  pending: string | null;
  onToggle: (isOn: boolean) => void;
  onRestart: () => void;
  onAutoApprove: (tool: string, isOn: boolean) => void;
}) {
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const state = STATE[server.state];
  const isOn = server.state !== 'disabled';
  const isLocked = isBusy || pending !== null;
  const line = launchLine(server);
  const allowedCount = server.tools.filter((tool) => tool.isAutoApproved).length;
  const canRestart = server.state === 'connected' || server.state === 'error';
  const needsReview = server.state === 'untrusted';
  const hasTools = server.tools.length > 0;
  // Running and Off show in the dot and the switch; only states that need you get a badge.
  const showsBadge = server.state === 'error' || needsReview;
  // Variables can change what a command does (NODE_OPTIONS, PATH...), so a review shows them;
  // header values are usually tokens, so only their names.
  const envLines = [
    ...Object.entries(server.config.env ?? {}).map(([key, value]) => `env ${key}=${value}`),
    ...Object.keys(server.config.headers ?? {}).map((key) => `header ${key}: …`),
  ];
  const toolsTitle = `${plural(server.tools.length, 'tool')} · ${
    allowedCount ? `${allowedCount} always allowed` : 'each asks before it runs'
  }`;

  return (
    <li>
      <div className="group flex min-h-9 items-center gap-2 px-1 py-1 transition-colors hover:bg-subtle">
        <span
          aria-hidden
          title={state.label}
          className={`ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${state.dot}`}
        />
        <span
          className="min-w-0 truncate font-mono text-[12.5px] text-ink"
          title={`${state.label} · ${TRANSPORT_LABEL[server.transport]} · ${line}`}
        >
          {server.name}
        </span>
        {showsBadge && <Badge tone={state.tone}>{state.label}</Badge>}
        {hasTools && (
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            title={toolsTitle}
            className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] tabular-nums text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronRightIcon
              size={9}
              className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
            {server.tools.length}
          </button>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {canRestart && (
            <button
              type="button"
              onClick={onRestart}
              disabled={isLocked}
              aria-label={`Restart ${server.name}`}
              title={isBusy ? BUSY_TITLE : 'Restart the server'}
              className={ACTION}
            >
              {pending === `restart:${server.name}` ? (
                <Spinner size={11} />
              ) : (
                <RefreshIcon size={12} />
              )}
            </button>
          )}
          {isBusy ? (
            <span title={BUSY_TITLE} className={`${ACTION} cursor-not-allowed`}>
              <EditIcon size={12} />
            </span>
          ) : (
            <Link
              to={`/settings/mcp/${encodeURIComponent(server.name)}/edit`}
              state={{ from: pathname }}
              aria-label={`Edit ${server.name}`}
              title="Edit"
              className={ACTION}
            >
              <EditIcon size={12} />
            </Link>
          )}
          <span className="ml-1">
            <Switch
              isOn={isOn}
              onChange={onToggle}
              disabled={isLocked}
              label={isOn ? `Turn ${server.name} off` : `Turn ${server.name} on`}
              title={isBusy ? BUSY_TITLE : undefined}
            />
          </span>
        </span>
      </div>

      {needsReview && (
        // Under review, show everything that decides what runs: no truncation.
        <dl className="flex flex-col gap-0.5 pb-2 pl-5 pr-2 font-mono text-[11.5px] text-ink-2 [overflow-wrap:anywhere]">
          <dd>{line}</dd>
          {envLines.map((entry) => (
            <dd key={entry} className="text-ink-3">
              {entry}
            </dd>
          ))}
        </dl>
      )}

      {server.error && (
        <pre className="mb-2 ml-5 mr-1 max-h-24 overflow-auto whitespace-pre-wrap border-l-[3px] border-l-danger-line bg-danger-bg px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-danger [overflow-wrap:anywhere]">
          {server.error}
        </pre>
      )}

      {hasTools && isOpen && (
        <div className="pb-1.5 pl-5 pr-1">
          <div className="flex items-center justify-between py-1 text-[11px] text-ink-3">
            <span>{toolsTitle}</span>
            <span>Always allow</span>
          </div>
          <ul>
            {server.tools.map((tool) => (
              <li
                key={tool.name}
                className="flex items-center gap-2 py-1"
                title={tool.description || undefined}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
                  {tool.name}
                </span>
                <Switch
                  isOn={tool.isAutoApproved}
                  onChange={(next) => onAutoApprove(tool.name, next)}
                  disabled={isLocked}
                  label={`Always allow ${tool.name}`}
                  title={
                    isBusy
                      ? BUSY_TITLE
                      : tool.isAutoApproved
                        ? 'Runs without asking'
                        : 'Asks before each run'
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
