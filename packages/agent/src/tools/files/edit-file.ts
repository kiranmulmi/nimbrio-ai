import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { assertCanChange } from '../../guardrails.js';
import { locate } from './walk.js';

interface EditInput {
  path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}

export const editFile = defineTool<EditInput>({
  name: 'edit_file',
  description:
    'Change part of a file in the workspace folder by replacing an exact piece of text. Call this for targeted changes to existing files; read the file first so old_text matches it exactly, including indentation.',
  properties: {
    path: { type: 'string', description: 'File path relative to the workspace folder.' },
    old_text: {
      type: 'string',
      description:
        'The exact text to replace. Include enough surrounding lines that it occurs only once.',
    },
    new_text: { type: 'string', description: 'The text to put in its place (empty deletes it).' },
    replace_all: {
      type: 'boolean',
      description: 'Replace every occurrence instead of requiring exactly one. Default false.',
    },
  },
  optional: ['replace_all'],
  needsApproval: true,
  async run({ path: file, old_text: oldText, new_text: newText, replace_all: replaceAll }, ctx) {
    const { root, target, shown } = await locate(ctx, file);
    await assertCanChange(root, target);
    if (!oldText) throw new Error('old_text is empty; use write_file to create or replace a file.');
    if (oldText === newText) throw new Error('old_text and new_text are the same.');
    const content = await fs.readFile(target, 'utf8');

    // Files with Windows line endings: the model usually writes "\n".
    const usesCrlf = content.includes('\r\n') && !oldText.includes('\r\n');
    const find = usesCrlf ? oldText.replace(/\n/g, '\r\n') : oldText;
    const replacement = usesCrlf ? newText.replace(/\n/g, '\r\n') : newText;

    const count = content.split(find).length - 1;
    if (count === 0) {
      throw new Error(
        `old_text was not found in ${shown}. Read the file again and copy the text exactly.`,
      );
    }
    if (count > 1 && !replaceAll) {
      throw new Error(
        `old_text occurs ${count} times in ${shown}. Add surrounding lines to make it unique, or set replace_all.`,
      );
    }
    const updated = replaceAll
      ? content.split(find).join(replacement)
      : content.replace(find, () => replacement);
    await fs.writeFile(target, updated, 'utf8');
    return `Edited ${shown}: replaced ${count} occurrence${count === 1 ? '' : 's'}.`;
  },
});
