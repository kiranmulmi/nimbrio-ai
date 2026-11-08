import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  SKILL_LIMITS,
  SKILL_REQUEST_MAX_CHARS,
  skillInputSchema,
  toSkillName,
  type Skill,
} from '@app/shared';
import { AiWritingEditor, type AiChip } from '../../components/AiWritingEditor';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';
import { Modal } from '../../components/Modal';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { ApiError, errorMessage, isNotFound } from '../../lib/api';
import { TrashIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import { createSkill, deleteSkill, fetchSkill, improveSkill, updateSkill } from './api';

type Field = 'name' | 'description' | 'body';
type Errors = Partial<Record<Field, string>>;
interface Draft {
  name: string;
  description: string;
  body: string;
}

const EMPTY: Draft = { name: '', description: '', body: '' };
const SECTION = 'px-5 py-4';
const DESCRIPTION_PLACEHOLDER = 'When the user gives a Jira ticket to check, confirm or fix.';
const BODY_PLACEHOLDER = `Phase 1 (read-only): fetch the ticket and verify its claim against the code, with file:line citations.
Phase 2: propose the smallest fix, then stop and wait for approval.
Phase 3 (after approval): apply exactly what was approved and run the tests.`;

/** One click: a request sent as it is (the model also sees the name and description). */
const STARTERS = [
  'Fix a Jira ticket: verify, propose a fix, wait for approval, apply',
  'Review a pull request: list bugs and risks with file:line',
  'Release checklist: build, test, bump version, changelog',
];
const REFINEMENTS: readonly AiChip[] = [
  { label: 'Tidy into steps', request: '' },
  { label: 'Shorter', request: 'Make it shorter and keep only the steps and rules that matter.' },
  {
    label: 'Add an approval stop',
    request:
      'Add a clear point where the agent stops and waits for my approval before changing anything.',
  },
  {
    label: 'Add checks before done',
    request: 'Add what the agent must check before it says the task is done (build, tests, lint).',
  },
];

/**
 * The instructions box keeps a steady height that fits the skill popup (max-h 88vh) with the
 * name, description, AI bar and buttons in view, so only the text scrolls. Never below 160px.
 */
const BODY_HEIGHT = 'h-[max(140px,calc(88vh-690px))] sm:h-[max(160px,calc(88vh-520px))]';

/**
 * Write or edit one of the workspace's skills in a popup (`name` null: a new one). Saved as
 * `.nimbrio-ai/skills/<name>.md`. Closing with unsaved changes asks first.
 */
export function SkillDialog({
  workspaceId,
  name: skillName,
  onClose,
  onSaved,
  onDeleted,
}: {
  workspaceId: string;
  name: string | null;
  onClose: () => void;
  /** `previousName`: the name it had before (a rename), or null for a new skill */
  onSaved: (skill: Skill, previousName: string | null) => void;
  onDeleted: (name: string) => void;
}) {
  const isEdit = skillName !== null;
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // What was loaded (or empty for a new skill), to tell whether there are unsaved changes.
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  // The AI writer: busy (Save waits), and the description it replaced (for Undo).
  const [isImproving, setIsImproving] = useState(false);
  const descriptionBeforeAi = useRef<string | null>(null);

  const isDirty =
    draft.name !== saved.name ||
    draft.description !== saved.description ||
    draft.body !== saved.body;

  useEffect(() => {
    if (!skillName) return;
    let isCurrent = true;
    setIsLoading(true);
    fetchSkill(workspaceId, skillName)
      .then((skill) => {
        if (!isCurrent) return;
        const loaded = { name: skill.name, description: skill.description, body: skill.body };
        setDraft(loaded);
        setSaved(loaded);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(
          isNotFound(cause)
            ? 'That skill no longer exists.'
            : errorMessage(cause, "Couldn't load the skill."),
          isNotFound(cause) ? 'warning' : 'error',
        );
        onClose();
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, skillName, onClose, toast]);

  const change = (field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setIsClosing(false);
    if (field === 'description') descriptionBeforeAi.current = null;
  };

  /** Escape, the overlay or Close: straight away, or after asking when there are changes. */
  const requestClose = useCallback(() => {
    if (isDeleteOpen || isSaving) return; // the delete confirmation handles its own Escape
    if (isDirty) setIsClosing(true);
    else onClose();
  }, [isDeleteOpen, isSaving, isDirty, onClose]);

  /** The AI writer: returns the new instructions; an empty description gets its suggestion. */
  const writeSkill = async (request: string, body: string): Promise<string> => {
    const improved = await improveSkill({
      request,
      name: toSkillName(draft.name) || undefined,
      description: draft.description,
      body,
    });
    // A description the user wrote stays theirs; an empty one gets the suggestion.
    if (!draft.description.trim() && improved.description) {
      descriptionBeforeAi.current = draft.description;
      setDraft((current) => ({ ...current, description: improved.description }));
      setErrors((current) => ({ ...current, description: undefined }));
    } else {
      descriptionBeforeAi.current = null;
    }
    return improved.body;
  };
  const undoDescription = () => {
    const previous = descriptionBeforeAi.current;
    if (previous === null) return;
    setDraft((current) => ({ ...current, description: previous }));
    descriptionBeforeAi.current = null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = skillInputSchema.safeParse({ ...draft, name: toSkillName(draft.name) });
    if (!checked.success) {
      const next: Errors = {};
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if ((field === 'name' || field === 'description' || field === 'body') && !next[field]) {
          next[field] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setDraft((current) => ({ ...current, name: checked.data.name }));

    setIsSaving(true);
    setIsClosing(false);
    try {
      const skill = skillName
        ? await updateSkill(workspaceId, skillName, checked.data)
        : await createSkill(workspaceId, checked.data);
      toast(isEdit ? 'Skill saved' : 'Skill created');
      onSaved(skill, skillName);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setErrors({ name: cause.message });
      } else {
        toast(errorMessage(cause, "Couldn't save the skill."), 'error');
      }
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!skillName) return;
    setIsDeleting(true);
    try {
      await deleteSkill(workspaceId, skillName);
      toast('Skill deleted');
      onDeleted(skillName);
      onClose();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the skill."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  const fileName = toSkillName(draft.name) || 'name';

  const footer = isClosing ? (
    <>
      <span role="alert" className="mr-auto text-[13px] text-ink-2">
        You have unsaved changes.
      </span>
      <Button size="sm" onClick={() => setIsClosing(false)}>
        Keep editing
      </Button>
      <Button size="sm" variant="danger" onClick={onClose}>
        Discard and close
      </Button>
    </>
  ) : (
    <>
      {isEdit && (
        <Button
          size="sm"
          variant="danger-ghost"
          onClick={() => setIsDeleteOpen(true)}
          disabled={isSaving || isLoading}
        >
          <TrashIcon /> Delete
        </Button>
      )}
      <span className="ml-auto" />
      <Button size="sm" onClick={requestClose} disabled={isSaving}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        type="submit"
        form="skill-form"
        disabled={isSaving || isLoading || isImproving}
      >
        {isSaving && <Spinner size={12} />}
        {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Create skill'}
      </Button>
    </>
  );

  return (
    <>
      <Modal
        title={isEdit ? 'Edit skill' : 'New skill'}
        titleFont="sans"
        size="lg"
        onClose={requestClose}
        footer={footer}
      >
        {isLoading ? (
          <PageLoader />
        ) : (
          <form
            id="skill-form"
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col divide-y divide-line-2"
          >
            <div className={`${SECTION} grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`}>
              <div className="min-w-0">
                <label htmlFor="skill-name" className={LABEL}>
                  Name
                </label>
                <input
                  id="skill-name"
                  value={draft.name}
                  autoFocus={!isEdit}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={SKILL_LIMITS.nameLength}
                  placeholder="jira-ticket-fix"
                  aria-invalid={errors.name ? true : undefined}
                  onChange={(event) => change('name', event.target.value)}
                  onBlur={() =>
                    setDraft((current) => ({ ...current, name: toSkillName(current.name) }))
                  }
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK} font-mono text-[13px]`}
                />
                {errors.name && (
                  <p role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
                <p className={HINT}>
                  Lower-case words joined by hyphens. Saved as{' '}
                  <span className="break-all font-mono text-[12px]">
                    .nimbrio-ai/skills/{fileName}.md
                  </span>
                </p>
              </div>

              <div className="min-w-0">
                <label htmlFor="skill-description" className={LABEL}>
                  When to use it
                </label>
                <textarea
                  id="skill-description"
                  rows={2}
                  value={draft.description}
                  maxLength={SKILL_LIMITS.descriptionLength}
                  placeholder={DESCRIPTION_PLACEHOLDER}
                  aria-invalid={errors.description ? true : undefined}
                  onChange={(event) => change('description', event.target.value)}
                  className={`${INPUT} ${errors.description ? INPUT_ERROR : INPUT_OK} resize-y leading-relaxed`}
                />
                {errors.description && (
                  <p role="alert" className={ERROR}>
                    {errors.description}
                  </p>
                )}
                <p className={HINT}>
                  The agent sees this for every message and loads the skill when a task fits it.
                </p>
              </div>
            </div>

            <div className={SECTION}>
              <label htmlFor="skill-body" className={LABEL}>
                Instructions <span className="font-normal text-ink-3">· Markdown</span>
              </label>
              <AiWritingEditor
                id="skill-body"
                value={draft.body}
                onChange={(value) => change('body', value)}
                write={writeSkill}
                onUndo={undoDescription}
                onBusyChange={setIsImproving}
                hasError={Boolean(errors.body)}
                describedBy="skill-body-hint"
                placeholder={BODY_PLACEHOLDER}
                maxLength={SKILL_LIMITS.bodyChars}
                requestMaxLength={SKILL_REQUEST_MAX_CHARS}
                starters={STARTERS}
                refinements={REFINEMENTS}
                askPlaceholder={{
                  empty: 'Describe the task and AI writes the skill',
                  filled: 'Ask AI to change it, e.g. "stop before running migrations"',
                }}
                heightClass={BODY_HEIGHT}
                textClassName="font-mono text-[13px] [tab-size:2]"
                failMessage="Couldn't write the skill."
              />
              {errors.body && (
                <p role="alert" className={ERROR}>
                  {errors.body}
                </p>
              )}
              <p id="skill-body-hint" className={`${HINT} flex flex-wrap justify-between gap-x-4`}>
                <span>
                  What the agent follows once it uses the skill: steps, rules, checks, the format of
                  the answer. It can&apos;t turn off approvals.
                </span>
                <span className="tabular-nums">
                  {draft.body.length.toLocaleString('en')} /{' '}
                  {SKILL_LIMITS.bodyChars.toLocaleString('en')}
                </span>
              </p>
            </div>
          </form>
        )}
      </Modal>

      {/* After the Modal, so its portal lands above the Modal's. */}
      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this skill?"
          message={
            <>
              <strong className="font-mono text-ink">{skillName}</strong> is deleted from this
              workspace. The agent won&apos;t see it from your next message.
            </>
          }
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}
