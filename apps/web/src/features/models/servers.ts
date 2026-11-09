import type { ModelProfile } from '@app/shared';

/** Ready-made server URLs for the model form. Empty means api.openai.com. */
export const SERVER_PRESETS = [
  { label: 'OpenAI', baseUrl: '', needsKey: true },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', needsKey: false },
] as const;

/**
 * "api.openai.com", "localhost:11434/v1", "Cursor": who serves the model, short enough for a
 * list.
 */
export function serverLabel({
  provider,
  baseUrl,
}: Pick<ModelProfile, 'provider' | 'baseUrl'>): string {
  if (provider === 'cursor') return 'Cursor';
  return (baseUrl ?? 'https://api.openai.com/v1').replace(/^https?:\/\//, '');
}
