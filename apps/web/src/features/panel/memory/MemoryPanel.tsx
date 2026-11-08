import { useCallback, useState } from 'react';
import type { Memory } from '@app/shared';
import { Button } from '../../../components/Button';
import { ConfirmDeleteDialog } from '../../../components/ConfirmDeleteDialog';
import { errorMessage } from '../../../lib/api';
import { plural, shorten } from '../../../lib/format';
import { useToast } from '../../../lib/toast';
import type { AsyncResource } from '../../../lib/useAsync';
import { PanelMessage } from '../PanelMessage';
import { clearMemories, deleteMemory } from './api';
import { MemoryItem } from './MemoryItem';

type PendingDelete = { kind: 'one'; memory: Memory } | { kind: 'all' };

const newestFirst = (a: Memory, b: Memory) =>
  (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '');

/** The Memory tab: what the agent remembers in this workspace. */
export function MemoryPanel({
  workspaceId,
  memories,
}: {
  workspaceId: string;
  memories: AsyncResource<Memory[]>;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { data, setData } = memories;
  const list = data ? [...data].sort(newestFirst) : [];

  const confirm = async () => {
    if (!pending) return;
    setIsDeleting(true);
    try {
      const result =
        pending.kind === 'all'
          ? await clearMemories(workspaceId)
          : await deleteMemory(workspaceId, pending.memory.id);
      setData(() => result.memories);
      toast(
        pending.kind === 'all'
          ? `Cleared ${plural(result.removed, 'memory', 'memories')}`
          : 'Memory deleted',
      );
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the memory."), 'error');
    } finally {
      setIsDeleting(false);
      setPending(null);
    }
  };

  const cancel = useCallback(() => setPending(null), []);

  return (
    <>
      <div className="mb-2 flex min-h-7 items-center justify-between">
        <span className="eyebrow">{list.length ? `${list.length} saved` : 'Memories'}</span>
        {list.length > 0 && (
          <Button size="sm" variant="danger-ghost" onClick={() => setPending({ kind: 'all' })}>
            Clear all
          </Button>
        )}
      </div>

      {!data ? (
        <PanelMessage
          isLoading={memories.isLoading}
          error={memories.error}
          onRetry={memories.reload}
        />
      ) : (
        <ul className={list.length ? 'panel divide-y divide-line-2' : ''}>
          {list.length === 0 && (
            <li className="border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">
              Nothing saved yet. Tell the agent something to remember.
            </li>
          )}
          {list.map((memory) => (
            <MemoryItem
              key={memory.id}
              memory={memory}
              onDelete={() => setPending({ kind: 'one', memory })}
            />
          ))}
        </ul>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        The agent reads these at the start of every chat and follows them. Ask it to change or
        forget one, or delete it here.
      </p>

      <ConfirmDeleteDialog
        open={pending !== null}
        title={pending?.kind === 'all' ? 'Clear all memories?' : 'Forget this memory?'}
        message={
          pending?.kind === 'one'
            ? `“${shorten(pending.memory.fact, 160)}” is deleted. The agent won't see it in new messages.`
            : `All ${plural(list.length, 'memory', 'memories')} in this workspace are deleted. The agent starts without them from your next message.`
        }
        confirmLabel={pending?.kind === 'all' ? 'Clear all' : 'Delete'}
        busy={isDeleting}
        onCancel={cancel}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
