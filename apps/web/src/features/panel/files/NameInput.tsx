import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '../../../components/Spinner';

/**
 * A name typed in place in the tree: renaming a row (its name selected up to the extension),
 * or a new file or folder (starts empty). Enter or leaving the box saves a changed name; an
 * unchanged or empty one, or Escape, cancels. A failure keeps the box open (the reason comes
 * as a toast).
 */
export function NameInput({
  name,
  label,
  placeholder,
  isFile,
  icon,
  paddingLeft,
  onSubmit,
  onCancel,
}: {
  name: string;
  /** what the box is for, for screen readers */
  label: string;
  placeholder?: string;
  isFile: boolean;
  icon: ReactNode;
  paddingLeft: number;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.focus();
    const dot = name.lastIndexOf('.');
    box.setSelectionRange(0, isFile && dot > 0 ? dot : name.length);
  }, [name, isFile]);

  const submit = () => {
    const next = value.trim();
    if (isSaving) return;
    if (!next || next === name) {
      onCancel();
      return;
    }
    setIsSaving(true);
    onSubmit(next)
      .catch(() => input.current?.focus())
      .finally(() => setIsSaving(false));
  };

  return (
    <div style={{ paddingLeft }} className="flex items-center gap-1.5 py-[2px] pr-2">
      {isSaving ? <Spinner size={13} /> : icon}
      <input
        ref={input}
        value={value}
        disabled={isSaving}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        // Switching to another window isn't leaving the box: keep it for when they come back.
        onBlur={() => {
          if (document.hasFocus()) submit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-[18px] min-w-0 flex-1 rounded-md border border-accent bg-surface px-1.5 font-explorer text-[13px] text-ink outline-none ring-1 ring-accent placeholder:text-ink-4"
      />
    </div>
  );
}
