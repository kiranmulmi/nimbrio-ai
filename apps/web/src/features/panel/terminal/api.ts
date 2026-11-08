import type { TerminalTicket } from '@app/shared';
import { TERMINAL_SOCKET_PATH } from '@app/shared';
import { jsonBody, request } from '../../../lib/api';

const terminalPath = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/terminal`;

export function fetchTerminalTicket(workspaceId: string): Promise<TerminalTicket> {
  return request<TerminalTicket>(terminalPath(workspaceId), jsonBody('POST', {}));
}

/** Stops the workspace's shell; the next ticket starts a new one. */
export function stopTerminal(workspaceId: string): Promise<void> {
  return request<void>(terminalPath(workspaceId), { method: 'DELETE' });
}

/** The socket URL, on the API's own host (VITE_API_URL) or this page's. */
export function terminalSocketUrl(ticket: string, cols: number, rows: number): string {
  const base = import.meta.env.VITE_API_URL ?? window.location.origin;
  const url = new URL(TERMINAL_SOCKET_PATH, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ ticket, cols: String(cols), rows: String(rows) }).toString();
  return url.toString();
}
