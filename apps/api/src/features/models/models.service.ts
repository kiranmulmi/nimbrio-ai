import type { ResolvedModel } from '@app/db';
import type { ModelInput, ModelProfile, ModelUpdate, ReasoningEffort } from '@app/shared';
import type { AppContext } from '../../context.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';

const MISSING = "That model doesn't exist.";

/** The app-wide list of models. API keys go in, but only `hasApiKey` comes back out. */
export function createModelsService({ store }: AppContext) {
  const { models } = store;

  return {
    list: (): Promise<ModelProfile[]> => models.list(),

    async get(id: string): Promise<ModelProfile> {
      const model = await models.get(id);
      if (!model) throw new NotFoundError(MISSING);
      return model;
    },

    create: (input: ModelInput): Promise<ModelProfile> => models.create(input),

    async update(id: string, changes: ModelUpdate): Promise<ModelProfile> {
      const model = await models.update(id, changes);
      if (!model) throw new NotFoundError(MISSING);
      return model;
    },

    async makeDefault(id: string): Promise<ModelProfile> {
      const model = await models.setDefault(id);
      if (!model) throw new NotFoundError(MISSING);
      return model;
    },

    async remove(id: string): Promise<void> {
      if (!(await models.remove(id))) throw new NotFoundError(MISSING);
    },

    /**
     * The model one run uses (the default when none is asked for), with the reasoning
     * effort applied only where the model supports one. Runs already going keep their copy.
     */
    async forRun(
      id: string | undefined,
      effort: ReasoningEffort | undefined,
    ): Promise<ResolvedModel> {
      const resolved = await models.settingsFor(id);
      if (!resolved) {
        throw id
          ? new NotFoundError('That model no longer exists. Pick another one.')
          : new ValidationError('No model is set up yet. Add one in Settings → Models.');
      }
      const reasoningEffort = resolved.profile.supportsReasoning ? (effort ?? null) : null;
      return { ...resolved, settings: { ...resolved.settings, reasoningEffort } };
    },
  };
}

export type ModelsService = ReturnType<typeof createModelsService>;
