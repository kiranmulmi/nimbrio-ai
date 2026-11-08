import { useEffect, useState } from 'react';

/**
 * Whether this browser tab is showing, kept up to date. Polls pause while it's hidden, so a
 * tab left open in the background stops calling the API, and catch up once it's shown again.
 */
export function usePageVisible(): boolean {
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const update = () => setIsVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return isVisible;
}
