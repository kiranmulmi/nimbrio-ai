// Offline tests for provider sign-ins in ~/.nimbrio-ai/providers.json (here a temp folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appHomeFile } from '../src/app-home.js';
import type { CursorFetch, CursorTokens } from '@app/agent';
import { ProviderStore } from '../src/providers.js';

async function store(fetchFn?: CursorFetch): Promise<ProviderStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-providers-test-'));
  return new ProviderStore(appHomeFile(dir, 'providers'), fetchFn);
}

/** A fetch that answers with the given responses in turn and counts its calls. */
function fakeFetch(...responses: Response[]): CursorFetch & { calls: number } {
  const fn = Object.assign(
    () => {
      fn.calls += 1;
      const next = responses.shift();
      return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected request'));
    },
    { calls: 0 },
  );
  return fn as unknown as CursorFetch & { calls: number };
}

const EXPIRED = '2000-01-01T00:00:00.000Z';
const jwt = (claims: Record<string, unknown>) =>
  ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');

const tokens = (overrides: Partial<CursorTokens> = {}): CursorTokens => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accountId: 'user_1',
  email: 'me@example.com',
  expiresAt: '2030-01-01T00:00:00.000Z',
  ...overrides,
});

test('cursor: nobody signed in until a sign-in is saved, written 0600, tokens kept out of the account', async () => {
  const providers = await store();
  assert.equal(await providers.cursor(), null);
  assert.deepEqual(await providers.cursorAccount(), {
    provider: 'cursor',
    isConnected: false,
    email: null,
    accountId: null,
    expiresAt: null,
    connectedAt: null,
    needsSignIn: false,
  });

  const account = await providers.saveCursor(tokens());
  assert.equal(account.isConnected, true);
  assert.equal(account.email, 'me@example.com');
  assert.equal(account.accountId, 'user_1');
  assert.ok(!JSON.stringify(account).includes('access-1'));
  assert.ok(!JSON.stringify(account).includes('refresh-1'));
  assert.equal((await providers.cursor())?.accessToken, 'access-1');

  const mode = (await fs.stat(providers.file)).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600);
});

test('cursor: signing in again as the same account keeps when it was first connected', async () => {
  const providers = await store();
  const first = await providers.saveCursor(tokens());
  const again = await providers.saveCursor(tokens({ accessToken: 'access-2' }));
  assert.equal(again.connectedAt, first.connectedAt);
  const other = await providers.saveCursor(tokens({ accountId: 'user_2' }));
  assert.equal(other.accountId, 'user_2');
  assert.equal((await providers.cursor())?.accessToken, 'access-1');
});

test('cursor: a renewal applies only while its refresh token is still the saved one', async () => {
  const providers = await store();
  await providers.saveCursor(tokens());
  await providers.renewCursor('refresh-1', {
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    expiresAt: '2031-01-01T00:00:00.000Z',
  });
  const saved = await providers.cursor();
  assert.equal(saved?.accessToken, 'access-2');
  assert.equal(saved?.refreshToken, 'refresh-2');
  assert.equal(saved?.email, 'me@example.com');

  // A late renewal with the old token (or after a new sign-in) changes nothing.
  await providers.renewCursor('refresh-1', {
    accessToken: 'stale',
    refreshToken: 'stale',
    expiresAt: null,
  });
  await providers.markCursorNeedsSignIn('refresh-1');
  assert.equal((await providers.cursor())?.accessToken, 'access-2');
  assert.equal((await providers.cursorAccount()).needsSignIn, false);

  const refused = await providers.markCursorNeedsSignIn('refresh-2');
  assert.equal(refused.needsSignIn, true);
  assert.equal(refused.isConnected, true);
  const fresh = await providers.saveCursor(tokens());
  assert.equal(fresh.needsSignIn, false);
});

test('cursor: signing out forgets the tokens; a second sign-out finds nothing', async () => {
  const providers = await store();
  await providers.saveCursor(tokens());
  assert.equal(await providers.removeCursor(), true);
  assert.equal(await providers.cursor(), null);
  assert.equal(await providers.removeCursor(), false);
  assert.ok(!(await fs.readFile(providers.file, 'utf8')).includes('access-1'));
});

test('a damaged providers file is an error naming it, never silently replaced', async () => {
  const providers = await store();
  await fs.mkdir(path.dirname(providers.file), { recursive: true });
  await fs.writeFile(providers.file, '{ "cursor": { "accessToken": 5 } }');
  await assert.rejects(providers.cursor(), new RegExp(`${providers.file} is damaged`));
  await fs.writeFile(providers.file, 'not json');
  await assert.rejects(providers.saveCursor(tokens()), /is damaged/);
  assert.equal(await fs.readFile(providers.file, 'utf8'), 'not json');
});

test('cursor: an expired token is renewed when next needed, once for callers at the same time', async () => {
  const fresh = jwt({ sub: 'user_1', exp: Math.floor(Date.parse('2030-01-01') / 1000) });
  const fetchFn = fakeFetch(
    new Response(JSON.stringify({ accessToken: fresh, refreshToken: 'refresh-2' }), {
      status: 200,
    }),
  );
  const providers = await store(fetchFn);
  await providers.saveCursor(tokens({ expiresAt: EXPIRED }));
  const [token, account] = await Promise.all([
    providers.cursorAccessToken(),
    providers.cursorAccount(),
  ]);
  assert.equal(fetchFn.calls, 1);
  assert.equal(token, fresh);
  assert.equal(account.needsSignIn, false);
  assert.equal((await providers.cursor())?.refreshToken, 'refresh-2');
});

test('cursor: a refused renewal asks to sign in again, gives no token and stops trying', async () => {
  const fetchFn = fakeFetch(new Response(null, { status: 403 }));
  const providers = await store(fetchFn);
  await providers.saveCursor(tokens({ expiresAt: EXPIRED }));
  assert.equal(await providers.cursorAccessToken(), null);
  assert.equal((await providers.cursorAccount()).needsSignIn, true);
  assert.equal(fetchFn.calls, 1);
});

test('cursor: Cursor unreachable leaves the sign-in as it was, to try again', async () => {
  const fetchFn = fakeFetch(new Response(null, { status: 503 }));
  const providers = await store(fetchFn);
  await providers.saveCursor(tokens({ expiresAt: EXPIRED }));
  assert.equal(await providers.cursorAccessToken(), 'access-1');
  assert.equal((await providers.cursorAccount()).needsSignIn, false);
});
