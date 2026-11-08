import type { PlanStep, StepStatus } from '@app/shared';
import { STATUS_LABEL } from './planState';

const SEGMENT: Record<StepStatus, string> = {
  pending: 'bg-line',
  done: 'bg-success-line',
  failed: 'bg-danger-line',
  skipped: 'bg-ink-4',
  in_progress:
    'animate-shimmer bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-bg)_50%,var(--accent)_100%)] bg-[length:200%_100%] motion-reduce:animate-none',
};

/** One segment per step, coloured by its status. */
export function SegmentBar({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((step) => step.status === 'done').length;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={done}
      className="flex h-1.5 gap-[3px]"
    >
      {steps.map((step, index) => (
        <span
          key={index}
          title={`${STATUS_LABEL[step.status]}: ${step.text}`}
          className={`flex-1 transition-colors duration-300 ${SEGMENT[step.status]}`}
        />
      ))}
    </div>
  );
}
