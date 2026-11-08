/** An on/off switch. Give it an `aria-label` (or a visible label that points at it). */
export function Switch({
  isOn,
  onChange,
  disabled = false,
  label,
  title,
}: {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  disabled?: boolean;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={() => onChange(!isOn)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        isOn ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[left] duration-150 ${
          isOn ? 'left-[18px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}
