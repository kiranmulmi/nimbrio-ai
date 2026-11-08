import { useMemo, type ReactNode } from 'react';
import { CodeHighlight, useHighlighter } from '../../components/CodeHighlight';
import { CodeText } from '../../components/CodeText';
import { prettyJson } from '../../lib/format';
import { FileTintIcon } from '../../lib/icons';
import { languageForPath, languageLabel } from '../../lib/languages';
import { fileTint } from '../panel/files/fileTint';
import { InputFields } from './InputFields';

const CODE =
  'max-h-[340px] overflow-auto whitespace-pre font-mono text-[12px] leading-relaxed text-ink';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Arguments arrive as JSON text (tool rows) or already parsed (approvals). */
function parsed(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

/** A file's path with its tinted icon, the language on the right. */
function FileHeader({ path, label }: { path: string; label: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line-2 bg-subtle px-3 py-2">
      <FileTintIcon size={14} className={`shrink-0 ${fileTint(path).icon}`} />
      <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-ink">{path}</span>
      <span className="ml-auto shrink-0 text-[11px] font-medium text-ink-3">{label}</span>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-line bg-surface">{children}</div>;
}

/** write_file: the new file as highlighted code. */
function WriteFile({ path, content }: { path: string; content: string }) {
  const language = languageForPath(path);
  const lines = content.split('\n').length;
  return (
    <Frame>
      <FileHeader path={path} label={`${languageLabel(language)} · ${lines} lines`} />
      <pre className={`${CODE} px-3 py-2.5`}>
        <code>
          <CodeHighlight code={content} language={language} />
        </code>
      </pre>
    </Frame>
  );
}

/** edit_file: the replaced lines in red, the new ones in green, both coloured as code. */
function EditFile({ path, oldText, newText }: { path: string; oldText: string; newText: string }) {
  const removed = oldText ? oldText.split('\n') : [];
  const added = newText ? newText.split('\n') : [];
  const language = languageForPath(path);
  const highlighter = useHighlighter();
  // Each side is highlighted whole, then shown line by line; plain text until it loads.
  const [oldLines, newLines] = useMemo(
    () =>
      highlighter && language
        ? [
            highlighter.highlightLines(oldText, language),
            highlighter.highlightLines(newText, language),
          ]
        : [null, null],
    [highlighter, language, oldText, newText],
  );
  return (
    <Frame>
      <FileHeader
        path={path}
        label={
          <>
            <span className="text-danger">−{removed.length}</span>{' '}
            <span className="text-success">+{added.length}</span>
          </>
        }
      />
      <pre className={`${CODE} py-1.5`}>
        {removed.map((line, index) => (
          <div key={`r${index}`} className="flex bg-danger-bg px-3">
            <span aria-hidden className="w-4 shrink-0 select-none text-danger">
              −
            </span>
            <span className="text-ink">
              {oldLines?.[index]?.length ? oldLines[index] : line || ' '}
            </span>
          </div>
        ))}
        {added.map((line, index) => (
          <div key={`a${index}`} className="flex bg-success-bg px-3">
            <span aria-hidden className="w-4 shrink-0 select-none text-success">
              +
            </span>
            <span className="text-ink">
              {newLines?.[index]?.length ? newLines[index] : line || ' '}
            </span>
          </div>
        ))}
        {!removed.length && !added.length && <div className="px-3 text-ink-3">(no change)</div>}
      </pre>
    </Frame>
  );
}

/** run_command: the command as it would be typed, with where and how long it may run. */
function RunCommand({ command, notes }: { command: string; notes: string[] }) {
  return (
    <Frame>
      <pre className={`${CODE} whitespace-pre-wrap px-3 py-2.5 [overflow-wrap:anywhere]`}>
        <code>
          <span className="select-none text-ink-3">$ </span>
          <CodeHighlight code={command} language="bash" />
        </code>
      </pre>
      {notes.length > 0 && (
        <div className="border-t border-line-2 bg-subtle px-3 py-1.5 text-[11.5px] text-ink-3">
          {notes.join(' · ')}
        </div>
      )}
    </Frame>
  );
}

/** The agent's one-line reason for a step that needed approval, shown above its input. */
function Reason({ text }: { text: string }) {
  return (
    <p className="mb-2 flex items-start gap-2 rounded-xl border border-accent-bg bg-accent-soft px-3 py-2 text-[13px] leading-snug text-ink">
      <span className="mt-px shrink-0 text-[10.5px] font-bold uppercase tracking-[0.12em] text-accent-2">
        Why
      </span>
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/**
 * A tool's input, shown the way it reads best: a file write as highlighted code, an edit as
 * a diff, a command as a shell line, other arguments as a labelled list (InputFields). Steps that needed
 * approval start with the agent's reason for them.
 */
export function ToolInput({ tool, input }: { tool: string; input: unknown }) {
  const all = parsed(input);
  const reason = isRecord(all) && typeof all.reason === 'string' ? all.reason.trim() : '';
  const value = reason && isRecord(all) ? withoutKey(all, 'reason') : all;
  return (
    <>
      {reason && <Reason text={reason} />}
      <InputBody tool={tool} value={value} />
    </>
  );
}

const withoutKey = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

function InputBody({ tool, value }: { tool: string; value: unknown }) {
  if (isRecord(value)) {
    const { path } = value;
    if (tool === 'write_file' && typeof path === 'string' && typeof value.content === 'string') {
      return <WriteFile path={path} content={value.content} />;
    }
    if (
      tool === 'edit_file' &&
      typeof path === 'string' &&
      typeof value.old_text === 'string' &&
      typeof value.new_text === 'string'
    ) {
      return <EditFile path={path} oldText={value.old_text} newText={value.new_text} />;
    }
    if (tool === 'run_command' && typeof value.command === 'string') {
      const { cwd, timeout_seconds: timeout } = value;
      const notes = [
        typeof cwd === 'string' && cwd !== '.' ? `in ${cwd}/` : '',
        typeof timeout === 'number' ? `timeout ${timeout}s` : '',
      ].filter(Boolean);
      return <RunCommand command={value.command} notes={notes} />;
    }
    return <InputFields value={value} />;
  }
  const text =
    typeof value === 'string' ? value : prettyJson(JSON.stringify(value ?? null) ?? 'null');
  return (
    <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-xl border border-line-2 bg-subtle px-3 py-2.5 font-mono text-[12px] text-ink [overflow-wrap:anywhere]">
      {text ? <CodeText text={text} /> : '(none)'}
    </pre>
  );
}
