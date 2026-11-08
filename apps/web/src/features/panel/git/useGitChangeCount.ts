import { useCallback, useEffect, useState } from 'react';
import { usePageVisible } from '../../../lib/usePageVisible';
import { fetchGitChanges } from './api';

/**
 * Once a minute: `git status` plus line counts cost more than a task list, and the count is
 * also checked on each run start/end and when the tab is shown again.
 */
const POLL_MS = 60_000;

/**
 * How many files changed since the last commit, for the Git diff tab's label (null when
 * unknown, off, or not a git repository). Polled while the tab is shown in the workspace and
 * the browser tab is showing, and checked again when it's shown again or the agent starts or
 * finishes a reply.
 */
export function useGitChangeCount(
  workspaceId: string,
  isEnabled: boolean,
  isBusy: boolean,
): { count: number; isTruncated: boolean } | null {
  const [count, setCount] = useState<{ count: number; isTruncated: boolean } | null>(null);
  const isPageVisible = usePageVisible();

  const refresh = useCallback(async () => {
    try {
      const changes = await fetchGitChanges(workspaceId);
      setCount(
        changes.isRepo ? { count: changes.files.length, isTruncated: changes.isTruncated } : null,
      );
    } catch {
      // The tab itself shows the error; the label just keeps its last count.
    }
  }, [workspaceId]);

  useEffect(() => {
    setCount(null);
  }, [workspaceId, isEnabled]);

  useEffect(() => {
    if (!isEnabled || !isPageVisible) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, isEnabled, isBusy, isPageVisible]);

  return count;
}
