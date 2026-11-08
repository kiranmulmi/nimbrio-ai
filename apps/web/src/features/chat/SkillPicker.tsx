import { SKILL_LIMITS, type Skill } from '@app/shared';
import { PlusIcon, SkillIcon } from '../../lib/icons';
import { useSkillDialog } from '../skills/SkillDialogProvider';
import { ComposerMenu, ComposerMenuItem } from './ComposerMenu';

const FOOTER_LINK =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink-2 outline-none transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle';

/**
 * The composer's Skills button: pick skills for the next message (they're sent with it in
 * full). Without picking any, the agent still chooses the skills a task needs itself.
 */
export function SkillPicker({
  skills,
  picked,
  onToggle,
}: {
  /** Null while loading. */
  skills: Skill[] | null;
  picked: readonly string[];
  onToggle: (name: string) => void;
}) {
  const { openSkill } = useSkillDialog();
  const isFull = picked.length >= SKILL_LIMITS.perMessage;
  const list = skills ?? [];

  return (
    <ComposerMenu
      label={
        <>
          <span className="hidden sm:inline">Skills</span>
          {picked.length > 0 && <span className="tabular-nums sm:ml-1">{picked.length}</span>}
        </>
      }
      icon={
        <SkillIcon
          size={13}
          className={`shrink-0 ${picked.length ? 'text-accent' : 'text-ink-3'}`}
        />
      }
      title="Use skills for this message. Without any, the agent picks the ones a task needs."
      menuLabel="Skills for this message"
      footer={(close) => (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            openSkill(null);
          }}
          className={FOOTER_LINK}
        >
          <PlusIcon size={12} className="text-ink-3" /> New skill
        </button>
      )}
    >
      {() =>
        list.length === 0 ? (
          <p className="px-3.5 py-2 text-[12.5px] leading-snug text-ink-3">
            {skills ? 'No skills in this workspace yet.' : 'Loading skills…'}
          </p>
        ) : (
          list.map((skill) => {
            const isPicked = picked.includes(skill.name);
            return (
              <ComposerMenuItem
                key={skill.name}
                kind="checkbox"
                isSelected={isPicked}
                // The menu stays open, so several can be picked in one go.
                onSelect={() => {
                  if (isPicked || !isFull) onToggle(skill.name);
                }}
                title={<span className="font-mono text-[12.5px]">{skill.name}</span>}
                detail={
                  !isPicked && isFull
                    ? `At most ${SKILL_LIMITS.perMessage} skills per message`
                    : skill.description
                }
              />
            );
          })
        )
      }
    </ComposerMenu>
  );
}
