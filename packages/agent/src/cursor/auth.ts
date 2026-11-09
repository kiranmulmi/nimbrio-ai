// Cursor's browser sign-in ("deep control" PKCE) and token renewal. The user signs in on
// cursor.com with a challenge; we poll Cursor with the matching verifier until it hands over
// the tokens. The verifier never leaves this server.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isRecord } from '../errors.js';

const LOGIN_URL = 'https://cursor.com/loginDeepControl';
const POLL_URL = 'https://api2.cursor.sh/auth/poll';
const REFRESH_URL = 'https://api2.cursor.sh/auth/exchange_user_api_key';
const REQUEST_TIMEOUT_MS = 15_000;
/** Renew a little early, so a token isn't handed out moments before it stops working. */
const EXPIRY_SKEW_MS = 5 * 60_000;

/** What a sign-in or a renewal hands over. */
export interface CursorTokens {
  accessToken: string;
  refreshToken: string;
  /** The account's id at Cursor (the token's `sub`). */
  accountId: string | null;
  email: string | null;
  expiresAt: string | null;
}

/** A started sign-in. `verifier` stays on the server; only `loginUrl` goes to the browser. */
export interface CursorLoginParams {
  uuid: string;
  verifier: string;
  loginUrl: string;
}

export type CursorPollResult =
  | { status: 'pending' }
  | { status: 'connected'; tokens: CursorTokens }
  | { status: 'failed'; message: string };

export type CursorRefreshResult =
  | { status: 'renewed'; tokens: Pick<CursorTokens, 'accessToken' | 'refreshToken' | 'expiresAt'> }
  /** Cursor refused the refresh token: the user has to sign in again. */
  | { status: 'refused' }
  | { status: 'failed'; message: string };

/** How requests reach Cursor; tests pass a fake. */
export type CursorFetch = typeof fetch;

export function startCursorLogin(): CursorLoginParams {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const uuid = randomUUID();
  const query = new URLSearchParams({ challenge, uuid, mode: 'login', redirectTarget: 'cli' });
  return { uuid, verifier, loginUrl: `${LOGIN_URL}?${query.toString()}` };
}

/** One look at whether the user finished signing in. Cursor answers 404 until they do. */
export async function pollCursorLogin(
  { uuid, verifier }: Pick<CursorLoginParams, 'uuid' | 'verifier'>,
  fetchFn: CursorFetch = fetch,
): Promise<CursorPollResult> {
  const query = new URLSearchParams({ uuid, verifier });
  let response: Response;
  try {
    response = await fetchFn(`${POLL_URL}?${query.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'failed', message: "Couldn't reach Cursor. Check the connection." };
  }
  if (response.status === 404) return { status: 'pending' };
  if (!response.ok) {
    return { status: 'failed', message: `Cursor answered ${response.status} to the sign-in.` };
  }
  const body = await readJsonBody(response);
  const accessToken = stringField(body, 'accessToken');
  const refreshToken = stringField(body, 'refreshToken');
  if (!accessToken || !refreshToken) {
    return { status: 'failed', message: "Cursor's sign-in answer had no tokens." };
  }
  return { status: 'connected', tokens: cursorTokens(accessToken, refreshToken) };
}

/** Trades the refresh token for a new access token (and maybe a new refresh token). */
export async function refreshCursorToken(
  refreshToken: string,
  fetchFn: CursorFetch = fetch,
): Promise<CursorRefreshResult> {
  let response: Response;
  try {
    response = await fetchFn(REFRESH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'failed', message: "Couldn't reach Cursor to renew the sign-in." };
  }
  if (response.status === 401 || response.status === 403) return { status: 'refused' };
  if (!response.ok) {
    return { status: 'failed', message: `Cursor answered ${response.status} to the renewal.` };
  }
  const body = await readJsonBody(response);
  const accessToken = stringField(body, 'accessToken');
  if (!accessToken) return { status: 'failed', message: "Cursor's renewal had no access token." };
  return {
    status: 'renewed',
    tokens: {
      accessToken,
      // Cursor may keep the same refresh token and leave it out.
      refreshToken: stringField(body, 'refreshToken') ?? refreshToken,
      expiresAt: tokenExpiry(accessToken),
    },
  };
}

/** Whether a saved access token is (nearly) out of date. One without a known expiry isn't. */
export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
  if (expiresAt === null) return false;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= now;
}

/** The tokens with who they belong to, read from the access token's JWT claims. */
export function cursorTokens(accessToken: string, refreshToken: string): CursorTokens {
  const claims = jwtClaims(accessToken) ?? jwtClaims(refreshToken);
  const sub = claims?.['sub'];
  const email = claims?.['email'];
  return {
    accessToken,
    refreshToken,
    accountId: typeof sub === 'string' && sub ? sub : typeof sub === 'number' ? String(sub) : null,
    email: typeof email === 'string' && email ? email.toLowerCase() : null,
    expiresAt: tokenExpiry(accessToken),
  };
}

/** The JWT's `exp`, a little early; null when the token doesn't say. */
function tokenExpiry(token: string): string | null {
  const exp = jwtClaims(token)?.['exp'];
  return typeof exp === 'number' ? new Date(exp * 1000 - EXPIRY_SKEW_MS).toISOString() : null;
}

/**
 * The claims in a JWT's payload, unverified: Cursor sent it to us over TLS, and we only read
 * who it is for and when it ends.
 */
function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === 'string' && field ? field : null;
}
