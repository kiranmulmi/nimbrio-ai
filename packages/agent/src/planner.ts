// The planner: decides whether a request needs a plan, writes it, and keeps the
// plan's state while the agent works through it.
//
//   decide()  - one model call before the agent acts: "direct" or a plan
//   create(), update(), addSteps() - plan state, also driven by the plan tools
import {
  STEP_STATUSES,
  type NumberedPlanStep,
  type Plan,
  type StepStatus,
  type Usage,
} from '@app/shared';
import type { CallModel } from './llm.js';
import type { ModelMessage } from './memory/short-term.js';
import { isRecord } from './errors.js';

export { STEP_STATUSES };

const ICONS: Record<StepStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  done: '[x]',
  skipped: '[-]',
  failed: '[!]',
};
const MAX_STEPS = 20;

export const isStepStatus = (value: unknown): value is StepStatus =>
  (STEP_STATUSES as readonly unknown[]).includes(value);

export class Planner {
  plan: Plan | null = null;
  /** Plans this chat had before the current one, oldest first. A new plan never erases one. */
  earlier: Plan[] = [];

  create(goal: string, steps: readonly string[], doneWhen = ''): string {
    const cleaned = steps.map((s) => String(s).trim()).filter(Boolean);
    if (!String(goal).trim()) throw new Error('A plan needs a goal.');
    if (cleaned.length === 0) throw new Error('A plan needs at least one step.');
    if (cleaned.length > MAX_STEPS) {
      throw new Error(`Keep plans to ${MAX_STEPS} steps or fewer; group smaller steps together.`);
    }
    if (this.plan) this.earlier.push(this.plan);
    this.plan = {
      goal: String(goal).trim(),
      doneWhen: String(doneWhen).trim(),
      steps: cleaned.map((text) => ({ text, status: 'pending', note: '' })),
      createdAt: new Date().toISOString(),
    };
    return this.render();
  }

  update(stepNumber: number, status: string, note = ''): string {
    if (!this.plan) throw new Error('There is no plan yet. Call create_plan first.');
    if (!isStepStatus(status)) throw new Error(`Unknown status "${status}".`);
    const step = this.plan.steps[stepNumber - 1];
    if (!step) {
      throw new Error(
        `Step ${stepNumber} doesn't exist; the plan has ${this.plan.steps.length} steps.`,
      );
    }
    step.status = status;
    if (note) step.note = note;
    return this.render();
  }

  /** Add steps discovered while working, at the end of the plan. */
  addSteps(steps: readonly string[]): string {
    if (!this.plan) throw new Error('There is no plan yet. Call create_plan first.');
    const cleaned = steps.map((s) => String(s).trim()).filter(Boolean);
    if (cleaned.length === 0) throw new Error('Give at least one step to add.');
    if (this.plan.steps.length + cleaned.length > MAX_STEPS) {
      throw new Error(
        `The plan would have more than ${MAX_STEPS} steps. Group the new work into fewer, broader steps.`,
      );
    }
    this.plan.steps.push(
      ...cleaned.map((text) => ({ text, status: 'pending' as const, note: '' })),
    );
    return this.render();
  }

  unfinishedSteps(): NumberedPlanStep[] {
    if (!this.plan) return [];
    return this.plan.steps
      .map((s, i) => ({ number: i + 1, ...s }))
      .filter((s) => s.status === 'pending' || s.status === 'in_progress');
  }

  isComplete(): boolean {
    return Boolean(this.plan) && this.unfinishedSteps().length === 0;
  }

  render(): string {
    if (!this.plan) return 'No plan.';
    const lines = this.plan.steps.map(
      (s, i) => `${ICONS[s.status]} ${i + 1}. ${s.text}${s.note ? `  (${s.note})` : ''}`,
    );
    const done = this.plan.steps.filter((s) => s.status === 'done').length;
    return [
      `Goal: ${this.plan.goal}`,
      ...lines,
      this.plan.doneWhen ? `Done when: ${this.plan.doneWhen}` : null,
      `Progress: ${done}/${this.plan.steps.length} done`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  reset(): void {
    this.plan = null;
    this.earlier = [];
  }
}

export type PlanDecision =
  | { mode: 'direct'; reason: string }
  | { mode: 'plan'; reason: string; goal: string; steps: string[]; done_when: string };

export interface DecideArgs {
  callModel: CallModel;
  /** the planner prompt */
  system: string;
  /** the user's new message */
  request: string;
  /** earlier conversation messages (OpenAI format) */
  history: readonly ModelMessage[];
  /** rendered unfinished plan from earlier, if any */
  currentPlan: string | null;
  /** saved memories, from renderMemories() */
  memories?: string;
  /** the workspace's instructions */
  instructions?: string;
  /** the workspace's skills, from renderSkills() */
  skills?: string;
}

/**
 * The planning step: one model call (no tools) that reads the request and
 * decides whether to answer directly or to plan first.
 */
export async function decide({
  callModel,
  system,
  request,
  history,
  currentPlan,
  memories,
  instructions,
  skills,
}: DecideArgs): Promise<{ decision: PlanDecision; usage: Usage }> {
  const context = summarizeHistory(history);
  const content = [
    instructions?.trim() ? `Workspace instructions from the user:\n${instructions.trim()}` : null,
    skills ? `Skills in this workspace (loaded with use_skill):\n${skills}` : null,
    memories ? `Saved memories about the user (from earlier sessions):\n${memories}` : null,
    context ? `Conversation so far:\n${context}` : null,
    currentPlan ? `An earlier plan is still unfinished:\n${currentPlan}` : null,
    `Latest request:\n${request}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { message, usage } = await callModel({ system, messages: [{ role: 'user', content }] });
  return { decision: parseDecision(message.content ?? ''), usage };
}

/** Recent user/assistant text only (no tool traffic), so the planner call stays small. */
function summarizeHistory(
  messages: readonly ModelMessage[],
  { maxMessages = 8, maxChars = 1200 } = {},
): string {
  return messages
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim(),
    )
    .slice(-maxMessages)
    .map(
      (m) =>
        `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.length > maxChars ? `${m.content.slice(0, maxChars)}…` : m.content}`,
    )
    .join('\n');
}

/** Where models put a step's text when they send steps as objects instead of strings. */
const STEP_TEXT_KEYS = [
  'text',
  'description',
  'step',
  'title',
  'task',
  'action',
  'content',
  'name',
];

/**
 * One planned step as text. Some models send `{ "step": 1, "description": "…" }` instead of a
 * string; its text is used (never "[object Object]"), and a step with no text is dropped.
 */
function stepText(step: unknown): string {
  if (typeof step === 'string') return step.trim();
  if (!isRecord(step)) return '';
  const values = [...STEP_TEXT_KEYS.map((key) => step[key]), ...Object.values(step)];
  const text = values.find((value) => typeof value === 'string' && value.trim());
  return typeof text === 'string' ? text.trim() : '';
}

/** Read the planner's JSON reply. Anything unusable means "answer directly". */
export function parseDecision(text: string): PlanDecision {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { mode: 'direct', reason: 'The planner reply had no JSON, so answering directly.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {
      mode: 'direct',
      reason: "The planner reply wasn't valid JSON, so answering directly.",
    };
  }
  const reply = isRecord(parsed) ? parsed : {};
  const steps = Array.isArray(reply.steps) ? reply.steps.map(stepText).filter(Boolean) : [];
  if (reply.mode === 'plan' && steps.length > 0 && String(reply.goal ?? '').trim()) {
    return {
      mode: 'plan',
      reason: String(reply.reason ?? ''),
      goal: String(reply.goal),
      steps: steps.slice(0, MAX_STEPS),
      done_when: String(reply.done_when ?? ''),
    };
  }
  return { mode: 'direct', reason: String(reply.reason ?? '') };
}
