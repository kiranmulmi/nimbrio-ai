import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

/**
 * Read-only routes the web app polls every few seconds. A quiet success on these is logged at
 * debug, so `LOG_LEVEL=info` shows only real activity; failures still show at warn/error.
 */
const POLLED_ROUTES = [
  /^\/v1\/info(\?|$)/,
  // The running-tasks list (every 3 s) and an open task's output (every 1.5 s).
  /^\/v1\/workspaces\/[^/]+\/tasks(\/[^/?]+)?(\?|$)/,
];

function isPolledRead(req: IncomingMessage): boolean {
  return req.method === 'GET' && POLLED_ROUTES.some((route) => route.test(req.url ?? ''));
}

/** What a request log keeps. Headers are left out on purpose: they carry cookies and tokens. */
export function serializeReq(req: { id?: unknown; method?: string; url?: string }) {
  return { id: req.id, method: req.method, url: req.url };
}

export function serializeRes(res: { statusCode?: number }) {
  return { statusCode: res.statusCode };
}

/** Failures always show; quiet successes on polled routes drop to debug. */
export function logLevelFor(
  req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): 'error' | 'warn' | 'info' | 'debug' {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return isPolledRead(req) ? 'debug' : 'info';
}

/**
 * Compact request logs: method, URL and status only. Headers are never logged, so cookies,
 * auth tokens and API keys can't leak into the terminal or log files.
 */
export const httpLogOptions: Options<IncomingMessage, ServerResponse> = {
  autoLogging: { ignore: (req) => req.url === '/health' },
  serializers: { req: serializeReq, res: serializeRes },
  // Belt and braces, in case a serializer above is ever changed to include headers.
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      'headers.cookie',
      'headers.authorization',
    ],
    censor: '[redacted]',
  },
  customLogLevel: logLevelFor,
  customSuccessMessage: (req, res, responseTime) =>
    `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} ${err.message}`,
};
