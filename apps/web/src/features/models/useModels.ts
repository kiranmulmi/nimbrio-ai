import { useEffect } from 'react';
import type { ModelProfile } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchModels } from './api';
import { onModelsChanged } from './modelEvents';

/** Every saved model. Loads again whenever a model is added, edited, deleted or made default. */
export function useModels(): AsyncResource<ModelProfile[]> {
  const models = useAsync(fetchModels);
  const { reload } = models;
  useEffect(() => onModelsChanged(reload), [reload]);
  return models;
}
