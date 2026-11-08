// "Improve prompt": rewrites the user's draft into a clearer request before it is sent.
// One short, tool-free model call; the user sees the result and can undo it.
import type { CallModel } from './llm.js';

const IMPROVE_PROMPT = `You improve prompts that a user is about to send to an AI agent which works in their project folder, runs commands, edits files, searches the web and uses tools.

Rewrite the user's draft so the agent understands it at once:
- Keep the user's intent, every fact, name, path, number, constraint and requirement. Never drop or change them.
- Make the goal explicit, then the details. Fix spelling and grammar. Use short paragraphs or a list when the draft has several parts.
- Do not invent requirements, files, tools or steps the user did not ask for. Do not answer the request.
- Keep words starting with @ (such as @src or @package.json) exactly as written.
- Keep the user's language and roughly their tone; keep it about as long as needed, not longer.

Reply with only the improved prompt: no preamble, no quotes, no explanation.`;

/** Drops a wrapper the model may add anyway: a label line or surrounding quotes/fences. */
export function cleanImprovedPrompt(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^(improved prompt|here is[^\n]*?)\s*:\s*\n/i, '');
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1];
  if (/^"[\s\S]*"$/.test(text) && !text.slice(1, -1).includes('"')) text = text.slice(1, -1);
  return text.trim();
}

/** The draft rewritten for clarity, or null when the model returned nothing usable. */
export async function improvePrompt(
  callModel: CallModel,
  draft: string,
  context: { workspace?: string; instructions?: string } = {},
): Promise<string | null> {
  const about = [
    context.workspace ? `Workspace: ${context.workspace}` : '',
    context.instructions
      ? `The workspace's own instructions for the agent:\n${context.instructions}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const { message } = await callModel({
    system: IMPROVE_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${about ? `${about}\n\n` : ''}The draft to improve:\n<draft>\n${draft}\n</draft>`,
      },
    ],
  });
  const text = cleanImprovedPrompt(message.content ?? '');
  return text || null;
}
