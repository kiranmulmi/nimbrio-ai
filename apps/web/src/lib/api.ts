import { isErrorEnvelope, type Envelope } from '@app/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/** A failed API call: the `{ error }` envelope's message, plus the HTTP status and error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** How requests prove who is signed in (`features/auth/AuthGate`); null when sign-in is off. */
export interface AuthHandlers {
  /** the current access token, renewed when it's about to run out; null for a guest */
  accessToken: () => Promise<string | null>;
  /** the API no longer accepts the token: sign out (to the login page, or as a guest) */
  onSignedOut: () => void;
}

let authHandlers: AuthHandlers | null = null;

export function setAuthHandlers(handlers: AuthHandlers | null): void {
  authHandlers = handlers;
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const auth = authHandlers;
  try {
    const token = await auth?.accessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${BASE_URL}/v1${path}`, { ...init, headers });
    if (res.status === 401) auth?.onSignedOut();
    return res;
  } catch (cause) {
    // An aborted request is the caller's own doing; let it through untouched.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError("Can't reach the server.", 0, 'network_error');
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const json = (await res.json()) as Envelope<unknown>;
    if (isErrorEnvelope(json)) return new ApiError(json.error.message, res.status, json.error.code);
  } catch {
    // Not JSON (a proxy error page, say): fall through to a generic message.
  }
  return new ApiError(`Request failed (${res.status})`, res.status, 'http_error');
}

/** Unwraps a `{ data }` envelope and throws an `ApiError` for an `{ error }` one. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as Envelope<T>;
  if (isErrorEnvelope(json)) throw new ApiError(json.error.message, res.status, json.error.code);
  return json.data;
}

/**
 * A file the API sends (an attached image, say), fetched with the sign-in, since an
 * `<img src>` or a link can't carry it.
 */
export async function requestBlob(path: string): Promise<Blob> {
  const res = await send(path);
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

/** A JSON request body for `request`. */
export function jsonBody(method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

/**
 * Starts a request that answers with `text/event-stream` and returns its body.
 * A 4xx comes back as a normal JSON error envelope, so it throws like `request` does.
 */
export async function requestStream(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const res = await send(path, {
    ...jsonBody('POST', body),
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new ApiError('The server sent an empty response.', res.status, 'empty_body');
  return res.body;
}

export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function isNotFound(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}

/** A message fit for a toast, whatever was thrown. */
export function errorMessage(cause: unknown, fallback = 'Something went wrong.'): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
