// Offline tests for reading the login shell's PATH. Run with: npm run test -w @app/desktop
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePaths, parseMarkedPath } from '../src/shell-path.js';

test('takes the PATH between the markers, ignoring what start-up files print', () => {
  const output = 'Welcome back!\n__NIMBRIO_PATH__/opt/homebrew/bin:/usr/bin__NIMBRIO_PATH__\nbye';
  assert.equal(parseMarkedPath(output), '/opt/homebrew/bin:/usr/bin');
});

test('no PATH when the markers are missing, unfinished or empty', () => {
  assert.equal(parseMarkedPath(''), null);
  assert.equal(parseMarkedPath('__NIMBRIO_PATH__/usr/bin'), null);
  assert.equal(parseMarkedPath('__NIMBRIO_PATH____NIMBRIO_PATH__'), null);
});

test("merges the shell's PATH first, then the folders only the app had, without repeats", () => {
  assert.equal(
    mergePaths('/opt/homebrew/bin:/usr/bin:/bin', '/usr/bin:/bin:/usr/sbin:/sbin'),
    '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  );
  assert.equal(mergePaths('', '/usr/bin'), '/usr/bin');
});
