// WebSocket for the integrated terminal: GET /v1/terminal/socket?ticket=…&cols=…&rows=…
// Browsers let any website open a WebSocket to localhost, so a socket is accepted only with
// this app's Host and Origin and a fresh ticket from POST /v1/workspaces/:id/terminal.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { TERMINAL_SOCKET_PATH, type TerminalServerMessage } from '@app/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { ALLOWED_HOSTS, env } from '../../config/env.js';
import type { TerminalEvent, TerminalService } from './terminal.service.js';

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(100_000) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(1).max(500),
  }),
]);

/** The web app's own pages: the dev server's origins and the API serving the built app. */
function allowedOrigins(): Set<string> {
  const origins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  for (const host of ALLOWED_HOSTS) origins.push(`http://${host}:${env.PORT}`);
  return new Set(origins);
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(Math.max(number, min), max) : fallback;
};

export function createTerminalSocket(terminals: TerminalService) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const origins = allowedOrigins();

  function pipe(ws: WebSocket, session: Awaited<ReturnType<TerminalService['attach']>>): void {
    if (!session) return;
    const send = (event: TerminalEvent | TerminalServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    send({ type: 'ready', cwd: session.cwd, shell: session.shell });
    if (session.scrollback) send({ type: 'output', data: session.scrollback });
    if (session.exitCode !== null) send({ type: 'exit', code: session.exitCode });
    session.listeners.add(send);
    ws.on('message', (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = clientMessage.safeParse(message);
      if (!parsed.success || session.exitCode !== null) return;
      if (parsed.data.type === 'input') session.pty.write(parsed.data.data);
      else session.pty.resize(parsed.data.cols, parsed.data.rows);
    });
    ws.on('close', () => session.listeners.delete(send));
  }

  return {
    /** For the HTTP server's `upgrade` event. Returns false for other paths. */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== TERMINAL_SOCKET_PATH) return false;
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!ALLOWED_HOSTS.has(host)) {
        reject(socket, 403, 'Forbidden');
        return true;
      }
      if (!origins.has(req.headers.origin ?? '')) {
        reject(socket, 403, 'Forbidden');
        return true;
      }
      const ticket = url.searchParams.get('ticket') ?? '';
      const cols = clamp(url.searchParams.get('cols'), 2, 1000, 80);
      const rows = clamp(url.searchParams.get('rows'), 1, 500, 24);
      void terminals
        .attach(ticket, cols, rows)
        .then((session) => {
          if (!session) {
            reject(socket, 401, 'Unauthorized');
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => pipe(ws, session));
        })
        .catch(() => reject(socket, 500, 'Internal Server Error'));
      return true;
    },
  };
}
