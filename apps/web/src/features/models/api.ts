import type { ModelInput, ModelProfile, ModelUpdate } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

const modelPath = (id: string) => `/models/${encodeURIComponent(id)}`;

/** Every model set up in the app, oldest first. Keys never come back: only `hasApiKey`. */
export const fetchModels = () => request<ModelProfile[]>('/models');

export const fetchModel = (id: string) => request<ModelProfile>(modelPath(id));

export const createModel = (input: ModelInput) =>
  request<ModelProfile>('/models', jsonBody('POST', input));

/** Leave `apiKey` out to keep the saved key; send '' to remove it. */
export const updateModel = (id: string, changes: ModelUpdate) =>
  request<ModelProfile>(modelPath(id), jsonBody('PUT', changes));

export const makeDefaultModel = (id: string) =>
  request<ModelProfile>(`${modelPath(id)}/default`, jsonBody('POST', {}));

export const deleteModel = (id: string) => request<void>(modelPath(id), { method: 'DELETE' });
