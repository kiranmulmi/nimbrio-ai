// The skill form's AI writer: writes a skill's instructions from the user's request (from
// scratch when there are none yet), changes them as asked, or with no request tidies them so
// the agent can follow them step by step; and suggests the "when to use it" line. One short,
// tool-free model call; the form shows the result and the user can undo it.
import { isRecord } from './errors.js';
import type { CallModel } from './llm.js';
import { cleanImprovedPrompt } from './improve.js';

const IMPROVE_SKILL_PROMPT = `You write and improve "skills": instructions a user writes for an AI agent that works in their project folder (it reads and edits files, runs commands, searches the web and uses tools such as Jira or GitHub). The agent loads a skill when a task matches its description, then follows its instructions.

What to do depends on what you are given:
- A request and no current instructions: write the skill's instructions from the request (and the name and description, when given). Never invent commands, files, tools or facts the user did not mention; when unsure, leave it out.
- A request and current instructions: change them as the request asks, and keep everything else the user wrote.
- Current instructions and no request: tidy them so the agent can follow them reliably.

In every case:
- Keep the user's intent and every fact, name, path, command, number, rule, gate and requirement. Never drop, soften or change them unless the request asks. Never add approvals, permissions or steps the user did not ask for.
- Structure it as Markdown: a one-line purpose, then numbered phases or steps in order, each with what to do and what to check. Put hard rules (things the agent must or must never do) in their own short list. Say where the agent must stop and wait for the user, exactly where the user said so.
- Be concrete and brief: imperative sentences, no filler, no explanations of why skills exist.
- Fix spelling and grammar. Write in the language of the request (or of the current instructions).

Also write "description": one or two sentences saying when the agent should use this skill (the kinds of request it fits). The agent decides by this line alone, so name the trigger, e.g. "When the user gives a Jira ticket to check, confirm or fix."

Reply with only a JSON object and no other text: {"description": "...", "body": "..."}`;

export interface SkillDraft {
  /** What the user asked for; empty or left out: tidy the current instructions. */
  request?: string;
  name?: string;
  description?: string;
  /** The instructions in the box now (may be empty when there is a request). */
  body: string;
}

/** The instructions written or rewritten and a description, or null when the reply was unusable. */
export async function improveSkill(
  callModel: CallModel,
  { request, name, description, body }: SkillDraft,
): Promise<{ body: string; description: string } | null> {
  const asked = request?.trim() ?? '';
  const parts = [
    name?.trim() ? `Skill name: ${name.trim()}` : '',
    description?.trim() ? `The user's description: ${description.trim()}` : '',
    body.trim()
      ? `Current instructions:\n<instructions>\n${body.trim()}\n</instructions>`
      : 'No instructions yet: write them.',
    asked
      ? `The user's request:\n<request>\n${asked}\n</request>`
      : 'No request: tidy the current instructions.',
  ];
  const { message } = await callModel({
    system: IMPROVE_SKILL_PROMPT,
    messages: [{ role: 'user', content: parts.filter(Boolean).join('\n\n') }],
  });
  return parseImprovedSkill(message.content ?? '');
}

/** Reads the JSON reply; a reply that is plain text is taken as the instructions alone. */
export function parseImprovedSkill(raw: string): { body: string; description: string } | null {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (isRecord(parsed) && 'body' in parsed) {
        // The JSON reply came, but without instructions in it: nothing to use.
        if (typeof parsed.body !== 'string' || !parsed.body.trim()) return null;
        return {
          body: parsed.body.trim(),
          description:
            typeof parsed.description === 'string'
              ? parsed.description.replace(/\s+/g, ' ').trim()
              : '',
        };
      }
    } catch {
      // Not JSON after all: fall through to plain text.
    }
  }
  const body = cleanImprovedPrompt(text);
  return body ? { body, description: '' } : null;
}
