// Offline tests for messages sent while the agent works. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatDetail } from '@app/shared';
import {
  conversationReducer,
  initialConversation,
  type ConversationState,
  type ConversationAction,
} from '../src/features/chat/conversation';

const at = Date.parse('2026-11-07T10:00:00.000Z');
const play = (actions: ConversationAction[], from: ConversationState = initialConversation) =>
  actions.reduce(conversationReducer, from);

test('a message the agent read mid-run shows as the user’s, and the work goes on below it', () => {
  const state = play([
    { type: 'send', text: 'Count the files', attachments: [], skills: [], at },
    { type: 'event', event: { type: 'tool_call', id: 't1', name: 'list_files', args: '{}' }, at },
    {
      type: 'event',
      event: { type: 'tool_result', id: 't1', name: 'list_files', ok: true, preview: 'a.ts' },
      at,
    },
    {
      type: 'event',
      event: {
        type: 'steer',
        id: 's1',
        text: 'Only .ts files',
        sentAt: '2026-11-07T10:00:05.000Z',
      },
      at,
    },
    { type: 'event', event: { type: 'text_delta', text: '1 .ts file.' }, at },
    {
      type: 'event',
      event: {
        type: 'done',
        result: {
          text: '1 .ts file.',
          status: 'done',
          steps: 2,
          toolsUsed: ['list_files'],
          usage: { inputTokens: 10, outputTokens: 5 },
          calls: [],
        },
      },
      at,
    },
  ]);
  assert.deepEqual(
    state.turns.map((turn) =>
      turn.role === 'user' ? `user:${turn.text}:${turn.isSteer}` : 'agent',
    ),
    ['user:Count the files:false', 'agent', 'user:Only .ts files:true', 'agent'],
  );
  const [, first, , last] = state.turns;
  assert.ok(first?.role === 'agent' && last?.role === 'agent');
  assert.equal(first.status, null, 'the earlier part no longer says it is working');
  assert.equal(first.meta, null);
  assert.match(last.meta ?? '', /2 steps/, "the run's steps and tokens go under its end");
});

test('a reloaded chat marks the message sent mid-run', () => {
  const detail = {
    chat: {},
    history: [
      { role: 'user', text: 'Count', attachments: [], skills: [], sentAt: null },
      { role: 'assistant', text: 'On it.' },
      { role: 'user', text: 'Only .ts', attachments: [], skills: [], sentAt: null, steer: true },
      { role: 'assistant', text: '1 file.' },
    ],
    plan: null,
    earlierPlans: [],
  } as unknown as ChatDetail;
  const state = play([{ type: 'load', detail }]);
  assert.deepEqual(
    state.turns.map((turn) => turn.role === 'user' && turn.isSteer),
    [false, false, true, false],
  );
});
