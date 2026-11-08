import type { ModelProfile } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchModels } from './api';

export function useModels(): AsyncResource<ModelProfile[]> {
  return useAsync(fetchModels);
}
