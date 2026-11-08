import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import { logLevelFor, serializeReq, serializeRes } from '../src/http-logging.js';

const fakeReq = (method: string, url: string) =>
  ({
    id: 7,
    method,
    url,
    headers: { cookie: 'auth_token=secret', authorization: 'Bearer secret' },
  }) as unknown as IncomingMessage & { id: unknown };

const fakeRes = (statusCode: number) =>
  ({
    statusCode,
    getHeaders: () => ({ 'set-cookie': 'session=secret' }),
  }) as unknown as ServerResponse;

const levelFor = (method: string, url: string, status: number, err?: Error) =>
  logLevelFor(fakeReq(method, url), fakeRes(status), err);

test('request logs keep only id, method and url, never headers or cookies', () => {
  const req = serializeReq(fakeReq('GET', '/v1/info'));
  assert.deepEqual(req, { id: 7, method: 'GET', url: '/v1/info' });
  assert.ok(!JSON.stringify(req).includes('secret'));
});

test('response logs keep only the status code', () => {
  const res = serializeRes(fakeRes(200));
  assert.deepEqual(res, { statusCode: 200 });
  assert.ok(!JSON.stringify(res).includes('secret'));
});

test('background polling logs at debug, other requests at info', () => {
  assert.equal(levelFor('GET', '/v1/info', 304), 'debug');
  assert.equal(levelFor('GET', '/v1/workspaces/abc/tasks', 200), 'debug');
  assert.equal(levelFor('GET', '/v1/workspaces/abc/tasks/t1', 200), 'debug');
  assert.equal(levelFor('POST', '/v1/workspaces/abc/tasks', 200), 'info');
  assert.equal(levelFor('GET', '/v1/workspaces/abc/chats', 200), 'info');
});

test('failures are never hidden, even on polled routes', () => {
  assert.equal(levelFor('GET', '/v1/workspaces/abc/tasks', 404), 'warn');
  assert.equal(levelFor('GET', '/v1/workspaces/abc/tasks', 500), 'error');
  assert.equal(levelFor('GET', '/v1/info', 200, new Error('boom')), 'error');
});
