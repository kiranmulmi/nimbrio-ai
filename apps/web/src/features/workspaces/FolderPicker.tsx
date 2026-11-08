import { useEffect, useState } from 'react';
import type { FolderListing } from '@app/shared';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { ArrowLeftIcon, FolderIcon } from '../../lib/icons';
import { fetchFolders } from './api';

/**
 * Walks this machine's folders through the local API, one level at a time.
 * A browser can't hand a page the absolute path of a folder, so this stands in
 * for a native folder dialog.
 */
export function FolderPicker({
  startAt,
  onPick,
  onClose,
}: {
  /** opens here when it exists, otherwise at the home folder */
  startAt: string;
  onPick: (folderPath: string) => void;
  onClose: () => void;
}) {
  const [requested, setRequested] = useState(startAt);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    fetchFolders(requested)
      .then((next) => {
        if (!isCurrent) return;
        setListing(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        // A typed path that doesn't exist yet: start from home instead of a dead end.
        if (requested && requested === startAt) setRequested('');
        else setError(errorMessage(cause, "Couldn't open that folder."));
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [requested, startAt]);

  const open = (folderPath: string) => setRequested(folderPath);
  const join = (parent: string, name: string) =>
    `${parent.replace(/[\\/]+$/, '')}${parent.includes('\\') ? '\\' : '/'}${name}`;

  return (
    <Modal title="Choose the workspace folder" onClose={onClose}>
      <div className="flex flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Button
            size="sm"
            onClick={() => listing?.parent && open(listing.parent)}
            disabled={!listing?.parent || isLoading}
            aria-label="Up one folder"
          >
            <ArrowLeftIcon size={12} /> Up
          </Button>
          <Button size="sm" onClick={() => listing && open(listing.home)} disabled={isLoading}>
            Home
          </Button>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2"
            title={listing?.path}
          >
            {listing?.path ?? ''}
          </span>
          {isLoading && <Spinner size={13} label="Loading folders" />}
        </div>

        <div className="max-h-[50vh] min-h-[200px] overflow-auto px-2 py-2">
          {error ? (
            <p role="alert" className="px-2 py-3 text-[13px] text-danger">
              {error}
            </p>
          ) : listing && listing.folders.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-ink-3">No folders inside this one.</p>
          ) : (
            <ul className="flex flex-col">
              {listing?.folders.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => open(join(listing.path, name))}
                    disabled={isLoading}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-subtle disabled:cursor-wait"
                  >
                    <FolderIcon className="shrink-0 text-ink-3" />
                    <span className="min-w-0 truncate">{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-4 py-3">
          <span className="mr-auto text-[13px] text-ink-3">
            The agent can read and change everything in this folder.
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => listing && onPick(listing.path)}
            disabled={!listing || isLoading}
          >
            Use this folder
          </Button>
        </div>
      </div>
    </Modal>
  );
}
