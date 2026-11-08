import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { McpOverview } from '@app/shared';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { RefreshIcon, GearIcon, ShieldIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { useAsync } from '../../lib/useAsync';
import { approveMcpConfig, fetchMcpOverview, patchMcpServer, restartMcpServer } from './api';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';
import { McpServerRow } from './McpServerRow';

const ADD_LINK =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-subtle';

/**
 * The MCP tab: the MCP servers turned on in this workspace (chosen in its settings) and
 * their tools. Mounted only while the tab is open, since loading it starts the servers.
 */
export function McpPanel({ workspaceId, isBusy }: { workspaceId: string; isBusy: boolean }) {
  const toast = useToast();
  const { pathname } = useLocation();
  const load = useCallback(() => fetchMcpOverview(workspaceId), [workspaceId]);
  const overview = useAsync(load);
  const [pending, setPending] = useState<string | null>(null);
  const { data, setData, reload } = overview;
  // The workspace form (a popup over this screen) may have turned servers on or off.
  useEffect(() => onWorkspaceSaved(reload), [reload]);

  const save = async (key: string, action: () => Promise<McpOverview>, message: string) => {
    setPending(key);
    try {
      const next = await action();
      setData(() => next);
      toast(message);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change the MCP servers."), 'error');
    } finally {
      setPending(null);
    }
  };

  const chooseServers = (
    <Link
      to={`/workspaces/${encodeURIComponent(workspaceId)}/settings`}
      state={{ from: pathname }}
      title="Turn MCP servers on or off in the workspace settings"
      className={ADD_LINK}
    >
      <GearIcon size={12} /> Choose servers
    </Link>
  );

  // Only the ones on here; the rest are turned on in the workspace settings.
  const servers = (data?.servers ?? []).filter((server) => server.state !== 'disabled');
  const needsReview = data !== null && !data.isTrusted && data.fileError === null;

  return (
    <>
      <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
        <span className="eyebrow">
          {servers.length ? `${plural(servers.length, 'server')} on` : 'MCP servers'}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            onClick={overview.reload}
            disabled={overview.isLoading}
            aria-label="Check the servers again"
            title="Check the servers again"
          >
            {overview.isLoading ? <Spinner size={13} /> : <RefreshIcon />}
          </IconButton>
          {chooseServers}
        </div>
      </div>

      {!data ? (
        overview.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-ink-3">
            <Spinner /> Starting MCP servers…
          </div>
        ) : (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-3 py-2.5 text-[13px] text-danger"
          >
            {errorMessage(overview.error, "Couldn't load the MCP servers.")}
            <Button size="sm" onClick={overview.reload}>
              Try again
            </Button>
          </div>
        )
      ) : (
        <>
          {data.fileError && (
            <div
              role="alert"
              className="mb-3 border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-3.5 py-3 text-[13px]"
            >
              <div className="font-bold text-danger">Can&apos;t read mcp.json</div>
              <p className="mt-1 text-ink-2 [overflow-wrap:anywhere]">{data.fileError}</p>
              <p className="mt-1 text-ink-3">Fix the file, then check the servers again.</p>
            </div>
          )}

          {needsReview && (
            <div className="mb-3 border border-l-[3px] border-line border-l-warn-line bg-warn-bg px-3.5 py-3">
              <div className="flex items-center gap-2 font-bold text-ink">
                <ShieldIcon size={15} className="shrink-0 text-warn" />
                Review these servers before they start
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                mcp.json changed outside this app, or came with the folder. Local servers run
                commands on your computer, so check each one below.
              </p>
              <Button
                size="sm"
                variant="primary"
                className="mt-2.5"
                disabled={isBusy || pending !== null}
                title={isBusy ? 'Wait for the agent to finish' : undefined}
                onClick={() =>
                  void save('approve', () => approveMcpConfig(workspaceId), 'MCP servers approved')
                }
              >
                {pending === 'approve' && <Spinner size={12} />}
                Approve and start
              </Button>
            </div>
          )}

          {servers.length === 0 && !data.fileError ? (
            <div className="border border-dashed border-line px-5 py-8 text-center">
              <div className="font-bold text-ink">No MCP servers on here</div>
              <p className="mx-auto mt-1 max-w-[42ch] text-[13px] leading-relaxed text-ink-3">
                MCP servers give the agent more tools, like GitHub, a database or a browser. Turn
                them on for this workspace in its settings.
              </p>
              <div className="mt-3 flex justify-center">{chooseServers}</div>
            </div>
          ) : (
            <ul className="divide-y divide-line-2">
              {servers.map((server) => (
                <McpServerRow
                  key={server.name}
                  server={server}
                  isBusy={isBusy}
                  pending={pending}
                  onToggle={(isOn) =>
                    void save(
                      `toggle:${server.name}`,
                      () => patchMcpServer(workspaceId, server.name, { enabled: isOn }),
                      isOn ? `${server.name} turned on` : `${server.name} turned off`,
                    )
                  }
                  onRestart={() =>
                    void save(
                      `restart:${server.name}`,
                      () => restartMcpServer(workspaceId, server.name),
                      `${server.name} restarted`,
                    )
                  }
                  onAutoApprove={(tool, isOn) => {
                    const current = server.config.autoApprove ?? [];
                    const autoApprove = isOn
                      ? [...current, tool]
                      : current.filter((name) => name !== tool);
                    void save(
                      `tool:${server.name}`,
                      () => patchMcpServer(workspaceId, server.name, { autoApprove }),
                      isOn ? `${tool} runs without asking` : `${tool} asks before it runs`,
                    );
                  }}
                />
              ))}
            </ul>
          )}

          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            Servers are set up once in{' '}
            <Link
              to="/settings/mcp"
              state={{ from: pathname }}
              className="font-medium text-accent-2 hover:underline"
            >
              Settings → MCP servers
            </Link>
            ; which ones are on here is chosen in the workspace settings and saved in{' '}
            <span className="font-mono [overflow-wrap:anywhere]">{data.file}</span>. Each MCP tool
            asks before it runs unless you turn on Always allow (for that tool everywhere).
          </p>
        </>
      )}
    </>
  );
}
