import { SkillExistsError } from '@app/db';
import type { Skill, SkillInput } from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** A workspace's skills (its .nimbrio-ai/skills/), written from the Skills tab. */
export function createSkillsService({ store }: AppContext, workspaces: WorkspacesService) {
  const skillsOf = async (workspaceId: string) =>
    store.skills(await workspaces.require(workspaceId));

  /** A taken name is a 409, so the form can say so next to the name. */
  const conflictIfTaken = (error: unknown): never => {
    if (error instanceof SkillExistsError) throw new ConflictError(error.message);
    throw error;
  };

  return {
    async list(workspaceId: string): Promise<Skill[]> {
      return (await skillsOf(workspaceId)).list();
    },

    async get(workspaceId: string, name: string): Promise<Skill> {
      const skill = await (await skillsOf(workspaceId)).get(name);
      if (!skill) throw new NotFoundError(`There's no skill called "${name}".`);
      return skill;
    },

    async create(workspaceId: string, input: SkillInput): Promise<Skill> {
      return (await skillsOf(workspaceId)).create(input).catch(conflictIfTaken);
    },

    async update(workspaceId: string, name: string, input: SkillInput): Promise<Skill> {
      const skill = await (await skillsOf(workspaceId)).update(name, input).catch(conflictIfTaken);
      if (!skill) throw new NotFoundError(`There's no skill called "${name}".`);
      return skill;
    },

    async remove(workspaceId: string, name: string): Promise<void> {
      if (!(await (await skillsOf(workspaceId)).remove(name))) {
        throw new NotFoundError(`There's no skill called "${name}".`);
      }
    },

    /** The skills the user picked for a message, checked before the run starts. */
    async requireAll(workspace: { path: string }, names: readonly string[]): Promise<Skill[]> {
      const skills = store.skills(workspace);
      const found = await Promise.all([...new Set(names)].map((name) => skills.get(name)));
      const missing = names.filter((name, i) => !found[i]);
      if (missing.length) {
        throw new ValidationError(
          `${missing.length === 1 ? 'This skill no longer exists' : 'These skills no longer exist'}: ${missing.join(', ')}. Pick again.`,
        );
      }
      return found.filter((skill): skill is Skill => skill !== null);
    },
  };
}

export type SkillsService = ReturnType<typeof createSkillsService>;
