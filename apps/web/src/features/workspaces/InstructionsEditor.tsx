import { INSTRUCTIONS_REQUEST_MAX_CHARS, LIMITS } from '@app/shared';
import { AiWritingEditor, type AiChip } from '../../components/AiWritingEditor';
import { writeInstructions } from './api';

/** One click: a request sent as it is (the model also sees the name, folder and project). */
const STARTERS = [
  'Coding assistant for this project',
  'Code reviewer: find bugs and suggest fixes',
  'Writing tutor: correct my English',
];
const REFINEMENTS: readonly AiChip[] = [
  { label: 'Tidy it up', request: '' },
  { label: 'Shorter', request: 'Make it shorter and keep only what matters most.' },
  { label: 'More detailed', request: 'Make it more detailed and specific to this project.' },
  {
    label: 'Add checks before done',
    request: 'Add what to check before a task is done (build, tests, lint), from the project.',
  },
];

/**
 * A steady height that fits the settings popup (min(820px, 88vh)) with the AI bar, hint and
 * buttons all in view, so only the text scrolls, inside the box. Never below 180px.
 */
const BOX_HEIGHT = 'h-[max(180px,calc(min(820px,88vh)-388px))]';

/**
 * The workspace's instructions box with the AI writer attached: describe the workspace (or ask
 * for a change) and the model writes the instructions, using the workspace's name and a quick
 * look at its folder.
 */
export function InstructionsEditor({
  id,
  value,
  onChange,
  hasError,
  describedBy,
  workspaceName,
  folderPath,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  hasError: boolean;
  describedBy: string;
  workspaceName: string;
  folderPath: string;
}) {
  return (
    <AiWritingEditor
      id={id}
      value={value}
      onChange={onChange}
      hasError={hasError}
      describedBy={describedBy}
      write={(request, current) =>
        writeInstructions({
          request,
          current,
          name: workspaceName.trim() || undefined,
          path: folderPath.trim() || undefined,
        })
      }
      placeholder="How the agent should behave in every chat of this workspace. For example: You are my English tutor. Gently correct my mistakes in each message and show a better version."
      maxLength={LIMITS.instructions}
      requestMaxLength={INSTRUCTIONS_REQUEST_MAX_CHARS}
      starters={STARTERS}
      refinements={REFINEMENTS}
      askPlaceholder={{
        empty: 'Describe this workspace and AI writes the instructions',
        filled: 'Ask AI to change them, e.g. "always reply in Nepali"',
      }}
      heightClass={BOX_HEIGHT}
      failMessage="Couldn't write the instructions."
    />
  );
}
