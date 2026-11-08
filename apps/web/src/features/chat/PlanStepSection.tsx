import type { ReactNode } from 'react';
import type { PlanStep, StepStatus } from '@app/shared';
import { MARKER, Marker } from '../panel/plan/PlanStepRow';
import { STATUS_LABEL } from '../panel/plan/planState';

const NOTE: Record<StepStatus, string> = {
  pending: 'text-ink-3',
  in_progress: 'text-ink-3',
  done: 'text-ink-3',
  failed: 'text-danger',
  skipped: 'text-ink-4',
};

/**
 * A plan step in the chat: its number, status and text, then the work done for it (tool
 * calls, notes, text) under a thin line, so the turn reads step by step as it happens.
 */
export function PlanStepSection({
  step,
  number,
  hasWork,
  children,
}: {
  /** The step as the plan has it now; null if the plan isn't known (e.g. it was replaced). */
  step: PlanStep | null;
  number: number;
  hasWork: boolean;
  children: ReactNode;
}) {
  const status: StepStatus = step?.status ?? 'in_progress';
  const isActive = status === 'in_progress';

  return (
    <section aria-label={`Step ${number}`} className="flex flex-col gap-1.5 pt-1">
      <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5 px-0.5">
        <span
          aria-label={STATUS_LABEL[status]}
          className={`mt-px grid h-5 w-5 place-items-center rounded-full border-[1.5px] text-[10px] font-semibold tabular-nums ${MARKER[status]}`}
        >
          <Marker status={status} number={number} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {status !== 'done' && (
            <span
              className={`text-[10px] font-medium uppercase tracking-[0.12em] ${
                isActive ? 'text-accent' : 'text-ink-3'
              }`}
            >
              {STATUS_LABEL[status]}
            </span>
          )}
          <p
            className={`text-[13px] font-medium leading-[1.45] [overflow-wrap:anywhere] ${
              status === 'skipped' ? 'italic text-ink-3' : 'text-ink-2'
            }`}
          >
            {step?.text ?? `Step ${number}`}
          </p>
          {step?.note && !isActive && (
            <p className={`text-[12px] leading-snug [overflow-wrap:anywhere] ${NOTE[status]}`}>
              {step.note}
            </p>
          )}
        </div>
      </div>
      {hasWork && (
        <div
          className={`ml-[10.5px] flex flex-col gap-1.5 border-l pl-[17px] ${
            status === 'done' ? 'border-success-line' : 'border-line'
          }`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
