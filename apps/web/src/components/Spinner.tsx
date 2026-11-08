/** A ring that spins in the current text colour. */
export function Spinner({ size = 14, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 7)) }}
      className="inline-block shrink-0 animate-spin-fast rounded-full border-current border-r-transparent motion-reduce:animate-none"
    />
  );
}
