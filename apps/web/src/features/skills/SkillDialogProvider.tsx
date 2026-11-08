import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Skill } from '@app/shared';
import type { AsyncResource } from '../../lib/useAsync';
import { SkillDialog } from './SkillDialog';

interface SkillDialogContextValue {
  /** Opens the skill popup: a new skill (null), or the one with that name to edit. */
  openSkill: (name: string | null) => void;
}

const SkillDialogContext = createContext<SkillDialogContextValue | null>(null);

/**
 * Lets the Skills tab and the composer's Skills menu open the skill popup, and keeps the
 * workspace's skill list (`skills`) up to date with what it saves or deletes.
 */
export function SkillDialogProvider({
  workspaceId,
  skills,
  children,
}: {
  workspaceId: string;
  skills: AsyncResource<Skill[]>;
  children: ReactNode;
}) {
  // undefined: closed; null: a new skill; a name: that skill.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const { setData } = skills;
  const close = useCallback(() => setOpen(undefined), []);

  const saved = useCallback(
    (skill: Skill, previousName: string | null) =>
      setData((current) =>
        [
          ...(current ?? []).filter((s) => s.name !== skill.name && s.name !== previousName),
          skill,
        ].sort((a, b) => a.name.localeCompare(b.name)),
      ),
    [setData],
  );
  const deleted = useCallback(
    (name: string) => setData((current) => current?.filter((s) => s.name !== name) ?? null),
    [setData],
  );

  const value = useMemo(() => ({ openSkill: (name: string | null) => setOpen(name) }), []);

  return (
    <SkillDialogContext.Provider value={value}>
      {children}
      {open !== undefined && (
        <SkillDialog
          key={open ?? 'new'}
          workspaceId={workspaceId}
          name={open}
          onClose={close}
          onSaved={saved}
          onDeleted={deleted}
        />
      )}
    </SkillDialogContext.Provider>
  );
}

export function useSkillDialog(): SkillDialogContextValue {
  const ctx = useContext(SkillDialogContext);
  if (!ctx) throw new Error('useSkillDialog must be used within SkillDialogProvider');
  return ctx;
}
