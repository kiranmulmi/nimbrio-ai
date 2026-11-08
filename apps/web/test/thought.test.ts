// Offline tests for "Thought for 12s": how long the run's planning step took, live and after a
// reload. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatDetail } from '@app/shared';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
  type ConversationState,
  type ThoughtItem,
} from '../src/features/chat/conversation';
import { thoughtDuration } from '../src/features/chat/ThoughtLine';

const play = (actions: ConversationAction[]): ConversationState =>
  actions.reduce(conversationReducer, initialConversation);

const thoughts = (state: ConversationState): ThoughtItem[] =>
  state.turns.flatMap((turn) =>
    turn.role === 'agent'
      ? turn.flow.filter((item): item is ThoughtItem => item.kind === 'thought')
      : [],
  );

const send: ConversationAction = {
  type: 'send',
  text: 'Fix it',
  attachments: [],
  skills: [],
  at: 1_000,
};

test('the planning step is timed from its start to its decision', () => {
  const planning = play([send, { type: 'event', event: { type: 'planning' }, at: 1_000 }]);
  assert.equal(thoughts(planning)[0]?.durationMs, null, 'no time while it still thinks');

  const decided = conversationReducer(planning, {
    type: 'event',
    event: { type: 'route', mode: 'plan', reason: '', steps: 3 },
    at: 13_400,
  });
  const [thought] = thoughts(decided);
  assert.equal(thought?.durationMs, 12_400);
  const turn = decided.turns.at(-1);
  assert.equal(turn?.role === 'agent' && turn.flow[0]?.kind, 'thought', 'first in the reply');
});

test('a run without a planning step shows no thought', () => {
  const state = play([send, { type: 'event', event: { type: 'model_call', step: 1 }, at: 1_000 }]);
  assert.deepEqual(thoughts(state), []);
});

test("a reloaded chat shows its planner call's duration at the start of the run", () => {
  const meta = (calls: { kind: string; durationMs: number }[]) => ({
    role: 'meta',
    status: 'done',
    steps: 2,
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    calls,
    finishedAt: null,
  });
  const detail = {
    chat: {},
    history: [
      { role: 'user', text: 'Count', attachments: [], skills: [], sentAt: null },
      { role: 'assistant', text: 'On it.' },
      { role: 'user', text: 'Only .ts', attachments: [], skills: [], sentAt: null, steer: true },
      { role: 'assistant', text: '1 file.' },
      meta([
        { kind: 'planner', durationMs: 3_200 },
        { kind: 'step', durationMs: 900 },
      ]),
      { role: 'user', text: 'Thanks', attachments: [], skills: [], sentAt: null },
      { role: 'assistant', text: 'Welcome.' },
      meta([{ kind: 'step', durationMs: 500 }]),
    ],
    plan: null,
    earlierPlans: [],
  } as unknown as ChatDetail;
  const state = play([{ type: 'load', detail }]);

  assert.deepEqual(
    thoughts(state).map((item) => item.durationMs),
    [3_200],
  );
  const first = state.turns[1];
  assert.ok(first?.role === 'agent');
  assert.equal(first.flow[0]?.kind, 'thought', 'before the turn that the steer split off');
  const end = state.turns[3];
  assert.ok(end?.role === 'agent');
  assert.match(end.meta ?? '', /2 steps/, "the run's steps line stays at its end");
});

test('durations read as seconds, then minutes', () => {
  assert.equal(thoughtDuration(200), '1s');
  assert.equal(thoughtDuration(12_400), '12s');
  assert.equal(thoughtDuration(65_000), '1m 5s');
  assert.equal(thoughtDuration(120_000), '2m');
});
