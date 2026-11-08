import { Badge, type BadgeTone } from '../../../components/Badge';
import { Spinner } from '../../../components/Spinner';
import { CheckIcon, WarnIcon } from '../../../lib/icons';
import type { PlanStatusKind } from './planState';

const TONE: Record<PlanStatusKind, BadgeTone> = {
  working: 'blue',
  complete: 'green',
  gaps: 'yellow',
  idle: 'grey',
};

export function StatusPill({
  kind,
  label,
  timer,
}: {
  kind: PlanStatusKind;
  label: string;
  timer: string | null;
}) {
  const isSpinning = kind === 'working';
  const icon = isSpinning ? (
    <Spinner size={9} label={label} />
  ) : kind === 'complete' ? (
    <CheckIcon size={11} />
  ) : kind === 'gaps' ? (
    <WarnIcon size={11} />
  ) : null;
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={TONE[kind]} icon={icon}>
        {label}
      </Badge>
      {timer && <span className="text-[12px] tabular-nums text-ink-3">{timer}</span>}
    </span>
  );
}
