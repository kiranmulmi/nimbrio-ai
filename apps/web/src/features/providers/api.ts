import type {
  ProviderAccount,
  ProviderLogin,
  ProviderLoginStatus,
  ProviderModel,
} from '@app/shared';
import { jsonBody, request } from '../../lib/api';

const loginPath = (loginId: string) => `/providers/cursor/logins/${encodeURIComponent(loginId)}`;

/** Who is signed in with each provider. Tokens never come back. */
export const fetchProviders = () => request<ProviderAccount[]>('/providers');

/** Starts Cursor's browser sign-in: open `loginUrl`, then poll `fetchCursorLogin`. */
export const startCursorLogin = () =>
  request<ProviderLogin>('/providers/cursor/logins', jsonBody('POST', {}));

/** One look at whether the user finished signing in on cursor.com. */
export const fetchCursorLogin = (loginId: string) =>
  request<ProviderLoginStatus>(loginPath(loginId));

export const cancelCursorLogin = (loginId: string) =>
  request<void>(loginPath(loginId), { method: 'DELETE' });

export const signOutCursor = () => request<void>('/providers/cursor', { method: 'DELETE' });

/** The models the signed-in Cursor account can use, fresh from Cursor. */
export const fetchCursorModels = () => request<ProviderModel[]>('/providers/cursor/models');
