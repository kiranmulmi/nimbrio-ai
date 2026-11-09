import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthConfig, AuthUser } from '@app/shared';
import type { AuthSettings } from '../../config/env.js';
import { ForbiddenError, UnauthorizedError, UpstreamError } from '../../lib/errors.js';

/** A verified access token: whose it is and until when (seconds since the epoch). */
export interface VerifiedToken {
  user: AuthUser;
  expiresAt: number;
}

/**
 * Checks an access token's signature and expiry. Null for a token that isn't a signed-in
 * user's; throws `UpstreamError` when the check itself couldn't be made.
 */
export type VerifyToken = (token: string) => Promise<VerifiedToken | null>;

export interface AuthService {
  config: AuthConfig;
  /** The user a request's bearer token belongs to; null when sign-in is off. */
  userFor(authorization: string | undefined): Promise<AuthUser | null>;
}

/** Tokens already checked, so polling routes don't verify the same one again and again. */
const CACHE_SIZE = 200;

/**
 * Supabase's own check (`getClaims`): the signature against the project's published keys,
 * locally, or by asking its Auth server for projects that sign with a shared secret.
 */
export function supabaseTokenVerifier(settings: AuthSettings): VerifyToken {
  const client = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return async (token) => {
    // getClaims throws, rather than answering with an error, on a token it can't decode.
    if (!isJwtShaped(token)) return null;
    let answer: Awaited<ReturnType<typeof client.auth.getClaims>>;
    try {
      answer = await client.auth.getClaims(token);
    } catch (cause) {
      throw new UpstreamError(`Couldn't check the sign-in with Supabase: ${String(cause)}`);
    }
    const { data, error } = answer;
    if (isAuthRetryableFetchError(error)) {
      throw new UpstreamError("Can't reach Supabase to check the sign-in. Try again.");
    }
    if (error || !data) return null;
    const { claims } = data;
    // The project's legacy anon key is a validly signed token too, with role "anon".
    if (claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !claims.sub) {
      return null;
    }
    return {
      user: { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null },
      expiresAt: claims.exp,
    };
  };
}

/** Three base64url parts, the first two JSON objects: a JWT, signed or not. */
export function isJwtShaped(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((part) => /^[\w-]+$/.test(part))) return false;
  return parts.slice(0, 2).every((part) => {
    try {
      const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    } catch {
      return false;
    }
  });
}

export function createAuthService(
  settings: AuthSettings | null,
  verify: VerifyToken | null = settings && supabaseTokenVerifier(settings),
  now: () => number = () => Date.now() / 1000,
): AuthService {
  if (!settings || !verify) {
    return { config: { isEnabled: false }, userFor: () => Promise.resolve(null) };
  }
  const allowed = new Set(settings.allowedEmails);
  const cache = new Map<string, VerifiedToken>();

  async function verified(token: string): Promise<VerifiedToken | null> {
    const hit = cache.get(token);
    if (hit && hit.expiresAt > now()) return hit;
    cache.delete(token);
    const result = await verify?.(token);
    if (!result || result.expiresAt <= now()) return null;
    if (cache.size >= CACHE_SIZE) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(token, result);
    return result;
  }

  return {
    config: {
      isEnabled: true,
      supabaseUrl: settings.supabaseUrl,
      supabaseAnonKey: settings.supabaseAnonKey,
    },
    async userFor(authorization) {
      const token = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? '')?.[1];
      if (!token) throw new UnauthorizedError();
      const result = await verified(token);
      if (!result) throw new UnauthorizedError('Your sign-in has ended. Sign in again.');
      const email = result.user.email?.toLowerCase() ?? '';
      if (allowed.size > 0 && !allowed.has(email)) {
        throw new ForbiddenError(`${result.user.email ?? 'This account'} may not use this app.`);
      }
      return result.user;
    },
  };
}
