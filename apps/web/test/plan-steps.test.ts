// Offline tests for how plan steps show in the chat: each step's text above the work done
// for it. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatDetail, Plan } from '@app/shared';
import {
  conversationReducer,
  initialConversation,
  type AgentTurn,
  type ConversationState,
  type RunEvent,
} from '../src/features/chat/conversation';
import { flowSections, type Section } from '../src/features/chat/flowSections';
import { placePlans } from '../src/features/chat/planPlacement';

const plan: Plan = {
  goal: 'Fix the bug',
  doneWhen: 'Tests pass',
  steps: [
    { text: 'Find the code', status: 'done', note: '' },
    { text: 'Change it', status: 'done', note: '' },
    { text: 'Run the tests', status: 'pending', note: '' },
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
};

let id = 0;
function call(name: string, args: object, ok = true): RunEvent[] {
  id += 1;
  const callId = `c${id}`;
  return [
    { type: 'tool_call', id: callId, name, args: JSON.stringify(args) },
    { type: 'tool_result', id: callId, name, ok, preview: 'ok' },
  ];
}
const step = (n: number, status: string, ok = true) =>
  call('update_plan', { step_number: n, status, note: '' }, ok);
const read = (path: string) => call('read_file', { path });

function run(events: RunEvent[]): ConversationState {
  let state = conversationReducer(initialConversation, {
    type: 'send',
    text: 'fix it',
    attachments: [],
    skills: [],
    at: 0,
  });
  for (const event of events) state = conversationReducer(state, { type: 'event', event, at: 0 });
  return state;
}

const agentTurn = (state: ConversationState): AgentTurn => {
  const turn = state.turns.at(-1);
  assert.equal(turn?.role, 'agent');
  return turn as AgentTurn;
};

/** A compact picture of the sections: `plan`, `step 1: tools×5`, `text`… */
function shape(sections: Section[]): string[] {
  const block = (b: Exclude<Section, { kind: 'section' }>) =>
    b.kind === 'tools' ? `tools×${b.items.length}` : b.kind;
  return sections.map((s) =>
    s.kind === 'section' ? `step ${s.step.number}: ${s.blocks.map(block).join(', ')}` : block(s),
  );
}

test('each step shows above the tool calls made for it', () => {
  const state = run([
    ...call('create_plan', { goal: 'Fix the bug', steps: [], done_when: '' }),
    { type: 'plan', plan },
    ...step(1, 'in_progress'),
    ...read('a'),
    ...read('b'),
    ...read('c'),
    ...read('d'),
    ...read('e'),
    ...step(1, 'done'),
    ...step(2, 'in_progress'),
    { type: 'text_delta', text: 'Editing now.' },
    ...call('edit_file', { path: 'a' }),
    ...step(2, 'done'),
  ]);
  assert.deepEqual(shape(flowSections(agentTurn(state).flow)), [
    'plan',
    'step 1: tools×5',
    'step 2: text, tools×1',
  ]);
});

test('the answer and warnings stand outside the last step', () => {
  const state = run([
    ...call('create_plan', { goal: 'Fix the bug', steps: [], done_when: '' }),
    ...step(1, 'in_progress'),
    ...read('a'),
    { type: 'limit', reason: 'too many steps' },
    { type: 'text_delta', text: 'All done.' },
    {
      type: 'done',
      result: {
        status: 'done',
        text: 'All done.',
        steps: 3,
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    } as RunEvent,
  ]);
  assert.deepEqual(shape(flowSections(agentTurn(state).flow)), [
    'plan',
    'step 1: tools×1',
    'note',
    'text',
  ]);
});

test('work before the first step stays loose; a step finished without starting still shows', () => {
  const state = run([
    ...read('first'),
    ...call('create_plan', { goal: 'Fix the bug', steps: [], done_when: '' }),
    ...step(1, 'skipped'),
    ...step(2, 'in_progress'),
    ...read('a'),
    ...step(2, 'done'),
    ...call('add_plan_steps', { steps: ['More'] }),
    ...step(3, 'in_progress'),
    ...read('b'),
  ]);
  assert.deepEqual(shape(flowSections(agentTurn(state).flow)), [
    'tools×1',
    'plan',
    'step 1: ',
    'step 2: tools×1',
    'note',
    'step 3: tools×1',
  ]);
});

test('repeated or failed step updates add no extra headers', () => {
  const state = run([
    ...call('create_plan', { goal: 'Fix the bug', steps: [], done_when: '' }),
    ...step(1, 'in_progress'),
    ...step(1, 'in_progress'),
    ...read('a'),
    ...step(2, 'in_progress', false),
    ...read('b'),
  ]);
  assert.deepEqual(shape(flowSections(agentTurn(state).flow)), ['plan', 'step 1: tools×2']);
});

test('a reloaded chat shows the steps inline the same way', () => {
  const tool = (name: string, args: object, ok = true) => ({
    role: 'tool' as const,
    name,
    args: JSON.stringify(args),
    ok,
    result: 'ok',
  });
  const detail = {
    history: [
      { role: 'user', text: 'fix it', attachments: [], skills: [], sentAt: null },
      tool('create_plan', { goal: 'Fix the bug' }),
      tool('update_plan', { step_number: 1, status: 'in_progress', note: '' }),
      tool('read_file', { path: 'a' }),
      tool('read_file', { path: 'b' }),
      tool('update_plan', { step_number: 1, status: 'done', note: '' }),
      tool('update_plan', { step_number: 2, status: 'in_progress', note: '' }),
      tool('update_plan', { step_number: 3, status: 'in_progress', note: '' }, false),
      tool('edit_file', { path: 'a' }),
      { role: 'assistant', text: 'Fixed.' },
    ],
    plan,
    earlierPlans: [],
  } as unknown as ChatDetail;
  const state = conversationReducer(initialConversation, { type: 'load', detail });
  const turn = agentTurn(state);
  assert.deepEqual(shape(flowSections(turn.flow)), [
    'plan',
    'step 1: tools×2',
    'step 2: tools×1',
    'text',
  ]);

  // The plan card knows its steps are inline, so it shows only the goal and progress.
  const placed = [...placePlans(state.turns, state.plan).values()];
  assert.equal(placed.length, 1);
  assert.equal(placed[0]?.hasInlineSteps, true);
});

test('a plan without step updates keeps its full step list', () => {
  const state = run([
    ...call('create_plan', { goal: 'Fix the bug', steps: [], done_when: '' }),
    { type: 'plan', plan },
    ...read('a'),
  ]);
  assert.deepEqual(shape(flowSections(agentTurn(state).flow)), ['plan', 'tools×1']);
  const placed = [...placePlans(state.turns, state.plan).values()];
  assert.equal(placed[0]?.hasInlineSteps, false);
});
