// A model was added, edited, deleted or made the default, possibly in the Settings popup over
// a chat screen that stays mounted underneath (SettingsModal): every model list loads again,
// so the composer's model picker shows the change without a page refresh.
const EVENT = 'agent:models-changed';

export function announceModelsChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `onChanged` whenever the saved models change. Returns the unsubscribe function. */
export function onModelsChanged(onChanged: () => void): () => void {
  window.addEventListener(EVENT, onChanged);
  return () => window.removeEventListener(EVENT, onChanged);
}
