import type { AgentSettings, AgentSettingsInput } from '@app/shared';
import { jsonBody, request } from '../../lib/api';

export const fetchSettings = () => request<AgentSettings>('/settings');

/** Replaces every setting; applies from the next message on. */
export const saveSettings = (input: AgentSettingsInput) =>
  request<AgentSettings>('/settings', jsonBody('PUT', input));
