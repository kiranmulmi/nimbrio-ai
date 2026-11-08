/** "Thinking…", "Running web_search…": what the agent is doing while no text streams. */
export function StatusLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 text-[13px] text-ink-3" role="status">
      <span aria-hidden className="live-dot" />
      {text}
    </div>
  );
}
