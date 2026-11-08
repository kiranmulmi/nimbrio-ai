import { useCallback, useEffect, useState } from 'react';
import { readPref, writePref } from '../../lib/storage';

const SIDEBAR_DEFAULT = 264;
const SIDEBAR_MIN = 200;
const WIDTH_KEY = 'agent.sidebarWidth';

const clamp = (px: number, viewport: number) =>
  Math.min(Math.max(SIDEBAR_MIN, Math.round(viewport * 0.4)), Math.max(SIDEBAR_MIN, Math.round(px)));

/** The chats sidebar's width on wide screens: dragged or reset, and remembered. */
export function useSidebarWidth() {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [preferred, setPreferred] = useState(() => Number(readPref(WIDTH_KEY)) || SIDEBAR_DEFAULT);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const width = clamp(preferred, viewport);

  const setWidth = useCallback((px: number) => {
    const next = clamp(px, window.innerWidth);
    setPreferred(next);
    writePref(WIDTH_KEY, String(next));
  }, []);

  const reset = useCallback(() => setWidth(SIDEBAR_DEFAULT), [setWidth]);

  return { width, setWidth, reset };
}
