import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileContent } from '@app/shared';
import { useHighlighter } from '../../../components/CodeHighlight';
import { Modal } from '../../../components/Modal';
import { Spinner } from '../../../components/Spinner';
import { ApiError, errorMessage } from '../../../lib/api';
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CrossIcon,
  EditIcon,
  SearchIcon,
  WrapIcon,
} from '../../../lib/icons';
import { languageForPath, languageLabel } from '../../../lib/languages';
import { readPref, writePref } from '../../../lib/storage';

// The editor (CodeMirror and its language modes) loads only when the user clicks Edit.
const CodeEditor = lazy(() =>
  import('./CodeEditor').then((module) => ({ default: module.CodeEditor })),
);

const WRAP_KEY = 'agent.previewWrap';
/** Past this many matches the counter says "999+" and only those are highlighted. */
const MAX_MATCHES = 999;

const TOOL =
  'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors';
const STEP =
  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent';

interface Match {
  line: number;
  start: number;
  end: number;
}

/** Every case-insensitive match of `query`, line by line. */
function findMatches(lines: readonly string[], query: string): Match[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: Match[] = [];
  lines.forEach((text, line) => {
    const haystack = text.toLowerCase();
    for (
      let at = haystack.indexOf(needle);
      at !== -1;
      at = haystack.indexOf(needle, at + needle.length)
    ) {
      if (matches.length >= MAX_MATCHES) return;
      matches.push({ line, start: at, end: at + needle.length });
    }
  });
  return matches;
}

/** A DOM range over characters `start`–`end` of `element`'s text, across its coloured spans. */
function rangeIn(element: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let isStarted = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!isStarted && start < offset + length) {
      range.setStart(node, start - offset);
      isStarted = true;
    }
    if (isStarted && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

// Matches are painted with the CSS Custom Highlight API, so the code's own colours stay.
const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS;

type SaveProblem = { message: string; isConflict: boolean };

/**
 * A file from the Files panel: highlighted, with line numbers, search, copy and line wrap.
 * Edit turns it into an editor; Save (⌘S) writes it, and refuses to overwrite a file that
 * changed on disk meanwhile unless the user says so.
 */
export function FilePreview({
  file: opened,
  onClose,
  onSave,
  onReload,
  startEditing = false,
  initialQuery = '',
  initialLine,
}: {
  file: FileContent;
  onClose: () => void;
  /** writes the file; `baseVersion` left out means overwrite */
  onSave: (content: string, baseVersion?: string) => Promise<FileContent>;
  /** the file as it is on disk now */
  onReload: () => Promise<FileContent>;
  /** opens straight in the editor (a file just created) */
  startEditing?: boolean;
  /** opens with this in the search box (a search result from the Files panel) */
  initialQuery?: string;
  /** 1-based: the match on this line is the current one */
  initialLine?: number;
}) {
  // The file as last read or saved; `draft` is the editor's text.
  const [file, setFile] = useState(opened);
  const [isEditing, setIsEditing] = useState(startEditing);
  const [draft, setDraft] = useState(opened.content);
  const [editorKey, setEditorKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const isDirty = isEditing && draft !== file.content;
  const language = languageForPath(file.path);
  const highlighter = useHighlighter();
  const [isWrapped, setIsWrapped] = useState(() => readPref(WRAP_KEY) === 'true');
  const [isCopied, setIsCopied] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [current, setCurrent] = useState(() => {
    if (!initialQuery || initialLine === undefined) return 0;
    const opened = findMatches(file.content.replace(/\n$/, '').split('\n'), initialQuery);
    return Math.max(
      0,
      opened.findIndex((match) => match.line === initialLine - 1),
    );
  });
  /** A new search starts from its first match. */
  const changeQuery = (next: string) => {
    setQuery(next);
    setCurrent(0);
  };
  const search = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => file.content.replace(/\n$/, '').split('\n'), [file.content]);
  // Highlighted as a whole, then shown line by line (plain until the highlighter loads).
  const coloured = useMemo(
    () => (highlighter && language ? highlighter.highlightLines(file.content, language) : null),
    [highlighter, language, file.content],
  );
  const matches = useMemo(() => findMatches(lines, query), [lines, query]);
  const active = matches[current] ?? null;
  const matchedLines = useMemo(() => new Set(matches.map((m) => m.line)), [matches]);

  useEffect(() => {
    if (!isCopied) return;
    const timer = window.setTimeout(() => setIsCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [isCopied]);

  // Paint every match, the current one stronger, and bring the current one into view.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const lineEl = (line: number) => root.querySelector(`[data-line="${line}"]`);
    if (canHighlight) {
      const all = matches.flatMap((m) => {
        const el = lineEl(m.line);
        const range = el ? rangeIn(el, m.start, m.end) : null;
        return range ? [range] : [];
      });
      const el = active ? lineEl(active.line) : null;
      const now = el && active ? rangeIn(el, active.start, active.end) : null;
      CSS.highlights.set('preview-match', new Highlight(...all));
      CSS.highlights.set('preview-current', new Highlight(...(now ? [now] : [])));
    }
    if (active) lineEl(active.line)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return () => {
      if (!canHighlight) return;
      CSS.highlights.delete('preview-match');
      CSS.highlights.delete('preview-current');
    };
  }, [matches, active, coloured, isWrapped]);

  const save = useCallback(
    async (isOverwrite = false) => {
      if (isSaving) return;
      setIsSaving(true);
      setProblem(null);
      try {
        const saved = await onSave(draft, isOverwrite ? undefined : file.version);
        setFile(saved);
        setIsSaved(true);
        setIsClosing(false);
      } catch (cause) {
        setProblem({
          message: errorMessage(cause, "Couldn't save the file."),
          isConflict: cause instanceof ApiError && cause.status === 409,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [draft, file.version, isSaving, onSave],
  );

  /** Takes the file as it is on disk now; the unsaved edits are dropped. */
  const reload = async () => {
    try {
      const fresh = await onReload();
      setFile(fresh);
      setDraft(fresh.content);
      setEditorKey((key) => key + 1);
      setProblem(null);
    } catch (cause) {
      setProblem({ message: errorMessage(cause, "Couldn't reload the file."), isConflict: false });
    }
  };

  const stopEditing = () => {
    setDraft(file.content);
    setIsEditing(false);
    setProblem(null);
    setIsClosing(false);
  };

  /** Unsaved edits ask first (inside the preview, not a browser dialog). */
  const requestClose = useCallback(() => {
    if (isDirty) setIsClosing(true);
    else onClose();
  }, [isDirty, onClose]);

  const onDraftChange = useCallback((text: string) => {
    setDraft(text);
    setIsSaved(false);
  }, []);
  const onEditorSave = useCallback(() => void save(), [save]);

  useEffect(() => {
    if (!isSaved) return;
    const timer = window.setTimeout(() => setIsSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [isSaved]);

  // ⌘F / Ctrl+F searches the file instead of the page while the preview is open (the editor
  // has its own search). ⌘S / Ctrl+S saves while editing, wherever the focus is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if (key === 'f' && !isEditing) {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (key === 's' && isEditing) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditing, save]);

  const step = (by: number) => {
    if (!matches.length) return;
    setCurrent((index) => (index + by + matches.length) % matches.length);
  };
  const copy = () => {
    void navigator.clipboard.writeText(file.content).then(() => setIsCopied(true));
  };
  const toggleWrap = () => {
    setIsWrapped((wrap) => {
      writePref(WRAP_KEY, String(!wrap));
      return !wrap;
    });
  };

  const count =
    matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : matches.length.toLocaleString('en');

  return (
    <Modal
      title={file.path}
      onClose={requestClose}
      size="wide"
      actions={
        isEditing ? (
          <>
            <span
              className={`mr-1 text-[12px] ${isDirty ? 'font-medium text-warn' : isSaved ? 'text-success' : 'text-ink-3'}`}
            >
              {isSaving ? 'Saving…' : isDirty ? '● Unsaved changes' : isSaved ? 'Saved' : 'Editing'}
            </span>
            <button
              type="button"
              onClick={toggleWrap}
              aria-pressed={isWrapped}
              title={isWrapped ? 'Show long lines on one line' : 'Wrap long lines'}
              className={`${TOOL} ${isWrapped ? 'bg-accent-soft text-accent-2' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
            >
              <WrapIcon /> Wrap
            </button>
            <button
              type="button"
              onClick={stopEditing}
              title={isDirty ? 'Drop the unsaved changes' : 'Back to the read-only view'}
              className={`${TOOL} text-ink-2 hover:bg-surface-2 hover:text-ink`}
            >
              {isDirty ? 'Discard' : 'Done'}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!isDirty || isSaving}
              title="Save (⌘S)"
              className={`${TOOL} bg-accent text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isSaving ? <Spinner size={12} /> : <CheckIcon />} Save
            </button>
          </>
        ) : (
          <>
            <label className="mr-1 flex h-8 w-[min(300px,38vw)] items-center gap-1.5 rounded-lg border border-line bg-surface pl-2.5 pr-1 focus-within:border-line-strong">
              <SearchIcon size={13} className="shrink-0 text-ink-3" />
              <span className="sr-only">Search in file</span>
              <input
                ref={search}
                type="search"
                value={query}
                placeholder="Search in file"
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' ||
                    event.key === 'ArrowDown' ||
                    event.key === 'ArrowUp'
                  ) {
                    event.preventDefault();
                    step(event.key === 'ArrowUp' || event.shiftKey ? -1 : 1);
                  } else if (event.key === 'Escape' && query) {
                    // The first Escape clears the search; the next one closes the preview.
                    event.stopPropagation();
                    changeQuery('');
                  }
                }}
                className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <>
                  <span className="shrink-0 px-1 text-[11.5px] tabular-nums text-ink-3">
                    {matches.length ? `${current + 1} / ${count}` : 'No results'}
                  </span>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    disabled={!matches.length}
                    aria-label="Previous match"
                    title="Previous (Shift+Enter)"
                    className={STEP}
                  >
                    <ChevronDownIcon size={11} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    disabled={!matches.length}
                    aria-label="Next match"
                    title="Next (Enter)"
                    className={STEP}
                  >
                    <ChevronDownIcon size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      changeQuery('');
                      search.current?.focus();
                    }}
                    aria-label="Clear search"
                    className={STEP}
                  >
                    <CrossIcon size={10} />
                  </button>
                </>
              )}
            </label>
            <span className="mr-1 hidden text-[12px] text-ink-3 lg:inline">
              {languageLabel(language)} · {lines.length.toLocaleString('en')}{' '}
              {lines.length === 1 ? 'line' : 'lines'}
            </span>
            <button
              type="button"
              onClick={toggleWrap}
              aria-pressed={isWrapped}
              title={isWrapped ? 'Show long lines on one line' : 'Wrap long lines'}
              className={`${TOOL} ${isWrapped ? 'bg-accent-soft text-accent-2' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
            >
              <WrapIcon /> Wrap
            </button>
            <button
              type="button"
              onClick={copy}
              title="Copy the file's text"
              className={`${TOOL} ${isCopied ? 'text-success' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
            >
              {isCopied ? <CheckIcon /> : <CopyIcon />} {isCopied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(file.content);
                setEditorKey((key) => key + 1);
                setIsEditing(true);
              }}
              title="Edit this file"
              className={`${TOOL} text-ink-2 hover:bg-surface-2 hover:text-ink`}
            >
              <EditIcon /> Edit
            </button>
          </>
        )
      }
    >
      {isEditing ? (
        <div className="flex h-full flex-col">
          {(problem ?? isClosing) && (
            <div
              role="alert"
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-[12.5px] ${
                problem
                  ? 'border-danger-line bg-danger-bg text-danger'
                  : 'border-warn-line bg-warn-bg text-ink'
              }`}
            >
              <span className="min-w-0 flex-1">
                {problem ? problem.message : 'This file has unsaved changes.'}
              </span>
              {problem?.isConflict ? (
                <>
                  <button
                    type="button"
                    onClick={() => void reload()}
                    className="font-semibold underline"
                  >
                    Reload (drop my edits)
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(true)}
                    className="font-semibold underline"
                  >
                    Overwrite with mine
                  </button>
                </>
              ) : isClosing && !problem ? (
                <>
                  <button
                    type="button"
                    onClick={() => void save()}
                    className="font-semibold text-accent-2 underline"
                  >
                    Save
                  </button>
                  <button type="button" onClick={onClose} className="font-semibold underline">
                    Discard and close
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsClosing(false)}
                    className="font-semibold underline"
                  >
                    Keep editing
                  </button>
                </>
              ) : null}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={
                <div className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-ink-3">
                  <Spinner size={12} /> Opening the editor…
                </div>
              }
            >
              <CodeEditor
                key={editorKey}
                initial={draft}
                path={file.path}
                isWrapped={isWrapped}
                onChange={onDraftChange}
                onSave={onEditorSave}
              />
            </Suspense>
          </div>
        </div>
      ) : (
        <div
          ref={body}
          className={`min-w-full py-2 font-mono text-[12.5px] leading-relaxed text-ink ${
            isWrapped ? '' : 'w-max'
          }`}
        >
          {lines.map((line, index) => {
            const isActiveLine = active?.line === index;
            // Without the highlight API, matching lines are tinted instead.
            const tint = canHighlight
              ? isActiveLine
                ? 'bg-[var(--search-line)]'
                : ''
              : isActiveLine
                ? 'bg-[var(--search-current)]'
                : matchedLines.has(index)
                  ? 'bg-[var(--search-match)]'
                  : '';
            return (
              <div key={index} className={`flex hover:bg-subtle ${tint}`}>
                {/* Numbers stay put while the code scrolls sideways, and aren't copied with it. */}
                <span
                  aria-hidden
                  className={`sticky left-0 w-14 shrink-0 select-none pr-4 text-right tabular-nums ${
                    isActiveLine ? 'bg-[var(--search-line)] text-ink-2' : 'bg-surface text-ink-4'
                  }`}
                >
                  {index + 1}
                </span>
                <span
                  data-line={index}
                  className={`min-w-0 flex-1 pr-6 ${
                    isWrapped ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'
                  }`}
                >
                  {coloured?.[index]?.length ? coloured[index] : line || ' '}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
