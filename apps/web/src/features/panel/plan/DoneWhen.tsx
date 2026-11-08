import { TargetIcon } from '../../../lib/icons';

/** The plan's own test for when the work is finished. */
export function DoneWhen({ text }: { text: string }) {
  return (
    <div className="flex gap-3 border-l-[3px] border-l-accent py-1 pl-3.5">
      <TargetIcon size={16} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <div className="eyebrow">Done when</div>
        <p className="mt-1 text-[12px] leading-[1.5] text-ink-3">{text}</p>
      </div>
    </div>
  );
}
