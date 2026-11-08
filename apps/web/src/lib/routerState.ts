/** Where a form page was opened from, passed as router state (`{ from }`) by the link to it. */
export function fromPath(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    return typeof state.from === 'string' ? state.from : null;
  }
  return null;
}
