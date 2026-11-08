import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalClientMessage, TerminalServerMessage } from '@app/shared';
import { Spinner } from '../../../components/Spinner';
import { errorMessage } from '../../../lib/api';
import { RefreshIcon, TrashIcon } from '../../../lib/icons';
import { fetchTerminalTicket, stopTerminal, terminalSocketUrl } from './api';

type XtermModule = typeof import('./xterm');
type Status = 'connecting' | 'open' | 'exited' | 'closed' | 'error';

/** The terminal's colours from the app's theme (light or dark), read from its CSS variables. */
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v('--surface'),
    foreground: v('--ink'),
    cursor: v('--accent'),
    cursorAccent: v('--surface'),
    selectionBackground: v('--selection'),
  };
}

const TOOL =
  'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50';

/**
 * The workspace's integrated terminal: a real shell started in its folder. The shell keeps
 * running when the tab is closed; opening it again reattaches and shows the recent output.
 */
export function TerminalPanel({ workspaceId }: { workspaceId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [cwd, setCwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const xterm = useRef<{
    term: InstanceType<XtermModule['Terminal']>;
    fit: InstanceType<XtermModule['FitAddon']>;
  } | null>(null);

  const send = (message: TerminalClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  };

  useEffect(() => {
    let isCurrent = true;
    const cleanups: Array<() => void> = [];
    setStatus('connecting');
    setError(null);

    void (async () => {
      const lib = await import('./xterm');
      if (!isCurrent || !host.current) return;
      const term = new lib.Terminal({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: 1.25,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: false,
        theme: themeColors(),
      });
      const fit = new lib.FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      fit.fit();
      xterm.current = { term, fit };
      cleanups.push(() => {
        term.dispose();
        xterm.current = null;
      });

      // Follow the app's light/dark switch.
      const themeWatch = new MutationObserver(() => {
        term.options.theme = themeColors();
      });
      themeWatch.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      cleanups.push(() => themeWatch.disconnect());

      // Fit the terminal to the panel, and tell the shell its new size.
      const resizeWatch = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // Hidden (the panel is collapsed): keep the last size.
        }
      });
      resizeWatch.observe(host.current);
      cleanups.push(() => resizeWatch.disconnect());
      const onResize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
      const onInput = term.onData((data) => send({ type: 'input', data }));
      cleanups.push(() => {
        onResize.dispose();
        onInput.dispose();
      });

      try {
        const { ticket, cwd: folder } = await fetchTerminalTicket(workspaceId);
        if (!isCurrent) return;
        setCwd(folder);
        const ws = new WebSocket(terminalSocketUrl(ticket, term.cols, term.rows));
        socket.current = ws;
        cleanups.push(() => {
          ws.onclose = null;
          ws.close();
          socket.current = null;
        });
        ws.onmessage = (event: MessageEvent<string>) => {
          let message: TerminalServerMessage;
          try {
            message = JSON.parse(event.data) as TerminalServerMessage;
          } catch {
            return;
          }
          if (message.type === 'ready') {
            setCwd(message.cwd);
            setStatus('open');
            term.focus();
          } else if (message.type === 'output') {
            term.write(message.data);
          } else {
            setStatus('exited');
            term.write(
              `\r\n\x1b[2m[The shell exited with code ${message.code}. Restart to open a new one.]\x1b[0m\r\n`,
            );
          }
        };
        ws.onclose = () => {
          if (isCurrent) setStatus((current) => (current === 'exited' ? current : 'closed'));
        };
      } catch (cause) {
        if (!isCurrent) return;
        setStatus('error');
        setError(errorMessage(cause, "Couldn't open the terminal."));
      }
    })();

    return () => {
      isCurrent = false;
      cleanups.reverse().forEach((cleanup) => cleanup());
    };
  }, [workspaceId, attempt]);

  const restart = useCallback(() => {
    void stopTerminal(workspaceId)
      .catch(() => undefined)
      .then(() => setAttempt((n) => n + 1));
  }, [workspaceId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-2 px-3">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            status === 'open'
              ? 'bg-success-line'
              : status === 'connecting'
                ? 'bg-ink-4'
                : 'bg-danger-line'
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3" title={cwd}>
          {cwd || 'Opening…'}
        </span>
        {status === 'connecting' && <Spinner size={12} label="Connecting" />}
        {(status === 'closed' || status === 'error') && (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={TOOL}>
            <RefreshIcon size={12} /> Reconnect
          </button>
        )}
        <button
          type="button"
          onClick={() => xterm.current?.term.clear()}
          title="Clear the screen"
          className={TOOL}
        >
          <TrashIcon size={12} /> Clear
        </button>
        <button
          type="button"
          onClick={restart}
          title="Stop this shell and start a new one in the workspace folder"
          className={TOOL}
        >
          <RefreshIcon size={12} /> Restart
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="border-b border-line-2 bg-danger-bg px-3 py-2 text-[12.5px] text-danger"
        >
          {error}
        </p>
      )}
      {/* xterm draws into this; the padding keeps text off the edges. */}
      <div
        className="min-h-0 flex-1 cursor-text bg-surface px-2 py-1.5"
        onMouseDown={() => window.setTimeout(() => xterm.current?.term.focus())}
      >
        <div ref={host} className="h-full w-full" />
      </div>
    </div>
  );
}
