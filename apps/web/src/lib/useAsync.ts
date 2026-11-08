import { useCallback, useEffect, useRef, useState } from 'react';

type AsyncState<T> = {
  data: T | null;
  error: unknown;
  isLoading: boolean;
};

export type AsyncResource<T> = AsyncState<T> & {
  /** Loads again, keeping the current data on screen meanwhile. */
  reload: () => void;
  /** Replaces the data locally, e.g. with what a write returned. */
  setData: (update: (current: T | null) => T | null) => void;
};

/**
 * Runs `load` and keeps its result. Pass a `useCallback`-wrapped loader: a new loader
 * (for another id, say) clears the old data and loads again.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncResource<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, isLoading: true });
  const [token, setToken] = useState(0);
  const lastLoad = useRef(load);

  useEffect(() => {
    let isCurrent = true;
    const isNewSource = lastLoad.current !== load;
    lastLoad.current = load;
    setState((current) => ({
      data: isNewSource ? null : current.data,
      error: null,
      isLoading: true,
    }));
    load()
      .then((data) => {
        if (isCurrent) setState({ data, error: null, isLoading: false });
      })
      .catch((error: unknown) => {
        if (isCurrent) setState((current) => ({ ...current, error, isLoading: false }));
      });
    return () => {
      isCurrent = false;
    };
  }, [load, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);
  const setData = useCallback(
    (update: (current: T | null) => T | null) =>
      setState((current) => ({ ...current, data: update(current.data) })),
    [],
  );

  return { ...state, reload, setData };
}
