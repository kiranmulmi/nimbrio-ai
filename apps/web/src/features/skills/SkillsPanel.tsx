import { useCallback, useState } from 'react';
import type { Skill } from '@app/shared';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { CrossIcon, PlusIcon, SkillIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import type { AsyncResource } from '../../lib/useAsync';
import { PanelMessage } from '../panel/PanelMessage';
import { deleteSkill } from './api';
import { useSkillDialog } from './SkillDialogProvider';

/**
 * The Skills tab: the workspace's skills, each a name and when to use it. The agent picks
 * the ones a task needs; the composer's Skills button adds them to a message by hand.
 * Created and edited in a popup (SkillDialog).
 */
export function SkillsPanel({
  workspaceId,
  skills,
}: {
  workspaceId: string;
  skills: AsyncResource<Skill[]>;
}) {
  const toast = useToast();
  const { openSkill } = useSkillDialog();
  const [pending, setPending] = useState<Skill | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const list = skills.data ?? [];

  const confirm = async () => {
    if (!pending) return;
    setIsDeleting(true);
    try {
      await deleteSkill(workspaceId, pending.name);
      skills.setData((current) => current?.filter((skill) => skill.name !== pending.name) ?? null);
      toast('Skill deleted');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the skill."), 'error');
    } finally {
      setIsDeleting(false);
      setPending(null);
    }
  };
  const cancel = useCallback(() => setPending(null), []);

  return (
    <>
      <div className="mb-2 flex min-h-7 items-center justify-between">
        <span className="eyebrow">{list.length ? plural(list.length, 'skill') : 'Skills'}</span>
        <Button size="sm" onClick={() => openSkill(null)}>
          <PlusIcon size={11} /> New skill
        </Button>
      </div>

      {!skills.data ? (
        <PanelMessage isLoading={skills.isLoading} error={skills.error} onRetry={skills.reload} />
      ) : (
        <ul className={list.length ? 'panel divide-y divide-line-2' : ''}>
          {list.length === 0 && (
            <li className="border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">
              No skills yet. Write one for a task you repeat, like a ticket workflow or a review
              checklist.
            </li>
          )}
          {list.map((skill) => (
            <li
              key={skill.name}
              className="group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-subtle"
            >
              <SkillIcon size={14} className="mt-0.5 shrink-0 text-accent" />
              <button
                type="button"
                onClick={() => openSkill(skill.name)}
                title="Edit this skill"
                className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-1 focus-visible:after:ring-accent"
              >
                <span className="block truncate font-mono text-[12.5px] font-semibold text-ink">
                  {skill.name}
                </span>
                <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">
                  {skill.description || 'No description: the agent won’t know when to use it.'}
                </span>
              </button>
              <button
                type="button"
                title="Delete this skill"
                aria-label={`Delete the skill ${skill.name}`}
                onClick={() => setPending(skill)}
                className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <CrossIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        The agent sees each skill&apos;s name and description and loads the ones a task needs. To
        use one for a message yourself, pick it with the Skills button in the message box.
      </p>

      <ConfirmDeleteDialog
        open={pending !== null}
        title="Delete this skill?"
        message={
          <>
            <strong className="font-mono text-ink">{pending?.name}</strong> is deleted from this
            workspace. The agent won&apos;t see it from your next message.
          </>
        }
        busy={isDeleting}
        onCancel={cancel}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
