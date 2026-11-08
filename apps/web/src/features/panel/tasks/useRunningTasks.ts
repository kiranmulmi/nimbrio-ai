import { useCallback, useEffect, useState } from 'react';
import type { BackgroundTask } from '@app/shared';
import { errorMessage } from '../../../lib/api';
import { usePageVisible } from '../../../lib/usePageVisible';
import { fetchRunningTasks } from './api';

/**
 * How often the list is checked: tasks start and stop on their own (a server crashes). Once a
 * minute is enough, since it is also checked on each run start/end and when the tab is shown.
 */
const POLL_MS = 60_000;

/**
 * The workspace's running background tasks, kept fresh by polling while the chat screen is
 * open and the browser tab is showing (the Tasks tab shows them; its label shows how many).
 * Checked again right away when the tab is shown again, and when the agent starts or
 * finishes a reply, since that's when it starts or stops them.
 */
export function useRunningTasks(workspaceId: string, isBusy: boolean) {
  const [tasks, setTasks] = useState<BackgroundTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPageVisible = usePageVisible();

  const refresh = useCallback(async () => {
    try {
      setTasks(await fetchRunningTasks(workspaceId));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't load the tasks."));
    }
  }, [workspaceId]);

  useEffect(() => {
    setTasks(null);
    setError(null);
  }, [workspaceId]);

  useEffect(() => {
    if (!isPageVisible) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, isBusy, isPageVisible]);

  return { tasks, error, refresh };
}
