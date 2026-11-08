import { useCallback, useState } from 'react';
import { readPref, writePref } from './storage';

/** A UI preference that survives a reload. `parse` turns the stored text back into a value. */
export function useStoredState<T>(
  key: string,
  parse: (stored: string | null) => T,
  serialize: (value: T) => string = String,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => parse(readPref(key)));

  const update = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, serialize(next));
    },
    [key, serialize],
  );

  return [value, update];
}
