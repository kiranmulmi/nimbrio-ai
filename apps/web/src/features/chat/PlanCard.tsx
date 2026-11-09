import type { Plan } from '@app/shared';
import { EarlierPlan } from '../panel/plan/EarlierPlan';

/**
 * A plan where the agent made it in the conversation. When its steps show inline (each above
 * the work done for it) this is only the goal; otherwise (a plan worked on without step
 * updates) it folds open to the step list.
 */
export function PlanCard({ plan, hasInlineSteps }: { plan: Plan; hasInlineSteps: boolean }) {
  if (!hasInlineSteps) return <EarlierPlan plan={plan} />;
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <p className="text-[12.5px] font-semibold leading-snug text-ink-2">{plan.goal}</p>
    </div>
  );
}
