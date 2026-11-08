// The agent's app-wide settings (Settings -> Agent), in ~/.nimbrio-ai/agent-settings.json.
import { serialized } from '@app/agent';
import {
  agentSettingsSchema,
  readAgentSettings,
  type AgentSettings,
  type AgentSettingsInput,
} from '@app/shared';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';

export class SettingsStore {
  constructor(readonly file: string) {}

  /** The saved settings, with defaults for anything missing or invalid. */
  async get(): Promise<AgentSettings> {
    return readAgentSettings(await readJson(this.file));
  }

  /** Replaces every setting at once. */
  async save(input: AgentSettingsInput): Promise<AgentSettings> {
    const parsed = agentSettingsSchema.safeParse(input);
    if (!parsed.success) {
      throw new InputError(parsed.error.issues[0]?.message ?? 'Check the settings.');
    }
    await serialized(this.file, () => writePrivateJson(this.file, parsed.data));
    return readAgentSettings(parsed.data);
  }
}
