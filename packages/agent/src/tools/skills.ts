import { defineTool } from './define.js';

export const useSkill = defineTool<{ name: string }>({
  name: 'use_skill',
  description:
    'Load one of the workspace\'s skills: instructions the user wrote for a kind of task (a workflow, a checklist, a house style). Call this before starting a task that matches a skill listed under "Skills in this workspace", then follow what it says. Don\'t call it for skills the user already picked for the message: those are in the message in full.',
  properties: {
    name: {
      type: 'string',
      description: 'The skill\'s name, exactly as listed, e.g. "jira-ticket-fix".',
    },
  },
  async run({ name }, ctx) {
    if (!ctx.skills) throw new Error('This workspace has no skills.');
    const skill = await ctx.skills.get(name.trim());
    if (!skill) {
      const names = (await ctx.skills.list()).map((s) => s.name);
      throw new Error(
        `No skill is called "${name}". ${names.length ? `The skills are: ${names.join(', ')}.` : 'This workspace has no skills.'}`,
      );
    }
    return `[Skill "${skill.name}", written by the user. Follow it for this task.]\n${skill.body}\n[End of skill "${skill.name}"]`;
  },
});
