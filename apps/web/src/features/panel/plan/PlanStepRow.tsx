import type { Ref } from 'react';
import type { PlanStep, StepStatus } from '@app/shared';
import { CheckIcon, CrossIcon, DashIcon } from '../../../lib/icons';
import { ActivityLine } from './ActivityLine';
import { STATUS_LABEL } from './planState';

export const MARKER: Record<StepStatus, string> = {
  pending: 'border-line bg-surface text-ink-3',
  in_progress: 'border-accent bg-surface',
  done: 'border-transparent bg-success-bg text-success',
  failed: 'border-transparent bg-danger-bg text-danger',
  skipped: 'border-line bg-surface-2 text-ink-4',
};

const NOTE: Record<StepStatus, string> = {
  pending: 'text-ink-3',
  in_progress: 'text-ink-3',
  done: 'text-ink-3',
  failed: 'text-danger',
  skipped: 'text-ink-4',
};

export function Marker({ status, number }: { status: StepStatus; number: number }) {
  if (status === 'done') return <CheckIcon size={11} />;
  if (status === 'failed') return <CrossIcon size={11} />;
  if (status === 'skipped') return <DashIcon size={11} />;
  if (status === 'in_progress') {
    return (
      <span className="h-2.5 w-2.5 animate-spin-fast rounded-full border-2 border-accent border-r-transparent motion-reduce:animate-none" />
    );
  }
  return <>{number}</>;
}

/** One step of the plan. One line until clicked; the current step gets more room. */
export function PlanStepRow({
  step,
  index,
  isActive,
  isLast,
  isExpanded,
  animation,
  activity,
  onToggle,
  rowRef,
}: {
  step: PlanStep;
  index: number;
  isActive: boolean;
  isLast: boolean;
  isExpanded: boolean;
  /** `enter` for a step just added, `changed` for one whose status just changed. */
  animation: 'enter' | 'changed' | null;
  activity: string | null;
  onToggle: () => void;
  rowRef?: Ref<HTMLLIElement>;
}) {
  const textClamp = isExpanded ? '' : isActive ? 'line-clamp-4' : 'line-clamp-1';
  const isMuted = step.status === 'done' || step.status === 'skipped';

  return (
    <li
      ref={rowRef}
      className={`relative grid grid-cols-[20px_minmax(0,1fr)] gap-2.5 ${isLast ? '' : 'pb-3'} ${
        animation === 'enter' ? 'animate-enter motion-reduce:animate-none' : ''
      }`}
    >
      {!isLast && (
        <span
          aria-hidden
          className={`absolute bottom-0 left-[9.5px] top-[22px] w-px ${
            step.status === 'done' ? 'bg-success-line' : 'bg-line'
          }`}
        />
      )}
      <span
        aria-label={STATUS_LABEL[step.status]}
        className={`grid h-5 w-5 place-items-center rounded-full border-[1.5px] text-[10px] font-semibold tabular-nums ${
          MARKER[step.status]
        } ${animation === 'changed' ? 'animate-pop motion-reduce:animate-none' : ''}`}
      >
        <Marker status={step.status} number={index + 1} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        title={isExpanded ? undefined : 'Click to show the full step'}
        className={`flex min-w-0 flex-col gap-0.5 text-left ${
          isActive ? '-ml-1 -mt-1.5 border-l-2 border-accent bg-accent-soft px-2.5 py-2' : 'pt-0.5'
        }`}
      >
        {isActive && (
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-accent">
            In progress
          </span>
        )}
        <span
          className={`text-[12px] leading-[1.45] ${textClamp} ${
            isActive ? 'font-medium text-ink-2' : isMuted ? 'text-ink-3' : 'text-ink-2'
          } ${step.status === 'skipped' ? 'italic text-ink-3' : ''}`}
        >
          {step.text}
        </span>
        {step.note && (
          <span
            className={`max-w-full self-start text-[11.5px] leading-snug [overflow-wrap:anywhere] ${
              isExpanded ? '' : 'line-clamp-1'
            } ${NOTE[step.status]}`}
          >
            {step.note}
          </span>
        )}
        {isActive && activity && <ActivityLine text={activity} />}
      </button>
    </li>
  );
}
