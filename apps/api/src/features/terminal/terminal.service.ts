// The integrated terminal: one shell per workspace, started in its folder, in a real PTY
// (node-pty), streamed to the browser over a WebSocket (terminal.socket.ts). A session
// outlives the socket, so switching tabs or reloading reattaches and replays recent output.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { withoutAppSecrets } from '@app/agent';
import * as pty from 'node-pty';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';
import { ValidationError } from '../../lib/errors.js';

/** Output kept for replay when the browser reattaches. */
const SCROLLBACK_CHARS = 200_000;
/** A ticket must be used this soon after it is issued. */
const TICKET_MS = 30_000;

export interface TerminalSession {
  id: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  pty: pty.IPty;
  scrollback: string;
  exitCode: number | null;
  listeners: Set<(event: TerminalEvent) => void>;
}

export type TerminalEvent = { type: 'output'; data: string } | { type: 'exit'; code: number };

/** node-pty's prebuilt helper sometimes loses its executable bit when installed. */
function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return;
  try {
    const root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    const helper = path.join(
      root,
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper',
    );
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  } catch {
    // A source build has its own helper; spawning reports anything still wrong.
  }
}

function userShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe';
  return process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash');
}

export function createTerminalService(workspaces: WorkspacesService) {
  const sessions = new Map<string, TerminalSession>(); // by workspace id
  const tickets = new Map<string, { workspaceId: string; expires: number }>();
  let isHelperChecked = false;

  function start(workspaceId: string, cwd: string, cols: number, rows: number): TerminalSession {
    if (!isHelperChecked) {
      ensureSpawnHelper();
      isHelperChecked = true;
    }
    const shell = userShell();
    const term = pty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // The user's own environment, without this app's settings and secrets.
      env: {
        ...withoutAppSecrets(process.env),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'nimbrio-ai',
      } as Record<string, string>,
    });
    const session: TerminalSession = {
      id: randomUUID(),
      workspaceId,
      cwd,
      shell: path.basename(shell),
      pty: term,
      scrollback: '',
      exitCode: null,
      listeners: new Set(),
    };
    term.onData((data) => {
      session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_CHARS);
      for (const listener of session.listeners) listener({ type: 'output', data });
    });
    term.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      for (const listener of session.listeners) listener({ type: 'exit', code: exitCode });
      if (sessions.get(workspaceId) === session) sessions.delete(workspaceId);
    });
    sessions.set(workspaceId, session);
    return session;
  }

  return {
    /**
     * A one-time ticket for the WebSocket. Issued over a JSON request, which only this app's
     * own pages can read (CORS), so another website can't open a shell.
     */
    async ticket(workspaceId: string): Promise<{ ticket: string; cwd: string }> {
      const workspace = await workspaces.require(workspaceId);
      if (!fs.existsSync(workspace.path)) {
        throw new ValidationError(`The workspace folder ${workspace.path} no longer exists.`);
      }
      const now = Date.now();
      for (const [key, value] of tickets) if (value.expires < now) tickets.delete(key);
      const ticket = randomBytes(24).toString('base64url');
      tickets.set(ticket, { workspaceId: workspace.id, expires: now + TICKET_MS });
      return { ticket, cwd: workspace.path };
    },

    /** The session a ticket opens (started now if the workspace has none). Null: bad ticket. */
    async attach(ticket: string, cols: number, rows: number): Promise<TerminalSession | null> {
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      if (!entry || entry.expires < Date.now()) return null;
      const existing = sessions.get(entry.workspaceId);
      if (existing) return existing;
      const workspace = await workspaces.require(entry.workspaceId);
      return start(workspace.id, workspace.path, cols, rows);
    },

    /** Stop a workspace's shell (the Restart button starts a new one on the next attach). */
    kill(workspaceId: string): boolean {
      const session = sessions.get(workspaceId);
      if (!session) return false;
      sessions.delete(workspaceId);
      session.pty.kill();
      return true;
    },

    closeAll(): void {
      for (const session of sessions.values()) session.pty.kill();
      sessions.clear();
    },
  };
}

export type TerminalService = ReturnType<typeof createTerminalService>;
