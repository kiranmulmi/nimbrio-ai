import { useCallback } from 'react';
import { REASONING_EFFORTS, type ModelProfile, type ReasoningEffort } from '@app/shared';
import { useStoredState } from '../../lib/useStoredState';
import { useModels } from '../models/useModels';

const parseId = (stored: string | null) => stored ?? '';
const parseEffort = (stored: string | null): ReasoningEffort | null =>
  REASONING_EFFORTS.find((effort) => effort === stored) ?? null;
const serializeEffort = (effort: ReasoningEffort | null) => effort ?? '';

export interface ModelChoice {
  /** Null while loading, or when no model is set up. */
  model: ModelProfile | null;
  /** Null: the server's default. Only sent for models that support reasoning. */
  effort: ReasoningEffort | null;
}

/**
 * The model and reasoning effort the next message uses. Remembered in this browser as a
 * UI preference; a model that was deleted falls back to the default one.
 */
export function useModelChoice() {
  const models = useModels();
  const [storedId, setStoredId] = useStoredState('agent.model', parseId);
  const [effort, setEffort] = useStoredState('agent.effort', parseEffort, serializeEffort);

  const list = models.data ?? [];
  const model =
    list.find((item) => item.id === storedId) ??
    list.find((item) => item.isDefault) ??
    list[0] ??
    null;

  const chooseModel = useCallback((id: string) => setStoredId(id), [setStoredId]);

  const choice: ModelChoice = { model, effort };
  return { models, choice, chooseModel, chooseEffort: setEffort };
}
