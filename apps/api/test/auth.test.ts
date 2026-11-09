import assert from 'node:assert/strict';
import { test } from 'node:test';
import { env, readAuthSettings, type AuthSettings } from '../src/config/env.js';
import {
  createAuthService,
  isJwtShaped,
  type VerifiedToken,
} from '../src/features/auth/auth.service.js';
import { ForbiddenError, UnauthorizedError } from '../src/lib/errors.js';

const SETTINGS: AuthSettings = {
  supabaseUrl: 'https://abcd.supabase.co',
  supabaseAnonKey: 'anon-key',
  allowedEmails: [],
};

const NOW = 1_000_000;
const valid = (email: string | null = 'me@example.com'): VerifiedToken => ({
  user: { id: 'user-1', email },
  expiresAt: NOW + 3600,
});

/** A verifier that knows one token, and counts how often it was asked. */
function fakeVerifier(result: VerifiedToken | null) {
  const asked: string[] = [];
  return {
    asked,
    verify: (token: string) => {
      asked.push(token);
      return Promise.resolve(token === 'good' ? result : null);
    },
  };
}

test('with sign-in off, nobody is asked for a token', async () => {
  const auth = createAuthService(null);
  assert.deepEqual(auth.config, { isEnabled: false });
  assert.equal(await auth.userFor(undefined), null);
});

test('with sign-in on, the config names the project and requests need a valid token', async () => {
  const { verify } = fakeVerifier(valid());
  const auth = createAuthService(SETTINGS, verify, () => NOW);
  assert.deepEqual(auth.config, {
    isEnabled: true,
    supabaseUrl: 'https://abcd.supabase.co',
    supabaseAnonKey: 'anon-key',
  });
  await assert.rejects(auth.userFor(undefined), UnauthorizedError);
  await assert.rejects(auth.userFor('good'), UnauthorizedError, 'needs the Bearer scheme');
  await assert.rejects(auth.userFor('Bearer bad'), /Sign in again/);
  assert.deepEqual(await auth.userFor('Bearer good'), { id: 'user-1', email: 'me@example.com' });
});

test('a checked token is remembered until it expires', async () => {
  let now = NOW;
  const { verify, asked } = fakeVerifier(valid());
  const auth = createAuthService(SETTINGS, verify, () => now);
  await auth.userFor('Bearer good');
  await auth.userFor('bearer good');
  assert.equal(asked.length, 1);
  now = NOW + 3601;
  await assert.rejects(auth.userFor('Bearer good'), UnauthorizedError);
  assert.equal(asked.length, 2);
});

test('only the allowed emails get in, in any case', async () => {
  const settings = { ...SETTINGS, allowedEmails: ['me@example.com'] };
  const me = createAuthService(settings, fakeVerifier(valid('Me@Example.com')).verify, () => NOW);
  assert.equal((await me.userFor('Bearer good'))?.id, 'user-1');
  const other = createAuthService(settings, fakeVerifier(valid('x@example.com')).verify, () => NOW);
  await assert.rejects(other.userFor('Bearer good'), ForbiddenError);
  const noEmail = createAuthService(settings, fakeVerifier(valid(null)).verify, () => NOW);
  await assert.rejects(noEmail.userFor('Bearer good'), ForbiddenError);
});

test('sign-in settings come from .env: both values or neither', () => {
  const base = { ...env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', AUTH_ALLOWED_EMAILS: '' };
  assert.equal(readAuthSettings(base), null);
  assert.throws(
    () => readAuthSettings({ ...base, SUPABASE_URL: 'https://abcd.supabase.co' }),
    /both/,
  );
  assert.throws(
    () =>
      readAuthSettings({
        ...base,
        SUPABASE_URL: 'http://abcd.supabase.co',
        SUPABASE_ANON_KEY: 'k',
      }),
    /https/,
  );
  assert.deepEqual(
    readAuthSettings({
      ...base,
      SUPABASE_URL: 'https://abcd.supabase.co/',
      SUPABASE_ANON_KEY: 'k',
      AUTH_ALLOWED_EMAILS: ' Me@Example.com, ,you@example.com ',
    }),
    {
      supabaseUrl: 'https://abcd.supabase.co',
      supabaseAnonKey: 'k',
      allowedEmails: ['me@example.com', 'you@example.com'],
    },
  );
});

test('only JWT-shaped tokens are sent to Supabase to check', () => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.ok(isJwtShaped(`${part({ alg: 'ES256' })}.${part({ sub: 'u' })}.c2ln`));
  assert.ok(!isJwtShaped('abc.def.ghi'));
  assert.ok(!isJwtShaped(`${part({ alg: 'ES256' })}.${part([1])}.c2ln`));
  assert.ok(!isJwtShaped(`${part({ alg: 'ES256' })}.${part({ sub: 'u' })}`));
  assert.ok(!isJwtShaped('a b.c.d'));
});
