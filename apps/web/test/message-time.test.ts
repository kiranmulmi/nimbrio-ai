// Offline tests for the time shown under a user's message. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatDetail } from '@app/shared';
import {
  conversationReducer,
  initialConversation,
  type ConversationState,
  type UserTurn,
} from '../src/features/chat/conversation';
import { replyTime } from '../src/lib/format';

const userTurns = (state: ConversationState): UserTurn[] =>
  state.turns.filter((turn): turn is UserTurn => turn.role === 'user');

test('a sent message keeps the time it was sent', () => {
  const at = Date.parse('2026-03-04T10:20:30.000Z');
  const state = conversationReducer(initialConversation, {
    type: 'send',
    text: 'hi',
    attachments: [],
    skills: [],
    at,
  });
  assert.deepEqual(
    userTurns(state).map((turn) => turn.sentAt),
    ['2026-03-04T10:20:30.000Z'],
  );
});

test('a reloaded chat shows when each message was sent, or nothing when unknown', () => {
  const detail = {
    chat: {},
    history: [
      {
        role: 'user',
        text: 'one',
        attachments: [],
        skills: [],
        sentAt: '2026-03-04T10:00:00.000Z',
      },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: 'two', attachments: [], skills: [], sentAt: null },
    ],
    plan: null,
    earlierPlans: [],
  } as unknown as ChatDetail;
  const state = conversationReducer(initialConversation, { type: 'load', detail });
  assert.deepEqual(
    userTurns(state).map((turn) => turn.sentAt),
    ['2026-03-04T10:00:00.000Z', null],
  );
});

test('the sent time reads like a reply time', () => {
  const sent = '2026-03-04T10:00:00.000Z';
  assert.equal(replyTime(sent, Date.parse(sent) + 5 * 60_000).text, '5m ago');
  assert.equal(replyTime(null, Date.now()).text, '');
});
