import type { ImprovedSkill, Skill, SkillImproveRequest, SkillInput } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/skills`;
const skillPath = (workspaceId: string, name: string) =>
  `${path(workspaceId)}/${encodeURIComponent(name)}`;

export function fetchSkills(workspaceId: string): Promise<Skill[]> {
  return request<Skill[]>(path(workspaceId));
}

export function fetchSkill(workspaceId: string, name: string): Promise<Skill> {
  return request<Skill>(skillPath(workspaceId, name));
}

export function createSkill(workspaceId: string, input: SkillInput): Promise<Skill> {
  return request<Skill>(path(workspaceId), jsonBody('POST', input));
}

/** Saves `name` as `input`; a different `input.name` renames it. */
export function updateSkill(workspaceId: string, name: string, input: SkillInput): Promise<Skill> {
  return request<Skill>(skillPath(workspaceId, name), jsonBody('PUT', input));
}

/** The instructions rewritten by the default model, with a suggested description. */
export function improveSkill(input: SkillImproveRequest): Promise<ImprovedSkill> {
  return request<ImprovedSkill>('/prompts/skill', jsonBody('POST', input));
}

export function deleteSkill(workspaceId: string, name: string): Promise<void> {
  return request<void>(skillPath(workspaceId, name), { method: 'DELETE' });
}
