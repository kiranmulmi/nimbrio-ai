import { useCallback } from 'react';
import type { Workspace } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchWorkspace } from './api';

export function useWorkspace(workspaceId: string): AsyncResource<Workspace> {
  const load = useCallback(() => fetchWorkspace(workspaceId), [workspaceId]);
  return useAsync(load);
}
