import type { AgentConfig } from '@app/agent';
import type { Store } from '@app/db';
import type { AgentSettings, AgentSettingsInput } from '@app/shared';

/**
 * The agent's settings as saved in the app, kept in memory so every run and the
 * logger read them without a query. A save applies from the next message on.
 */
export class AppSettings {
  readonly #store: Store;
  #current: AgentSettings;

  private constructor(store: Store, current: AgentSettings) {
    this.#store = store;
    this.#current = current;
  }

  static async load(store: Store): Promise<AppSettings> {
    return new AppSettings(store, await store.settings.get());
  }

  get current(): AgentSettings {
    return this.#current;
  }

  async save(input: AgentSettingsInput): Promise<AgentSettings> {
    this.#current = await this.#store.settings.save(input);
    return this.#current;
  }

  /** The config for one run: the env part (log folder) with the saved settings. */
  configFor(base: AgentConfig): AgentConfig {
    return { ...base, ...this.#current };
  }
}
