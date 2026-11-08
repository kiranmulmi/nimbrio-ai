// Installing the web app (a Chrome "app" window with its own icon). Chrome fires
// `beforeinstallprompt` once the app qualifies (manifest, icons, some use of the page); it is
// kept here so the app can offer its own Install button, not only the address-bar icon.
import { useCallback, useSyncExternalStore } from 'react';

/** Chrome's event (not in the DOM typings: it isn't a web standard). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const canInstallNow = () => offer !== null;

/** Started once, before the app renders, so an early offer isn't missed. */
export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // no mini-infobar: the app shows its own button
    offer = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    notify();
  });
}

/** Whether Chrome lets this page be installed now, and the action that asks the user. */
export function useInstallApp(): { canInstall: boolean; install: () => Promise<boolean> } {
  const canInstall = useSyncExternalStore(subscribe, canInstallNow, () => false);
  const install = useCallback(async () => {
    const pending = offer;
    if (!pending) return false;
    offer = null; // an offer can be used once
    notify();
    await pending.prompt();
    const { outcome } = await pending.userChoice;
    return outcome === 'accepted';
  }, []);
  return { canInstall, install };
}
