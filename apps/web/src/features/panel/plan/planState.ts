import type { Plan, StepStatus } from '@app/shared';

export type PlanPhase = 'idle' | 'planning' | 'working';

/** The plan as the panel shows it, plus what the agent is doing with it right now. */
export type PlanState = {
  plan: Plan | null;
  /** The chat's earlier plans, oldest first: a new plan moves the current one here. */
  earlier: Plan[];
  phase: PlanPhase;
  /** The shown plan belongs to an earlier request (the latest one didn't need a plan). */
  stale: boolean;
  /** What the agent is doing right now, e.g. "Reading en.wikipedia.org". */
  activity: string | null;
  startedAt: number | null;
  /** Seconds the last run took, shown once it ends. */
  finishedIn: number | null;
};

export const initialPlanState: PlanState = {
  plan: null,
  earlier: [],
  phase: 'idle',
  stale: false,
  activity: null,
  startedAt: null,
  finishedIn: null,
};

export const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
  failed: "Couldn't finish",
};

/**
 * The plan the agent just sent. A plan made after the shown one (a different `createdAt`)
 * replaces it, and the shown one moves to `earlier`; an update of the same plan doesn't.
 */
export function withPlan(state: PlanState, plan: Plan | null): PlanState {
  const current = state.plan;
  const isNewPlan = current !== null && plan !== null && plan.createdAt !== current.createdAt;
  return {
    ...state,
    plan,
    stale: false,
    earlier: isNewPlan ? [...state.earlier, current] : state.earlier,
  };
}

/** Moves to another phase, starting the timer on the way in and stopping it on the way out. */
export function withPhase(state: PlanState, phase: PlanPhase, at: number): PlanState {
  if (phase === state.phase) return state;
  const wasRunning = state.phase !== 'idle';
  const next: PlanState = { ...state, phase };
  if (phase !== 'idle' && !wasRunning) {
    next.startedAt = at;
    next.finishedIn = null;
  }
  if (phase === 'idle') {
    if (wasRunning && state.startedAt !== null) next.finishedIn = (at - state.startedAt) / 1000;
    next.activity = null;
  }
  return next;
}

export function planCounts(plan: Plan) {
  const count = (status: StepStatus) => plan.steps.filter((s) => s.status === status).length;
  return {
    total: plan.steps.length,
    done: count('done'),
    skipped: count('skipped'),
    failed: count('failed'),
    open: count('pending') + count('in_progress'),
  };
}

export type PlanStatusKind = 'working' | 'idle' | 'complete' | 'gaps';

/**
 * The header pill: what state the plan is in right now. While the agent is only deciding
 * whether a message needs a plan, the shown plan keeps its own status: most messages don't.
 */
export function planStatus(state: PlanState): { kind: PlanStatusKind; label: string } | null {
  if (state.phase === 'working') return { kind: 'working', label: 'Working' };
  if (!state.plan) return null;
  if (state.stale) return { kind: 'idle', label: 'Earlier plan' };
  const counts = planCounts(state.plan);
  if (counts.done === counts.total) return { kind: 'complete', label: 'Complete' };
  return { kind: 'gaps', label: counts.open ? 'Stopped early' : 'Finished with gaps' };
}
