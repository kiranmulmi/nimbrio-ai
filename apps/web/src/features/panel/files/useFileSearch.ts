import { useEffect, useState } from 'react';
import type { FileSearchMode, FileSearchResult } from '@app/shared';
import { errorMessage } from '../../../lib/api';
import { searchFiles } from './api';

const DELAY_MS = 250;

export interface FileSearchState {
  result: FileSearchResult | null;
  isSearching: boolean;
  error: string | null;
}

/**
 * Searches the workspace as the user types (after a short pause). Only the latest search's
 * answer is kept, so a slow earlier one can't replace it. `refreshKey` searches again.
 */
export function useFileSearch(
  workspaceId: string,
  query: string,
  mode: FileSearchMode,
  refreshKey: number,
): FileSearchState {
  const [state, setState] = useState<FileSearchState>({
    result: null,
    isSearching: false,
    error: null,
  });
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setState({ result: null, isSearching: false, error: null });
      return;
    }
    let isCurrent = true;
    setState((current) => ({ ...current, isSearching: true, error: null }));
    const timer = window.setTimeout(() => {
      searchFiles(workspaceId, trimmed, mode)
        .then((result) => {
          if (isCurrent) setState({ result, isSearching: false, error: null });
        })
        .catch((cause: unknown) => {
          if (isCurrent) {
            setState({
              result: null,
              isSearching: false,
              error: errorMessage(cause, "Couldn't search the files."),
            });
          }
        });
    }, DELAY_MS);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [workspaceId, trimmed, mode, refreshKey]);

  return state;
}
