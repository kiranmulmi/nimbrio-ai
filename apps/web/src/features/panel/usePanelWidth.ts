import { useCallback, useEffect, useState } from 'react';
import { readPref, writePref } from '../../lib/storage';

const PANEL_DEFAULT = 380;
const PANEL_MIN = 300;
const WIDTH_KEY = 'agent.panelWidth';
const NARROW_KEY = 'agent.panelNarrow';

const clamp = (px: number, viewport: number) =>
  Math.min(Math.max(PANEL_MIN, Math.round(viewport * 0.65)), Math.max(PANEL_MIN, Math.round(px)));

/** The side panel's width on wide screens: dragged, widened or reset, and remembered. */
export function usePanelWidth() {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [preferred, setPreferred] = useState(() => Number(readPref(WIDTH_KEY)) || PANEL_DEFAULT);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const width = clamp(preferred, viewport);
  const isWide = width >= viewport * 0.48;

  const setWidth = useCallback((px: number) => {
    const next = clamp(px, window.innerWidth);
    setPreferred(next);
    writePref(WIDTH_KEY, String(next));
  }, []);

  const reset = useCallback(() => setWidth(PANEL_DEFAULT), [setWidth]);

  /** Widens the panel to about half the screen, or back to the width it had before. */
  const toggleWide = useCallback(() => {
    if (isWide) {
      setWidth(Number(readPref(NARROW_KEY)) || PANEL_DEFAULT);
    } else {
      writePref(NARROW_KEY, String(width));
      setWidth(window.innerWidth * 0.55);
    }
  }, [isWide, width, setWidth]);

  return { width, isWide, setWidth, reset, toggleWide };
}
