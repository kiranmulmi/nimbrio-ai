// Offline tests for the login page's logic: Supabase errors in plain words, the error a failed
// Google or email-link return leaves in the URL, and the password rules.
// Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthApiError, AuthRetryableFetchError, type User } from '@supabase/supabase-js';
import { initialsOf } from '../src/features/auth/AccountMenu';
import { profileOf } from '../src/features/auth/authContext';
import { describeAuthError, readRedirectError } from '../src/features/auth/authErrors';
import { isEmail, passwordStrength } from '../src/features/auth/password';

function apiError(code: string, message = 'raw message'): AuthApiError {
  return new AuthApiError(message, 400, code);
}

test('wrong credentials offer a password reset', () => {
  const problem = describeAuthError(apiError('invalid_credentials'));
  assert.equal(problem.fix, 'resetPassword');
  assert.match(problem.message, /don't match/);
});

test('an unconfirmed email offers to resend the confirmation', () => {
  assert.equal(describeAuthError(apiError('email_not_confirmed')).fix, 'resendConfirmation');
});

test('a taken email offers to sign in instead', () => {
  assert.equal(describeAuthError(apiError('user_already_exists')).fix, 'signIn');
  assert.equal(describeAuthError(apiError('email_exists')).fix, 'signIn');
});

test('an unknown code keeps Supabase’s own message', () => {
  assert.deepEqual(describeAuthError(apiError('something_new', 'Exact words')), {
    message: 'Exact words',
  });
});

test('network failures and non-auth errors read as a connection problem', () => {
  const offline = /Can't reach the sign-in server/;
  assert.match(describeAuthError(new AuthRetryableFetchError('fetch failed', 0)).message, offline);
  assert.match(describeAuthError(new TypeError('Failed to fetch')).message, offline);
});

function withUrl(url: string, read: () => string | null): string | null {
  const previous = (globalThis as { window?: unknown }).window;
  Object.assign(globalThis, { window: { location: new URL(url) } });
  try {
    return read();
  } finally {
    Object.assign(globalThis, { window: previous });
  }
}

test('reads a failed return from the query or the hash', () => {
  assert.equal(
    withUrl(
      'http://localhost:5173/?error=server_error&error_description=Database+error',
      readRedirectError,
    ),
    'Database error',
  );
  assert.equal(
    withUrl(
      'http://localhost:5173/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
      readRedirectError,
    ),
    'That link has expired or was already used. Ask for a new one.',
  );
  assert.equal(
    withUrl('http://localhost:5173/?error=access_denied', readRedirectError),
    'Sign-in was cancelled.',
  );
});

test('a normal URL or a successful return carries no error', () => {
  assert.equal(withUrl('http://localhost:5173/workspaces/1', readRedirectError), null);
  assert.equal(
    withUrl('http://localhost:5173/#access_token=abc&type=recovery', readRedirectError),
    null,
  );
});

test('password strength: too short, weak, good, strong', () => {
  assert.equal(passwordStrength('Ab1!'), 0);
  assert.equal(passwordStrength('abcdefgh'), 1);
  assert.equal(passwordStrength('abcdefg1'), 2);
  assert.equal(passwordStrength('Abcdefghij1!'), 3);
});

test('email check', () => {
  assert.equal(isEmail(' kiran.mulmi@gmail.com '), true);
  assert.equal(isEmail('kiran@'), false);
  assert.equal(isEmail('kiran mulmi@gmail.com'), false);
});

test('initials for the account avatar', () => {
  assert.equal(initialsOf('Kiran Mulmi', 'x@y.com'), 'KM');
  assert.equal(initialsOf(null, 'kiran.mulmi@gmail.com'), 'KM');
  assert.equal(initialsOf(null, 'kiran@gmail.com'), 'KI');
  assert.equal(initialsOf(null, null), '?');
});

test("the profile comes from the provider's metadata, photo over https only", () => {
  const user = (metadata: Record<string, unknown>) => ({ user_metadata: metadata }) as User;
  assert.deepEqual(
    profileOf(
      user({ full_name: 'Kiran Mulmi', avatar_url: 'https://lh3.googleusercontent.com/a/x' }),
    ),
    { name: 'Kiran Mulmi', avatarUrl: 'https://lh3.googleusercontent.com/a/x' },
  );
  assert.deepEqual(profileOf(user({ name: ' Kiran ', picture: 'http://example.com/a.png' })), {
    name: 'Kiran',
    avatarUrl: null,
  });
  assert.deepEqual(profileOf(user({})), { name: null, avatarUrl: null });
  assert.deepEqual(profileOf(null), { name: null, avatarUrl: null });
});
