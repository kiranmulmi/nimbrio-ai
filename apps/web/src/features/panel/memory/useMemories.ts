import { useCallback } from 'react';
import type { Memory } from '@app/shared';
import { useAsync, type AsyncResource } from '../../../lib/useAsync';
import { fetchMemories } from './api';

export function useMemories(workspaceId: string): AsyncResource<Memory[]> {
  const load = useCallback(() => fetchMemories(workspaceId), [workspaceId]);
  return useAsync(load);
}
