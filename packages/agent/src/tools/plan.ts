import { defineTool } from './define.js';
import { STEP_STATUSES } from '../planner.js';

export const createPlan = defineTool<{ goal: string; steps: string[]; done_when: string }>({
  name: 'create_plan',
  description:
    "Write a step-by-step plan for a task with several distinct steps. A plan is usually made for you before you start; call this only to re-plan when what you've learned changes the approach (it replaces the current plan). Don't use it for simple questions.",
  properties: {
    goal: { type: 'string', description: 'What the finished task achieves, in one sentence.' },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ordered, concrete steps (usually 2-8).',
    },
    done_when: {
      type: 'string',
      description: 'A concrete test for when the whole task is complete, or "" if obvious.',
    },
  },
  async run({ goal, steps, done_when }, ctx) {
    return ctx.planner.create(goal, steps, done_when);
  },
});

export const updatePlan = defineTool<{ step_number: number; status: string; note: string }>({
  name: 'update_plan',
  description:
    "Mark a plan step's progress. Call it when you start a step (in_progress) and when you finish it (done), or when a step is skipped or failed, with a short note on the result.",
  properties: {
    step_number: { type: 'integer', description: '1-based step number from the plan.' },
    status: { type: 'string', enum: STEP_STATUSES },
    note: { type: 'string', description: 'Short result or reason, or "" for none.' },
  },
  async run({ step_number, status, note }, ctx) {
    return ctx.planner.update(step_number, status, note);
  },
});

export const addPlanSteps = defineTool<{ steps: string[] }>({
  name: 'add_plan_steps',
  description:
    'Add steps to the end of the current plan when you discover more work, for example a sub-company whose own subsidiaries still need looking up. Keeps the existing steps and their progress.',
  properties: {
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'New concrete steps, in order.',
    },
  },
  async run({ steps }, ctx) {
    return ctx.planner.addSteps(steps);
  },
});
