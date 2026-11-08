import { useCallback, useLayoutEffect, useRef } from 'react';

/** How close to the end (px) scrolling down has to come to follow new content again. */
const NEAR_BOTTOM = 48;

/**
 * Keeps a scrolling log pinned to its end while new content arrives, unless the reader
 * has scrolled up. A new `resetKey` (another chat) pins it again.
 *
 * Any move up lets go at once, however small: judging only by the distance from the end, one
 * wheel tick (about 100px) still counted as "at the end" and the next streamed text pulled the
 * reader back down, so they could never scroll up while a reply streamed.
 */
export function useStickToBottom<T extends HTMLElement>(content: unknown, resetKey: unknown) {
  const ref = useRef<T>(null);
  const isPinned = useRef(true);
  const lastTop = useRef(0);

  useLayoutEffect(() => {
    isPinned.current = true;
  }, [resetKey]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !isPinned.current) return;
    node.scrollTop = node.scrollHeight;
    lastTop.current = node.scrollTop;
  }, [content, resetKey]);

  // The wheel says "up" before the log has moved, even when it's already at the very end.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) isPinned.current = false;
    };
    node.addEventListener('wheel', onWheel, { passive: true });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onScroll = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const top = node.scrollTop;
    const fromEnd = node.scrollHeight - top - node.clientHeight;
    if (top < lastTop.current - 1) {
      // The reader moved up (wheel, keys, scrollbar, touch). Still at the very end means the
      // content got shorter and the browser moved it, not the reader.
      if (fromEnd > 1) isPinned.current = false;
    } else if (fromEnd < NEAR_BOTTOM) {
      isPinned.current = true; // back at the end: follow new content again
    }
    lastTop.current = top;
  }, []);

  /** Pins the log again, e.g. right after the user sends a message. */
  const pin = useCallback(() => {
    isPinned.current = true;
  }, []);

  return { ref, onScroll, pin };
}
