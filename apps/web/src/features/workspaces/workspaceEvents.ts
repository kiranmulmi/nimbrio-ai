// A workspace form saved, possibly in a popup over a chat screen that stays mounted
// underneath (SettingsModal): it tells that screen to load the workspace and the list again.
const EVENT = 'agent:workspace-saved';

export function announceWorkspaceSaved(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `onSaved` whenever a workspace form saves. Returns the unsubscribe function. */
export function onWorkspaceSaved(onSaved: () => void): () => void {
  window.addEventListener(EVENT, onSaved);
  return () => window.removeEventListener(EVENT, onSaved);
}
