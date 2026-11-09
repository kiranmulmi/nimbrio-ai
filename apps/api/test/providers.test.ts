// Offline tests for the providers service: Cursor's sign-in flow and model list, with a fake fetch.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cursorTokens, type CursorFetch } from '@app/agent';
import { Store } from '@app/db';
import { createProvidersService } from '../src/features/providers/providers.service.js';
import { NotFoundError, UpstreamError, ValidationError } from '../src/lib/errors.js';

const jwt = (claims: Record<string, unknown>) =>
  ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
const ACCESS = jwt({
  sub: 'auth0|user_1',
  email: 'me@example.com',
  exp: Math.floor(Date.parse('2030-01-01') / 1000),
});

function fakeFetch(...responses: Response[]): CursorFetch {
  return (() => {
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected request'));
  }) as unknown as CursorFetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function tempStore(): Promise<Store> {
  return new Store({ appHome: await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-providers-')) });
}

test('a finished sign-in is saved once and its verifier forgotten', async () => {
  const store = await tempStore();
  const service = createProvidersService(
    { store },
    fakeFetch(
      new Response(null, { status: 404 }),
      new Response(null, { status: 502 }),
      json({ accessToken: ACCESS, refreshToken: 'refresh-1' }),
    ),
  );
  const login = service.startCursorLogin();
  assert.deepEqual(await service.cursorLoginStatus(login.loginId), { status: 'pending' });
  // A failed look is an error, but the sign-in keeps waiting.
  await assert.rejects(service.cursorLoginStatus(login.loginId), UpstreamError);
  const done = await service.cursorLoginStatus(login.loginId);
  assert.equal(done.status, 'connected');
  if (done.status === 'connected') assert.equal(done.account.email, 'me@example.com');
  await assert.rejects(service.cursorLoginStatus(login.loginId), NotFoundError);

  const [account] = await service.list();
  assert.equal(account?.isConnected, true);
  assert.ok(!JSON.stringify(account).includes('refresh-1'));
});

test('a cancelled or unknown sign-in is gone; signing out twice is a 404', async () => {
  const store = await tempStore();
  const service = createProvidersService({ store }, fakeFetch());
  const login = service.startCursorLogin();
  service.cancelCursorLogin(login.loginId);
  service.cancelCursorLogin(login.loginId);
  await assert.rejects(service.cursorLoginStatus(login.loginId), NotFoundError);
  await assert.rejects(service.cursorLoginStatus('nope'), NotFoundError);

  await store.providers.saveCursor(cursorTokens(ACCESS, 'refresh-1'));
  await service.signOutCursor();
  await assert.rejects(service.signOutCursor(), NotFoundError);
});

test('the Cursor model list needs a sign-in', async () => {
  const store = await tempStore();
  const service = createProvidersService({ store });
  await assert.rejects(service.cursorModels(), ValidationError);
});
