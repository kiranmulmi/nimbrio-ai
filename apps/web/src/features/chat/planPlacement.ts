import type { Plan } from '@app/shared';
import type { PlanState } from '../panel/plan/planState';
import type { Turn } from './conversation';

export interface PlacedPlan {
  plan: Plan;
  /** The chat shows this plan's steps inline, where the agent worked on them. */
  hasInlineSteps: boolean;
}

/**
 * The plan each plan marker (a create_plan call) in the conversation stands for, by the
 * marker's key. The chat's plans (earlier ones, then the current one) are in the order the
 * calls made them; the goal is matched too, so a call that went missing doesn't shift the rest.
 */
export function placePlans(turns: readonly Turn[], state: PlanState): Map<string, PlacedPlan> {
  const plans = [...state.earlier, ...(state.plan ? [state.plan] : [])];
  const used = new Set<number>();
  const placed = new Map<string, PlacedPlan>();
  const withSteps = new Set<string>();
  for (const turn of turns) {
    if (turn.role !== 'agent') continue;
    for (const item of turn.flow)
      if (item.kind === 'step' && item.planKey) withSteps.add(item.planKey);
  }
  let next = 0;
  for (const turn of turns) {
    if (turn.role !== 'agent') continue;
    for (const item of turn.flow) {
      if (item.kind !== 'plan') continue;
      let index = plans.findIndex(
        (plan, at) => at >= next && !used.has(at) && plan.goal === item.goal,
      );
      if (index === -1) index = plans.findIndex((_, at) => at >= next && !used.has(at));
      if (index === -1) continue;
      used.add(index);
      next = index + 1;
      const plan = plans[index];
      if (plan) placed.set(item.key, { plan, hasInlineSteps: withSteps.has(item.key) });
    }
  }
  return placed;
}
