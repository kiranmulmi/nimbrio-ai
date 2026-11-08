/** POST /v1/workspaces/:id/terminal: a one-time ticket for the terminal's WebSocket. */
export interface TerminalTicket {
  ticket: string;
  /** the workspace folder the shell starts in */
  cwd: string;
}

/** What the terminal's WebSocket sends, one JSON message per frame. */
export type TerminalServerMessage =
  | { type: 'ready'; cwd: string; shell: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number };

/** What the browser sends. */
export type TerminalClientMessage =
  { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

export const TERMINAL_SOCKET_PATH = '/v1/terminal/socket';
