import { useCallback, useState } from 'react';
import type { FileContent, FileEntryKind, FileSearchMode, WorkspaceFiles } from '@app/shared';
import { ConfirmDeleteDialog } from '../../../components/ConfirmDeleteDialog';
import { IconButton } from '../../../components/IconButton';
import { Spinner } from '../../../components/Spinner';
import { errorMessage } from '../../../lib/api';
import {
  CrossIcon,
  DotsVerticalIcon,
  FilePlusIcon,
  FolderPlusIcon,
  RefreshIcon,
  SearchIcon,
} from '../../../lib/icons';
import { useToast } from '../../../lib/toast';
import type { AsyncResource } from '../../../lib/useAsync';
import { PanelMessage } from '../PanelMessage';
import { createEntry, deleteEntry, fetchFileContent, renameEntry, saveFile } from './api';
import { FilePreview } from './FilePreview';
import { FileSearchResults } from './FileSearchResults';
import { FileTree } from './FileTree';
import { RowMenu } from './RowMenu';
import { useFileSearch } from './useFileSearch';

const MODES: { id: FileSearchMode; label: string; hint: string }[] = [
  { id: 'names', label: 'Name', hint: 'Find files by name or path' },
  { id: 'contents', label: 'Content', hint: 'Find text inside the files' },
];

type Preview = { file: FileContent; query?: string; line?: number; isEditing?: boolean };

/**
 * The Files tab: the files in the workspace's folder, with a search by file name or by
 * text inside the files. Click a file (or a matching line) to preview it, and edit it there.
 * New files and folders come from the toolbar (top level) or a folder's row (inside it).
 */
export function FilesPanel({
  workspaceId,
  files,
}: {
  workspaceId: string;
  files: AsyncResource<WorkspaceFiles>;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FileSearchMode>('names');
  // The toolbar's ⋯ menu: a new file or folder at the top of the workspace.
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const closeAddMenu = useCallback(() => setIsAddMenuOpen(false), []);
  const [refreshKey, setRefreshKey] = useState(0);
  const search = useFileSearch(workspaceId, query, mode, refreshKey);
  const isSearching = query.trim() !== '';
  const [creating, setCreating] = useState<{ parent: string; kind: FileEntryKind } | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    path: string;
    kind: FileEntryKind;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const open = async (filePath: string, line?: number, isEditing = false) => {
    setOpening(filePath);
    try {
      const file = await fetchFileContent(workspaceId, filePath);
      setPreview(line === undefined ? { file, isEditing } : { file, query: query.trim(), line });
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't open the file."), 'error');
    } finally {
      setOpening(null);
    }
  };

  const closePreview = useCallback(() => setPreview(null), []);
  const previewPath = preview?.file.path;
  const savePreview = useCallback(
    async (content: string, baseVersion?: string) => {
      if (!previewPath) throw new Error('No file is open.');
      const saved = await saveFile(workspaceId, { path: previewPath, content, baseVersion });
      toast(`Saved ${previewPath}`);
      return saved;
    },
    [workspaceId, previewPath, toast],
  );
  const reloadPreview = useCallback(() => {
    if (!previewPath) return Promise.reject(new Error('No file is open.'));
    return fetchFileContent(workspaceId, previewPath);
  }, [workspaceId, previewPath]);

  /** Rejects on failure, so the name box stays open; the reason is a toast. */
  const rename = async (from: string, newName: string) => {
    const slash = from.lastIndexOf('/');
    const to = slash >= 0 ? `${from.slice(0, slash)}/${newName}` : newName;
    try {
      const entry = await renameEntry(workspaceId, { from, to });
      toast(`Renamed to ${entry.path}`);
      setReveal(entry.path);
      refresh();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't rename it."), 'error');
      throw cause;
    }
  };

  const cancelDelete = useCallback(() => setPendingDelete(null), []);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteEntry(workspaceId, pendingDelete.path);
      toast(`Deleted ${pendingDelete.path}`);
      setPendingDelete(null);
      refresh();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete it."), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelCreate = useCallback(() => setCreating(null), []);
  const startCreating = (parent: string, kind: FileEntryKind) => {
    setQuery('');
    setCreating({ parent, kind });
  };
  /** Rejects on failure, so the name box stays open; the reason is a toast. */
  const create = async (name: string) => {
    if (!creating) return;
    const { parent, kind } = creating;
    let entry;
    try {
      entry = await createEntry(workspaceId, {
        path: parent ? `${parent}/${name.replace(/^\.\/+/, '')}` : name.replace(/^\.\/+/, ''),
        kind,
      });
    } catch (cause) {
      toast(errorMessage(cause, `Couldn't create the ${kind}.`), 'error');
      throw cause;
    }
    toast(`Created ${entry.path}`);
    setCreating(null);
    setReveal(entry.path);
    files.reload();
    if (kind === 'file') void open(entry.path, undefined, true);
  };
  const refresh = () => {
    files.reload();
    setRefreshKey((key) => key + 1);
  };

  return (
    <>
      <div className="min-h-full">
        <div className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-line-2 bg-surface px-2.5 py-2">
          {/* One field: the search, its clear button, and what to search (names or contents). */}
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg border border-line bg-surface pl-2.5 pr-0.5 transition-colors hover:border-line-strong focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
            <SearchIcon size={13} className="pointer-events-none shrink-0 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault();
                  setQuery('');
                }
              }}
              placeholder={mode === 'names' ? 'Search file names' : 'Search in files'}
              aria-label={mode === 'names' ? 'Search file names' : 'Search text in files'}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent pl-1 text-[12.5px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear the search"
                title="Clear the search"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                {search.isSearching ? <Spinner size={10} /> : <CrossIcon size={9} />}
              </button>
            )}
            <div
              role="radiogroup"
              aria-label="Search by"
              className="flex h-6 shrink-0 items-center rounded-md bg-subtle p-0.5"
            >
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === item.id}
                  title={item.hint}
                  onClick={() => setMode(item.id)}
                  className={`h-full rounded px-1.5 text-[11.5px] font-medium transition-colors ${
                    mode === item.id
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(16_38_63/0.12)] ring-1 ring-line'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <IconButton
            onClick={refresh}
            disabled={files.isLoading}
            aria-label="Refresh"
            title={files.data ? `Refresh · ${files.data.path}` : 'Refresh'}
          >
            {files.isLoading ? <Spinner size={12} /> : <RefreshIcon />}
          </IconButton>
          <div className="relative shrink-0">
            <IconButton
              onClick={() => setIsAddMenuOpen((open) => !open)}
              aria-label="New file or folder"
              aria-haspopup="menu"
              aria-expanded={isAddMenuOpen}
              title="New file, new folder"
            >
              <DotsVerticalIcon />
            </IconButton>
            {isAddMenuOpen && (
              <RowMenu
                items={[
                  {
                    label: 'New file',
                    icon: <FilePlusIcon size={13} />,
                    onSelect: () => startCreating('', 'file'),
                  },
                  {
                    label: 'New folder',
                    icon: <FolderPlusIcon size={13} />,
                    onSelect: () => startCreating('', 'folder'),
                  },
                ]}
                onClose={closeAddMenu}
              />
            )}
          </div>
        </div>

        {isSearching ? (
          <FileSearchResults
            result={search.result}
            query={query.trim()}
            isSearching={search.isSearching}
            error={search.error}
            opening={opening}
            onOpen={(filePath, line) => void open(filePath, line)}
          />
        ) : !files.data ? (
          <div className="p-4">
            <PanelMessage isLoading={files.isLoading} error={files.error} onRetry={files.reload} />
          </div>
        ) : files.data.files.length === 0 && files.data.emptyFolders.length === 0 && !creating ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-3">
            No files yet. Create one with the buttons above, or ask the agent.
          </p>
        ) : (
          <div className="px-2 py-1.5">
            <FileTree
              root={files.data.path}
              paths={files.data.files}
              emptyFolders={files.data.emptyFolders}
              ignored={files.data.ignored}
              opening={opening}
              reveal={reveal}
              onOpen={(filePath) => void open(filePath)}
              onCreateIn={startCreating}
              onRename={rename}
              creating={creating}
              onCreate={create}
              onCancelCreate={cancelCreate}
              onDelete={(path, kind) => setPendingDelete({ path, kind })}
            />
          </div>
        )}
        {!isSearching && files.data?.isTruncated && (
          <p className="px-4 pb-3 pt-1 text-[12px] text-ink-3">
            Showing the first {files.data.files.length} files. Generated folders such as
            node_modules are left out.
          </p>
        )}
      </div>

      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'folder' ? 'Delete this folder?' : 'Delete this file?'}
        message={
          <>
            <code className="font-mono text-[12px] text-ink">{pendingDelete?.path}</code>
            {pendingDelete?.kind === 'folder' ? ' and everything inside it' : ''} will be deleted
            from the workspace folder. This can&apos;t be undone here.
          </>
        }
        busy={isDeleting}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />

      {preview && (
        <FilePreview
          key={preview.file.path}
          file={preview.file}
          startEditing={preview.isEditing}
          initialQuery={preview.query}
          initialLine={preview.line}
          onClose={closePreview}
          onSave={savePreview}
          onReload={reloadPreview}
        />
      )}
    </>
  );
}
