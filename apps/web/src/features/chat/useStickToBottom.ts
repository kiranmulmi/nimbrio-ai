import { useCallback, useLayoutEffect, useRef } from 'react';

const NEAR_BOTTOM = 160;

/**
 * Keeps a scrolling log pinned to its end while new content arrives, unless the reader
 * has scrolled up. A new `resetKey` (another chat) pins it again.
 */
export function useStickToBottom<T extends HTMLElement>(content: unknown, resetKey: unknown) {
  const ref = useRef<T>(null);
  const isPinned = useRef(true);

  useLayoutEffect(() => {
    isPinned.current = true;
  }, [resetKey]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node && isPinned.current) node.scrollTop = node.scrollHeight;
  }, [content, resetKey]);

  const onScroll = useCallback(() => {
    const node = ref.current;
    if (node)
      isPinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM;
  }, []);

  /** Pins the log again, e.g. right after the user sends a message. */
  const pin = useCallback(() => {
    isPinned.current = true;
  }, []);

  return { ref, onScroll, pin };
}
