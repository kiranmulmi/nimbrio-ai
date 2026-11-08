import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ATTACHMENT_LIMITS,
  attachmentKind,
  type Attachment,
  type Skill,
  type Usage,
} from '@app/shared';
import { PATH_DRAG_TYPE, PATH_KIND_DRAG_TYPE } from '../../lib/dragPath';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import {
  FileTintIcon,
  FolderTintIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  StopIcon,
  WandIcon,
} from '../../lib/icons';
import {
  expandMentions,
  splitMentions,
  tokenFor,
  type Mentions,
  type PathMention,
} from './pathMentions';
import { AttachmentChip } from './AttachmentChip';
import { ChatUsageLine } from './ChatUsageLine';
import type { ConversationState } from './conversation';
import type { ReturnedDraft } from './useConversation';
import { SkillChip } from './SkillChip';
import { SkillPicker } from './SkillPicker';
import { useSpeechInput } from './useSpeechInput';
import { useDraftAttachments } from './useDraftAttachments';

const MAX_HEIGHT = 240;

/** Shared by the box and the copy behind it, so their text lines up exactly. */
const BOX_TEXT =
  'px-4 pb-1 pt-3 text-[14px] leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word] [scrollbar-gutter:stable]';

/**
 * The message box: Enter sends, Shift+Enter adds a line. `controls` pick the model. Files
 * can be attached with the paperclip, dropped on the box or pasted; they upload right away.
 * Skills can be picked for the message with the Skills button; they're sent with it.
 */
export function Composer({
  workspaceId,
  disabled,
  hasModel,
  controls,
  skills,
  focusKey,
  usage,
  context,
  onShowUsage,
  onSend,
  onImprove,
  isRunning = false,
  isStopping = false,
  onStop,
  onSteer,
  restoreDraft = null,
}: {
  workspaceId: string;
  disabled: boolean;
  /** False until a model is set up: typing works, sending waits. */
  hasModel: boolean;
  controls: ReactNode;
  /** The workspace's skills, to pick from; null while loading. */
  skills: Skill[] | null;
  /** Focus moves back to the box when this changes (another chat) or a run ends. */
  focusKey: string;
  /** This chat's tokens so far, shown under the box once there are any. */
  usage: Usage;
  /** How full the model's context window was at the last call (null before one). */
  context: ConversationState['context'];
  /** Opens the chat's token usage breakdown, by message. */
  onShowUsage?: () => void;
  onSend: (text: string, attachments: Attachment[], skills: string[]) => void;
  /** Rewrites the draft (the wand button); resolves to the improved text. */
  onImprove: (text: string) => Promise<string>;
  /** The agent is working on this chat: the send button becomes Stop. */
  isRunning?: boolean;
  isStopping?: boolean;
  onStop?: () => void;
  /**
   * While the agent works, sends the text to it: it reads it before its next step. Files and
   * picked skills stay in the box for the next message.
   */
  onSteer?: (text: string) => void;
  /** Text to put back in the box (a message the agent didn't read), before what's typed. */
  restoreDraft?: ReturnedDraft | null;
}) {
  const [value, setValue] = useState('');
  // Skills picked for this message (by name); one deleted meanwhile is dropped on send.
  const [picked, setPicked] = useState<string[]>([]);
  const toggleSkill = (name: string) =>
    setPicked((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  // What is being dragged over the box: files to attach, or a path from the Files panel.
  const [dragging, setDragging] = useState<'files' | 'path' | null>(null);
  const isDragging = dragging !== null;
  // Dropped paths, by the token that stands for them in the box.
  const [mentions, setMentions] = useState<Mentions>(new Map());
  const parts = splitMentions(value, mentions);
  const hasMentions = parts.some((part) => part.type === 'mention');
  const backdrop = useRef<HTMLDivElement>(null);
  // The wand: rewriting, the draft it replaced (for Undo), and why it failed.
  const [isImproving, setIsImproving] = useState(false);
  const [beforeImprove, setBeforeImprove] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  // Voice: what was said goes after what's typed, once you stop speaking.
  const speech = useSpeechInput(
    useCallback((text: string) => {
      setValue((current) => (current.trim() ? `${current.replace(/\s+$/, '')} ${text}` : text));
      setBeforeImprove(null);
      ref.current?.focus();
    }, []),
  );

  const improve = () => {
    const draft = value.trim();
    if (!draft || isImproving || !hasModel) return;
    setIsImproving(true);
    setImproveError(null);
    onImprove(value)
      .then((text) => {
        setBeforeImprove(value);
        setValue(text);
        ref.current?.focus();
      })
      .catch((cause: unknown) => setImproveError(errorMessage(cause, "Couldn't improve it.")))
      .finally(() => setIsImproving(false));
  };
  const undoImprove = () => {
    if (beforeImprove === null) return;
    setValue(beforeImprove);
    setBeforeImprove(null);
    ref.current?.focus();
  };
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const files = useDraftAttachments(workspaceId);
  const hasContent = value.trim() !== '' || files.ready.length > 0;
  const isSteering = isRunning && onSteer !== undefined;
  const canSubmit = isSteering
    ? !disabled && !isStopping && value.trim() !== ''
    : !disabled && hasModel && !files.isUploading && hasContent;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled, focusKey]);

  useEffect(() => {
    if (!restoreDraft) return;
    setValue((current) =>
      current.trim() ? `${restoreDraft.text}\n\n${current}` : restoreDraft.text,
    );
    ref.current?.focus();
  }, [restoreDraft]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    if (isSteering) {
      onSteer(expandMentions(value, mentions));
      setValue('');
      setMentions(new Map());
      setBeforeImprove(null);
      setImproveError(null);
      return;
    }
    const available = new Set((skills ?? []).map((skill) => skill.name));
    onSend(
      expandMentions(value, mentions),
      files.ready,
      picked.filter((name) => available.has(name)),
    );
    setValue('');
    setPicked([]);
    setMentions(new Map());
    setBeforeImprove(null);
    setImproveError(null);
    files.clear();
  };

  const dragKind = (event: DragEvent) =>
    event.dataTransfer.types.includes(PATH_DRAG_TYPE)
      ? 'path'
      : event.dataTransfer.types.includes('Files')
        ? 'files'
        : null;

  /** Put `text` where the caret is (or in place of the selection), spaced from its neighbours. */
  const insertAtCaret = (text: string) => {
    const box = ref.current;
    const start = box?.selectionStart ?? value.length;
    const end = box?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    const inserted = `${lead}${text}${trail}`;
    setValue(before + inserted + after);
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(caret, caret);
    });
  };

  return (
    <form onSubmit={submit} className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
      <div
        // Clicking the padding or the bottom row still puts the caret in the box.
        onClick={() => ref.current?.focus()}
        onDragEnter={(event) => {
          const kind = dragKind(event);
          if (kind) setDragging(kind);
        }}
        onDragOver={(event) => {
          if (!dragKind(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(null);
          }
        }}
        onDrop={(event) => {
          const kind = dragKind(event);
          if (!kind) return;
          event.preventDefault();
          setDragging(null);
          if (kind === 'path') {
            const path = event.dataTransfer.getData(PATH_DRAG_TYPE);
            if (!path) return;
            const mention: PathMention = {
              path,
              kind:
                event.dataTransfer.getData(PATH_KIND_DRAG_TYPE) === 'folder' ? 'folder' : 'file',
            };
            const token = tokenFor(path, mentions);
            setMentions((current) => new Map(current).set(token, mention));
            insertAtCaret(token);
          } else files.add(event.dataTransfer.files);
        }}
        className={`relative mx-auto w-full max-w-[1000px] cursor-text rounded-2xl border bg-surface shadow-card transition-[border-color,box-shadow] focus-within:border-line-strong focus-within:shadow-float ${
          isDragging ? 'border-accent' : 'border-line hover:border-line-strong'
        }`}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-accent-soft text-[13px] font-medium text-accent">
            {dragging === 'path' ? 'Drop to insert its path' : 'Drop files to attach them'}
          </div>
        )}
        {(files.drafts.length > 0 || picked.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {picked.map((name) => (
              <SkillChip key={name} name={name} onRemove={() => toggleSkill(name)} />
            ))}
            {files.drafts.map((draft) => (
              <AttachmentChip
                key={draft.key}
                name={draft.name}
                size={draft.size}
                kind={draft.attachment?.kind ?? attachmentKind(draft.name, '')}
                previewUrl={draft.previewUrl}
                status={draft.status}
                error={draft.error}
                onRemove={() => files.remove(draft.key)}
              />
            ))}
          </div>
        )}
        <div className="relative">
          {/* Dropped paths show as pills: a copy of the text behind the (then see-through)
            box, styled without changing any widths, so the caret stays where it should. */}
          {hasMentions && (
            <div
              ref={backdrop}
              aria-hidden
              className={`${BOX_TEXT} pointer-events-none absolute inset-0 overflow-hidden text-ink`}
            >
              {parts.map((part, index) =>
                part.type === 'text' ? (
                  part.text
                ) : (
                  <span
                    key={index}
                    title={part.mention.path}
                    className="rounded-[5px] bg-accent-soft text-accent-2 shadow-[0_0_0_2px_var(--accent-soft)]"
                  >
                    <span className="relative">
                      <span className="invisible">@</span>
                      {part.mention.kind === 'folder' ? (
                        <FolderTintIcon
                          size={13}
                          className="absolute left-0 top-1/2 -translate-y-1/2 text-ft-folder"
                        />
                      ) : (
                        <FileTintIcon
                          size={13}
                          className="absolute left-0 top-1/2 -translate-y-1/2"
                        />
                      )}
                    </span>
                    {part.text.slice(1)}
                  </span>
                ),
              )}
              {'\n'}
            </div>
          )}
          <textarea
            ref={ref}
            rows={2}
            value={value}
            onScroll={(event) => {
              if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              // A pasted screenshot or file is attached; pasted text goes in as usual.
              if (event.clipboardData.files.length === 0) return;
              event.preventDefault();
              files.add(event.clipboardData.files);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              isSteering
                ? 'Add to the task: the agent reads it before its next step…'
                : disabled
                  ? 'The agent is working…'
                  : 'Message the agent…'
            }
            name="message"
            aria-label="Message"
            className={`${BOX_TEXT} relative block w-full resize-none bg-transparent text-ink caret-ink outline-none placeholder:text-ink-3 focus-visible:outline-none ${
              hasMentions ? '[-webkit-text-fill-color:transparent]' : ''
            }`}
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pl-2.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                picker.current?.click();
              }}
              disabled={files.isFull}
              aria-label="Attach files"
              title={
                files.isFull
                  ? `At most ${ATTACHMENT_LIMITS.perMessage} files per message`
                  : 'Attach files: images, PDFs, Word documents, text'
              }
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-ink-3 transition-colors hover:bg-accent-soft hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PaperclipIcon size={16} />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) files.add(event.target.files);
                event.target.value = ''; // so picking the same file again still adds it
              }}
            />
            {speech.isSupported && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (speech.isListening) speech.stop();
                  else speech.start();
                }}
                disabled={disabled && !speech.isListening}
                aria-label={speech.isListening ? 'Stop listening' : 'Speak your message'}
                aria-pressed={speech.isListening}
                title={
                  speech.isListening
                    ? 'Listening… it stops when you pause, or click to stop'
                    : 'Speak your message: the text goes into the box when you stop speaking'
                }
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  speech.isListening
                    ? 'bg-danger-bg text-danger'
                    : 'text-ink-3 hover:bg-accent-soft hover:text-accent-2 disabled:hover:bg-transparent disabled:hover:text-ink-3'
                }`}
              >
                <MicIcon size={16} className={speech.isListening ? 'animate-pulse' : ''} />
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                improve();
              }}
              disabled={isImproving || !value.trim() || !hasModel || disabled}
              aria-label="Improve this prompt"
              title={
                !hasModel
                  ? 'Add a model first'
                  : value.trim()
                    ? 'Improve this prompt: clearer and more specific, same request'
                    : 'Type a prompt to improve it'
              }
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-ink-3 transition-colors hover:bg-accent-soft hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-3"
            >
              {isImproving ? <Spinner size={13} label="Improving" /> : <WandIcon size={16} />}
            </button>
            {beforeImprove !== null && !isImproving && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  undoImprove();
                }}
                title="Put back what you typed"
                className="h-7 shrink-0 rounded-lg px-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Undo
              </button>
            )}
            <SkillPicker skills={skills} picked={picked} onToggle={toggleSkill} />
            <span aria-hidden className="mx-1 h-4 w-px bg-line" />
            <div className="min-w-0">{controls}</div>
          </div>
          {isSteering && value.trim() && (
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label="Send to the agent now"
              title={
                files.ready.length || picked.length
                  ? 'Send the text now: the agent reads it before its next step. Files and skills wait for your next message.'
                  : 'Send now: the agent reads it before its next step'
              }
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent shadow-accent transition-[background-color,transform] hover:bg-accent-hover enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:shadow-none"
            >
              <SendIcon size={15} />
            </button>
          )}
          {isRunning && onStop ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStop();
              }}
              disabled={isStopping}
              aria-label={isStopping ? 'Stopping' : 'Stop the agent'}
              title={isStopping ? 'Stopping…' : 'Stop the agent'}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink text-surface transition-[background-color,transform] hover:bg-ink-2 enabled:hover:-translate-y-px disabled:cursor-wait disabled:opacity-70"
            >
              {isStopping ? <Spinner size={13} label="Stopping" /> : <StopIcon size={14} />}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label="Send"
              title={
                !hasModel
                  ? 'Add a model first'
                  : files.isUploading
                    ? 'Waiting for uploads…'
                    : 'Send'
              }
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent shadow-accent transition-[background-color,transform] hover:bg-accent-hover enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:shadow-none"
            >
              <SendIcon size={15} />
            </button>
          )}
        </div>
      </div>
      {(speech.isListening || speech.error) && (
        <p
          role={speech.error ? 'alert' : 'status'}
          className={`mx-auto mt-1.5 flex w-full max-w-[1000px] items-center gap-1.5 px-1 text-[12px] ${
            speech.error ? 'text-danger' : 'text-ink-3'
          }`}
        >
          {speech.error ?? (
            <>
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
              <span className="min-w-0 truncate">
                {speech.interim ? `“${speech.interim}”` : 'Listening… speak now'}
              </span>
            </>
          )}
        </p>
      )}
      {improveError && (
        <p
          role="alert"
          className="mx-auto mt-1.5 w-full max-w-[1000px] px-1 text-[12px] text-danger"
        >
          {improveError}
        </p>
      )}
      <ChatUsageLine usage={usage} context={context} onShowUsage={onShowUsage} />
    </form>
  );
}
