import { CrossIcon, SkillIcon } from '../../lib/icons';

/** A skill picked for a message: in the composer (removable) and on the sent message. */
export function SkillChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span
      title={`Skill: ${name}`}
      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-accent-bg bg-accent-soft pl-2 pr-2 text-[12px] font-medium text-accent-2"
    >
      <SkillIcon size={12} className="shrink-0" />
      <span className="truncate font-mono">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Don't use the skill ${name}`}
          title="Remove"
          className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-md text-accent-2 transition-colors hover:bg-accent-bg"
        >
          <CrossIcon size={10} />
        </button>
      )}
    </span>
  );
}
