/**
 * Accounts with model providers that sign in through their own website instead of an API key
 * (today: Cursor). The tokens stay on the server; the UI only sees who is signed in.
 */
export interface ProviderAccount {
  provider: 'cursor';
  isConnected: boolean;
  /** The account's email, when the provider's token carries one. */
  email: string | null;
  /** The provider's id for the account (the token's `sub`). */
  accountId: string | null;
  /** When the saved access token stops working; the server renews it with the refresh token. */
  expiresAt: string | null;
  connectedAt: string | null;
  /** The saved sign-in no longer works (the refresh was refused): sign in again. */
  needsSignIn: boolean;
}

/** A browser sign-in that was started: open `loginUrl`, then poll its status by `loginId`. */
export interface ProviderLogin {
  loginId: string;
  loginUrl: string;
  /** After this the sign-in is forgotten and has to be started again. */
  expiresAt: string;
}

export type ProviderLoginStatus =
  { status: 'pending' } | { status: 'connected'; account: ProviderAccount };

/** A model the signed-in Cursor account can use, as Settings → Model providers lists it. */
export interface ProviderModel {
  /** The id Cursor takes, e.g. "claude-opus-5-5". */
  id: string;
  /** e.g. "Claude Opus 5.5" */
  name: string;
  /** Tokens it takes in one request; null when Cursor doesn't say. */
  contextWindow: number | null;
  supportsReasoning: boolean;
  supportsImages: boolean;
}
