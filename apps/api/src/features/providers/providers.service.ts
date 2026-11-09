import {
  CursorHttpError,
  fetchCursorModels,
  pollCursorLogin,
  startCursorLogin,
  type CursorFetch,
  type CursorLoginParams,
} from '@app/agent';
import type {
  ProviderAccount,
  ProviderLogin,
  ProviderLoginStatus,
  ProviderModel,
} from '@app/shared';
import type { AppContext } from '../../context.js';
import { NotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';

/** How long a started sign-in waits for the user before it has to be started again. */
export const LOGIN_TTL_MS = 10 * 60_000;
/** Sign-ins waiting at once; starting more forgets the oldest. */
const MAX_PENDING_LOGINS = 10;

interface PendingLogin extends CursorLoginParams {
  expiresAt: number;
}

/**
 * Model providers that sign in through their website (Cursor). The PKCE verifiers of sign-ins
 * in progress live only in this process's memory; the tokens are saved (and renewed) by
 * `store.providers` and never sent to the browser.
 */
export function createProvidersService(
  { store }: Pick<AppContext, 'store'>,
  fetchFn?: CursorFetch,
) {
  const { providers } = store;
  const logins = new Map<string, PendingLogin>();

  const prune = (now = Date.now()) => {
    for (const [id, login] of logins) if (login.expiresAt <= now) logins.delete(id);
  };

  const pendingLogin = (loginId: string): PendingLogin => {
    prune();
    const login = logins.get(loginId);
    if (!login) throw new NotFoundError('That sign-in expired or was cancelled. Start again.');
    return login;
  };

  return {
    list: async (): Promise<ProviderAccount[]> => [await providers.cursorAccount()],

    startCursorLogin(): ProviderLogin {
      prune();
      while (logins.size >= MAX_PENDING_LOGINS) {
        const oldest = logins.keys().next().value;
        if (oldest === undefined) break;
        logins.delete(oldest);
      }
      const params = startCursorLogin();
      const expiresAt = Date.now() + LOGIN_TTL_MS;
      logins.set(params.uuid, { ...params, expiresAt });
      return {
        loginId: params.uuid,
        loginUrl: params.loginUrl,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    /** Asks Cursor once whether the user finished; saves the tokens when they did. */
    async cursorLoginStatus(loginId: string): Promise<ProviderLoginStatus> {
      const login = pendingLogin(loginId);
      const result = await pollCursorLogin(login, fetchFn);
      if (result.status === 'pending') return { status: 'pending' };
      // A failed look keeps the sign-in waiting: the next poll may get through.
      if (result.status === 'failed') throw new UpstreamError(result.message);
      // Forgotten before saving, so the verifier can't be used twice.
      logins.delete(loginId);
      return { status: 'connected', account: await providers.saveCursor(result.tokens) };
    },

    /** Cancelling one that already ended or expired is fine: it's gone either way. */
    cancelCursorLogin(loginId: string): void {
      logins.delete(loginId);
    },

    async signOutCursor(): Promise<void> {
      if (!(await providers.removeCursor())) throw new NotFoundError('Not signed in to Cursor.');
    },

    /** The models the signed-in Cursor account can use, as Cursor lists them now. */
    async cursorModels(): Promise<ProviderModel[]> {
      const token = await providers.cursorAccessToken();
      if (!token) throw new ValidationError('Sign in to Cursor first.');
      try {
        return await fetchCursorModels(token);
      } catch (error) {
        if (error instanceof CursorHttpError) throw new UpstreamError(error.message);
        throw new UpstreamError(error instanceof Error ? error.message : "Couldn't reach Cursor.");
      }
    },
  };
}

export type ProvidersService = ReturnType<typeof createProvidersService>;
