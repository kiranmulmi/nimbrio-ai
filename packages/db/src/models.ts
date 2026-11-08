// The models the agent can run on, app-wide, in ~/.nimbrio-ai/models.json (written 0600).
// API keys are kept there and only ever leave through `settingsFor`, for a run on this
// machine; the UI sees `hasApiKey`.
import { randomUUID } from 'node:crypto';
import { serialized, type ModelSettings } from '@app/agent';
import {
  modelInputSchema,
  modelUpdateSchema,
  type ModelInput,
  type ModelProfile,
  type ModelUpdate,
} from '@app/shared';
import { z } from 'zod';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';
import { isUuid } from './workspace-data.js';

/** One model as saved, in creation order. Fields a hand edit leaves out get their defaults. */
const savedModelSchema = z.object({
  id: z.string().refine(isUuid, 'must be a UUID'),
  name: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().nullable().default(null),
  apiKey: z.string().nullable().default(null),
  maxTokens: z.number().int().positive().nullable().default(null),
  contextWindow: z.number().int().positive().nullable().default(null),
  supportsReasoning: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

type SavedModel = z.output<typeof savedModelSchema>;

const modelsFileSchema = z.object({ models: z.array(savedModelSchema).default([]) });

/** A model ready for a run: what the UI shows, and what the agent needs to call it. */
export interface ResolvedModel {
  profile: ModelProfile;
  /** `reasoningEffort` is null here; the run sets it from the request. */
  settings: ModelSettings;
}

export class ModelStore {
  constructor(readonly file: string) {}

  /** Oldest first, so the list stays put as models are added. */
  async list(): Promise<ModelProfile[]> {
    return (await this.#read()).map(toProfile);
  }

  async get(id: string): Promise<ModelProfile | null> {
    const saved = (await this.#read()).find((m) => m.id === id);
    return saved ? toProfile(saved) : null;
  }

  /** The first model becomes the default, whatever the input says. */
  async create(input: ModelInput): Promise<ModelProfile> {
    const clean = check(modelInputSchema, input);
    return this.#change((models) => {
      const now = new Date().toISOString();
      const created: SavedModel = {
        id: randomUUID(),
        name: clean.name,
        model: clean.model,
        baseUrl: clean.baseUrl,
        apiKey: clean.apiKey || null,
        maxTokens: clean.maxTokens,
        contextWindow: clean.contextWindow,
        supportsReasoning: clean.supportsReasoning,
        isDefault: clean.isDefault || models.length === 0,
        createdAt: now,
        updatedAt: now,
      };
      const others = created.isDefault ? models.map(notDefault) : models;
      return { models: [...others, created], result: toProfile(created) };
    });
  }

  /**
   * Replaces the model's settings. A left-out `apiKey` keeps the saved key. The default
   * stays the default until another model takes over, so there is always one.
   */
  async update(id: string, changes: ModelUpdate): Promise<ModelProfile | null> {
    const clean = check(modelUpdateSchema, changes);
    return this.#change((models) => {
      const current = models.find((m) => m.id === id);
      if (!current) return { models, result: null };
      const updated: SavedModel = {
        ...current,
        name: clean.name,
        model: clean.model,
        baseUrl: clean.baseUrl,
        apiKey: clean.apiKey === undefined ? current.apiKey : clean.apiKey || null,
        maxTokens: clean.maxTokens,
        contextWindow: clean.contextWindow,
        supportsReasoning: clean.supportsReasoning,
        isDefault: clean.isDefault || current.isDefault,
        updatedAt: new Date().toISOString(),
      };
      return {
        models: models.map((m) => (m.id === id ? updated : updated.isDefault ? notDefault(m) : m)),
        result: toProfile(updated),
      };
    });
  }

  async setDefault(id: string): Promise<ModelProfile | null> {
    return this.#change((models) => {
      const current = models.find((m) => m.id === id);
      if (!current) return { models, result: null };
      const updated = { ...current, isDefault: true, updatedAt: new Date().toISOString() };
      return {
        models: models.map((m) => (m.id === id ? updated : notDefault(m))),
        result: toProfile(updated),
      };
    });
  }

  /** Deleting the default hands it to the oldest model left (see `#read`). */
  async remove(id: string): Promise<boolean> {
    return this.#change((models) => {
      const left = models.filter((m) => m.id !== id);
      const isRemoved = left.length < models.length;
      return { models: isRemoved ? left : models, result: isRemoved };
    });
  }

  /** A model by its name or model name, ignoring case (for the CLI's /model command). */
  async findByName(name: string): Promise<ModelProfile | null> {
    const wanted = name.trim().toLowerCase();
    const models = await this.#read();
    const found =
      models.find((m) => m.name.toLowerCase() === wanted) ??
      models.find((m) => m.model.toLowerCase() === wanted);
    return found ? toProfile(found) : null;
  }

  /**
   * The model a run uses: the one asked for, or the default when `id` is left out.
   * Null when that model doesn't exist, or no model is set up yet.
   */
  async settingsFor(id?: string): Promise<ResolvedModel | null> {
    const models = await this.#read();
    const saved =
      id === undefined ? models.find((m) => m.isDefault) : models.find((m) => m.id === id);
    if (!saved) return null;
    return {
      profile: toProfile(saved),
      settings: {
        label: saved.name,
        model: saved.model,
        baseURL: saved.baseUrl ?? undefined,
        apiKey: saved.apiKey ?? '',
        maxTokens: saved.maxTokens,
        contextWindow: saved.contextWindow,
        reasoningEffort: null,
      },
    };
  }

  /** The saved models, with exactly one default whenever there are any. */
  async #read(): Promise<SavedModel[]> {
    const raw = await readJson(this.file);
    if (raw === null) return [];
    const parsed = modelsFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${this.file} is damaged: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }
    const { models } = parsed.data;
    const defaultIndex = Math.max(
      0,
      models.findIndex((m) => m.isDefault),
    );
    return models.map((m, index) => ({ ...m, isDefault: index === defaultIndex }));
  }

  /** Read, change and write the file as one step, so concurrent changes can't lose each other. */
  #change<T>(update: (models: SavedModel[]) => { models: SavedModel[]; result: T }): Promise<T> {
    return serialized(this.file, async () => {
      const before = await this.#read();
      const { models, result } = update(before);
      if (models !== before) await writePrivateJson(this.file, { models });
      return result;
    });
  }
}

function check<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InputError(result.error.issues[0]?.message ?? 'Check the model settings.');
  }
  return result.data;
}

const notDefault = (model: SavedModel): SavedModel =>
  model.isDefault ? { ...model, isDefault: false } : model;

function toProfile(saved: SavedModel): ModelProfile {
  return {
    id: saved.id,
    name: saved.name,
    model: saved.model,
    baseUrl: saved.baseUrl,
    hasApiKey: Boolean(saved.apiKey),
    maxTokens: saved.maxTokens,
    contextWindow: saved.contextWindow,
    supportsReasoning: saved.supportsReasoning,
    isDefault: saved.isDefault,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}
