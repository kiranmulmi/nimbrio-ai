// Accounts with model providers that sign in through their website (today: Cursor), app-wide,
// in ~/.nimbrio-ai/providers.json (written 0600). The tokens only leave through `cursor()` and
// `cursorAccessToken()`, for the API and runs on this machine; the UI sees `ProviderAccount`.
// An access token that ran out is renewed with the refresh token when it's next needed.
import {
  isExpired,
  refreshCursorToken,
  serialized,
  type CursorFetch,
  type CursorTokens,
} from '@app/agent';
import type { ProviderAccount } from '@app/shared';
import { z } from 'zod';
import { readJson, writePrivateJson } from './json-file.js';

const savedCursorSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accountId: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  connectedAt: z.string(),
  updatedAt: z.string(),
  needsSignIn: z.boolean().default(false),
});

export type SavedCursor = z.output<typeof savedCursorSchema>;

const providersFileSchema = z.object({ cursor: savedCursorSchema.nullable().default(null) });

type ProvidersFile = z.output<typeof providersFileSchema>;

export class ProviderStore {
  /** One renewal at a time, so two callers don't both spend the refresh token. */
  #renewing: Promise<void> | null = null;

  /** `fetchFn`: how renewals reach Cursor (tests pass a fake). */
  constructor(
    readonly file: string,
    private readonly fetchFn?: CursorFetch,
  ) {}

  /**
   * The saved Cursor sign-in with its tokens, or null when there is none. An expired access
   * token is renewed first; if Cursor refuses the refresh token, it comes back `needsSignIn`.
   * Cursor being unreachable leaves it as it was, to try again next time.
   */
  async cursor(): Promise<SavedCursor | null> {
    const saved = (await this.#read()).cursor;
    if (!saved || saved.needsSignIn || !isExpired(saved.expiresAt)) return saved;
    this.#renewing ??= this.#renew(saved.refreshToken).finally(() => {
      this.#renewing = null;
    });
    await this.#renewing;
    return (await this.#read()).cursor;
  }

  async cursorAccount(): Promise<ProviderAccount> {
    return toAccount(await this.cursor());
  }

  /** The token a Cursor model runs with, or null when not signed in (or the sign-in stopped working). */
  async cursorAccessToken(): Promise<string | null> {
    const saved = await this.cursor();
    return saved && !saved.needsSignIn ? saved.accessToken : null;
  }

  async #renew(refreshToken: string): Promise<void> {
    const result = await refreshCursorToken(refreshToken, this.fetchFn);
    if (result.status === 'renewed') await this.renewCursor(refreshToken, result.tokens);
    else if (result.status === 'refused') await this.markCursorNeedsSignIn(refreshToken);
  }

  /** A new sign-in replaces the old one; the same account keeps when it was first connected. */
  saveCursor(tokens: CursorTokens): Promise<ProviderAccount> {
    return this.#change((file) => {
      const now = new Date().toISOString();
      const previous = file.cursor;
      const isSameAccount =
        previous !== null && tokens.accountId !== null && previous.accountId === tokens.accountId;
      const cursor: SavedCursor = {
        ...tokens,
        connectedAt: isSameAccount ? previous.connectedAt : now,
        updatedAt: now,
        needsSignIn: false,
      };
      return { file: { ...file, cursor }, result: toAccount(cursor) };
    });
  }

  /**
   * Fresh tokens from a renewal. Only applied while `refreshToken` is still the saved one, so
   * a sign-out or a new sign-in that happened during the renewal isn't undone.
   */
  renewCursor(
    refreshToken: string,
    tokens: Pick<CursorTokens, 'accessToken' | 'refreshToken' | 'expiresAt'>,
  ): Promise<ProviderAccount> {
    return this.#change((file) => {
      if (file.cursor?.refreshToken !== refreshToken) {
        return { file, result: toAccount(file.cursor) };
      }
      const cursor = { ...file.cursor, ...tokens, updatedAt: new Date().toISOString() };
      return { file: { ...file, cursor }, result: toAccount(cursor) };
    });
  }

  /** Cursor refused the refresh token: keep the account on screen, asking to sign in again. */
  markCursorNeedsSignIn(refreshToken: string): Promise<ProviderAccount> {
    return this.#change((file) => {
      if (file.cursor?.refreshToken !== refreshToken) {
        return { file, result: toAccount(file.cursor) };
      }
      const cursor = { ...file.cursor, needsSignIn: true, updatedAt: new Date().toISOString() };
      return { file: { ...file, cursor }, result: toAccount(cursor) };
    });
  }

  /** Forgets the Cursor sign-in and its tokens. False when there was none. */
  removeCursor(): Promise<boolean> {
    return this.#change((file) =>
      file.cursor === null
        ? { file, result: false }
        : { file: { ...file, cursor: null }, result: true },
    );
  }

  async #read(): Promise<ProvidersFile> {
    const raw = await readJson(this.file);
    if (raw === null) return { cursor: null };
    const parsed = providersFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${this.file} is damaged: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }
    return parsed.data;
  }

  /** Read, change and write the file as one step, so concurrent changes can't lose each other. */
  #change<T>(update: (file: ProvidersFile) => { file: ProvidersFile; result: T }): Promise<T> {
    return serialized(this.file, async () => {
      const before = await this.#read();
      const { file, result } = update(before);
      if (file !== before) await writePrivateJson(this.file, file);
      return result;
    });
  }
}

function toAccount(saved: SavedCursor | null): ProviderAccount {
  return {
    provider: 'cursor',
    isConnected: saved !== null,
    email: saved?.email ?? null,
    accountId: saved?.accountId ?? null,
    expiresAt: saved?.expiresAt ?? null,
    connectedAt: saved?.connectedAt ?? null,
    needsSignIn: saved?.needsSignIn ?? false,
  };
}
