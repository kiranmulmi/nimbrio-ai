// Skills the user wrote for a workspace (kept by @app/db in its .nimbrio-ai/skills/). The
// agent lists them in its system prompt and loads one with use_skill when a task matches;
// skills the user picked for a message come with that message (pickedSkillsContext).
import type { Skill } from '@app/shared';

export interface SkillStore {
  /** Every skill, by name. A broken file is left out rather than failing the run. */
  list(): Promise<Skill[]>;
  /** null when there is no skill with that name. */
  get(name: string): Promise<Skill | null>;
}
