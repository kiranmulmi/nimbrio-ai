import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitChangedFile, GitFileDiff, GitFileStatus } from '@app/shared';
import { IconButton } from '../../../components/IconButton';
import { Spinner } from '../../../components/Spinner';
import { errorMessage } from '../../../lib/api';
import { plural } from '../../../lib/format';
import { ChevronRightIcon, GitDiffIcon, RefreshIcon } from '../../../lib/icons';
import { useAsync } from '../../../lib/useAsync';
import { PanelMessage } from '../PanelMessage';
import { fetchGitChanges, fetchGitDiff } from './api';
import { DiffView } from './DiffView';

const STATUS: Record<GitFileStatus, { letter: string; label: string; tone: string }> = {
  modified: { letter: 'M', label: 'Modified', tone: 'text-warn' },
  added: { letter: 'A', label: 'Added', tone: 'text-success' },
  deleted: { letter: 'D', label: 'Deleted', tone: 'text-danger' },
  untracked: { letter: 'U', label: 'New, not tracked by git yet', tone: 'text-success' },
  conflicted: { letter: '!', label: 'Merge conflict', tone: 'text-danger' },
};

type DiffState = { diff: GitFileDiff } | { error: string } | 'loading';

/**
 * The Git diff tab: the files changed in the workspace's folder since the last commit
 * (staged or not, new ones too). Click a file to see its diff. Reloads when the agent
 * finishes, since that's when files usually change.
 */
export function GitPanel({ workspaceId, isBusy }: { workspaceId: string; isBusy: boolean }) {
  const load = useCallback(() => fetchGitChanges(workspaceId), [workspaceId]);
  const changes = useAsync(load);
  const { reload } = changes;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [diffs, setDiffs] = useState<ReadonlyMap<string, DiffState>>(new Map());

  const refresh = useCallback(() => {
    setDiffs(new Map()); // stale once the files change; open ones load again
    reload();
  }, [reload]);

  const wasBusy = useRef(isBusy);
  useEffect(() => {
    if (wasBusy.current && !isBusy) refresh();
    wasBusy.current = isBusy;
  }, [isBusy, refresh]);

  const loadDiff = useCallback(
    (path: string) => {
      setDiffs((current) => new Map(current).set(path, 'loading'));
      fetchGitDiff(workspaceId, path)
        .then((diff) => setDiffs((current) => new Map(current).set(path, { diff })))
        .catch((cause: unknown) =>
          setDiffs((current) =>
            new Map(current).set(path, { error: errorMessage(cause, "Couldn't load the diff.") }),
          ),
        );
    },
    [workspaceId],
  );

  // An open file whose diff isn't loaded (just opened, or after a refresh) loads it.
  const files = changes.data?.files;
  useEffect(() => {
    if (!files) return;
    for (const file of files) {
      if (open.has(file.path) && !diffs.has(file.path)) loadDiff(file.path);
    }
  }, [files, open, diffs, loadDiff]);

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const data = changes.data;
  const totals = (data?.files ?? []).reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-line-2 bg-surface py-1.5 pl-4 pr-2">
        <div className="flex min-w-0 items-center gap-2">
          {data?.branch && (
            <span
              title={`Branch ${data.branch}`}
              className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-ink-2"
            >
              <GitDiffIcon size={13} className="shrink-0 text-accent" />
              <span className="truncate">{data.branch}</span>
            </span>
          )}
          {data?.isRepo && data.files.length > 0 && (
            <span className="shrink-0 text-[12px] text-ink-3">
              {plural(data.files.length, 'file')}{' '}
              <span className="text-success">+{totals.additions}</span>{' '}
              <span className="text-danger">−{totals.deletions}</span>
            </span>
          )}
        </div>
        <IconButton
          onClick={refresh}
          disabled={changes.isLoading}
          aria-label="Refresh"
          title="Refresh"
        >
          {changes.isLoading ? <Spinner size={12} /> : <RefreshIcon />}
        </IconButton>
      </div>

      {!data ? (
        <div className="p-4">
          <PanelMessage isLoading={changes.isLoading} error={changes.error} onRetry={refresh} />
        </div>
      ) : !data.isRepo ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-3">
          This folder isn&apos;t a git repository, so there are no changes to compare.
        </p>
      ) : data.files.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-3">
          No changes since the last commit.
        </p>
      ) : (
        <>
          {data.files.map((file) => (
            <ChangedFile
              key={file.path}
              file={file}
              isOpen={open.has(file.path)}
              state={diffs.get(file.path)}
              onToggle={() => toggle(file.path)}
              onRetry={() => loadDiff(file.path)}
            />
          ))}
          {data.isTruncated && (
            <p className="border-t border-line-2 px-3 py-2 text-[12px] text-ink-3">
              More files changed than are listed here.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ChangedFile({
  file,
  isOpen,
  state,
  onToggle,
  onRetry,
}: {
  file: GitChangedFile;
  isOpen: boolean;
  state: DiffState | undefined;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const status = STATUS[file.status];
  const slash = file.path.lastIndexOf('/');
  const folder = slash >= 0 ? file.path.slice(0, slash + 1) : '';
  const name = file.path.slice(slash + 1);

  return (
    <div className="border-b border-line-2 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        title={file.path}
        className={`flex h-9 w-full items-center gap-2 px-3 text-left text-[12.5px] transition-colors hover:bg-subtle ${
          isOpen ? 'bg-subtle' : ''
        }`}
      >
        <ChevronRightIcon
          size={10}
          className={`shrink-0 text-ink-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span
          title={status.label}
          className={`w-3 shrink-0 text-center font-mono text-[12px] font-bold ${status.tone}`}
        >
          {status.letter}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono">
          <span className="text-ink-3">{folder}</span>
          <span
            className={`font-semibold ${file.status === 'deleted' ? 'text-ink-3 line-through' : 'text-ink'}`}
          >
            {name}
          </span>
        </span>
        {file.isStaged && (
          <span
            title={file.isUnstaged ? 'Partly staged' : 'Staged for the next commit'}
            className="shrink-0 rounded px-1 text-[10.5px] font-semibold uppercase tracking-wide text-accent-2"
          >
            staged
          </span>
        )}
        <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
          {file.additions === null && file.deletions === null ? (
            <span className="text-ink-3">{file.status === 'untracked' ? 'new' : 'binary'}</span>
          ) : (
            <>
              <span className="text-success">+{file.additions ?? 0}</span>{' '}
              <span className="text-danger">−{file.deletions ?? 0}</span>
            </>
          )}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-line-2">
          {state === undefined || state === 'loading' ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-ink-3">
              <Spinner size={12} /> Loading the diff…
            </div>
          ) : 'error' in state ? (
            <p className="px-3 py-2.5 text-[12.5px] text-danger">
              {state.error}{' '}
              <button type="button" onClick={onRetry} className="font-semibold underline">
                Try again
              </button>
            </p>
          ) : state.diff.isBinary ? (
            <p className="px-3 py-2.5 text-[12.5px] text-ink-3">Binary file: no text diff.</p>
          ) : (
            <>
              <DiffView path={file.path} diff={state.diff.diff} />
              {state.diff.isTruncated && (
                <p className="border-t border-line-2 px-3 py-1.5 text-[11.5px] text-ink-3">
                  The diff is long; only the start is shown.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
