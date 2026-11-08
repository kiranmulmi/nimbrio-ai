import { useCallback } from 'react';
import type { WorkspaceFiles } from '@app/shared';
import { useAsync, type AsyncResource } from '../../../lib/useAsync';
import { fetchFiles } from './api';

export function useFiles(workspaceId: string): AsyncResource<WorkspaceFiles> {
  const load = useCallback(() => fetchFiles(workspaceId), [workspaceId]);
  return useAsync(load);
}
