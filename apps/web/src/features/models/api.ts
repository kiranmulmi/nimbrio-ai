import type { ModelInput, ModelProfile, ModelUpdate } from '@app/shared';
import { jsonBody, request } from '../../lib/api';
import { announceModelsChanged } from './modelEvents';

const modelPath = (id: string) => `/models/${encodeURIComponent(id)}`;

/** Every model set up in the app, oldest first. Keys never come back: only `hasApiKey`. */
export const fetchModels = () => request<ModelProfile[]>('/models');

export const fetchModel = (id: string) => request<ModelProfile>(modelPath(id));

/** Runs a write, then tells every open model list (the composer's picker too) to reload. */
const announcing = async <T>(write: Promise<T>): Promise<T> => {
  const result = await write;
  announceModelsChanged();
  return result;
};

export const createModel = (input: ModelInput) =>
  announcing(request<ModelProfile>('/models', jsonBody('POST', input)));

/** Leave `apiKey` out to keep the saved key; send '' to remove it. */
export const updateModel = (id: string, changes: ModelUpdate) =>
  announcing(request<ModelProfile>(modelPath(id), jsonBody('PUT', changes)));

export const makeDefaultModel = (id: string) =>
  announcing(request<ModelProfile>(`${modelPath(id)}/default`, jsonBody('POST', {})));

export const deleteModel = (id: string) =>
  announcing(request<void>(modelPath(id), { method: 'DELETE' }));
