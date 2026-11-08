import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntryKind } from '@app/shared';
import { absolutePath, startPathDrag } from '../../../lib/dragPath';
import { Spinner } from '../../../components/Spinner';
import {
  ChevronRightIcon,
  DotsIcon,
  EditIcon,
  FilePlusIcon,
  FileTintIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderTintIcon,
  TrashIcon,
} from '../../../lib/icons';
import { NameInput } from './NameInput';
import { RowMenu, type RowMenuItem } from '../../../components/RowMenu';
import { fileTint } from './fileTint';

interface FileNode {
  name: string;
  path: string;
}

interface FolderNode extends FileNode {
  folders: FolderNode[];
  files: FileNode[];
}

/** Up to this many files, every folder starts open; above it, they start closed. */
const OPEN_ALL_UP_TO = 40;
const INDENT_PX = 14;

/**
 * Nest "/"-separated file paths into folders, folders first, each sorted by name. Empty
 * folders have no file to bring them in, so they come as their own list.
 */
/**
 * Whether git ignores a path: listed itself, or inside a folder git ignores as a whole
 * (`ignored` lists such folders with a trailing "/").
 */
function ignoredTest(ignored: readonly string[]): (path: string) => boolean {
  const set = new Set(ignored);
  return (path) => {
    if (set.has(path)) return true;
    const parts = path.split('/');
    for (let end = parts.length; end > 0; end -= 1) {
      if (set.has(`${parts.slice(0, end).join('/')}/`)) return true;
    }
    return false;
  };
}

/** Rows git ignores look faded, as in VS Code. */
const IGNORED_ROW = 'opacity-50';

function buildTree(paths: readonly string[], emptyFolders: readonly string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], files: [] };
  const folderAt = new Map<string, FolderNode>([['', root]]);
  const folderFor = (parts: readonly string[]) => {
    let parent = root;
    for (const part of parts) {
      const folderPath = parent.path ? `${parent.path}/${part}` : part;
      let folder = folderAt.get(folderPath);
      if (!folder) {
        folder = { name: part, path: folderPath, folders: [], files: [] };
        folderAt.set(folderPath, folder);
        parent.folders.push(folder);
      }
      parent = folder;
    }
    return parent;
  };
  for (const filePath of paths) {
    const parts = filePath.split('/');
    const fileName = parts.pop() ?? filePath;
    folderFor(parts).files.push({ name: fileName, path: filePath });
  }
  for (const folderPath of emptyFolders) folderFor(folderPath.split('/'));
  const byName = (a: FileNode, b: FileNode) => a.name.localeCompare(b.name);
  for (const folder of folderAt.values()) {
    folder.folders.sort(byName);
    folder.files.sort(byName);
  }
  return root;
}

/** A folder whose only content is one folder shows as one row: "src/main/java". */
function compact(folder: FolderNode): FolderNode {
  let current = folder;
  let name = folder.name;
  while (current.files.length === 0 && current.folders.length === 1 && current.folders[0]) {
    current = current.folders[0];
    name = `${name}/${current.name}`;
  }
  return { ...current, name };
}

function allFolderPaths(folder: FolderNode, into: string[] = []): string[] {
  for (const child of folder.folders) {
    into.push(compact(child).path);
    allFolderPaths(compact(child), into);
  }
  return into;
}

/** Every folder above `path` (and `path` itself), so it can be opened down to there. */
function withParents(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** The ⋯ button at a row's right end: shown on hover, on focus, and while its menu is open. */
const MENU_BUTTON =
  'absolute right-1.5 top-[2px] grid h-[18px] w-[18px] place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink';

/**
 * The workspace's files as a folder tree. Folders toggle; files open a preview. Any row can
 * be dragged onto the message box to insert its absolute path. Each row's ⋯ menu (or a
 * right-click) renames or deletes it, and a folder's adds a new file or folder inside.
 */
export function FileTree({
  root,
  paths,
  emptyFolders,
  ignored,
  opening,
  reveal,
  onOpen,
  onCreateIn,
  onRename,
  onDelete,
  creating,
  onCreate,
  onCancelCreate,
}: {
  /** the workspace folder, so dragged rows carry absolute paths */
  root: string;
  paths: readonly string[];
  emptyFolders: readonly string[];
  /** what git ignores (`WorkspaceFiles.ignored`): those rows are dimmed */
  ignored: readonly string[];
  /** the file being loaded for preview, if any */
  opening: string | null;
  /** a path just created or renamed: its folders open so it can be seen */
  reveal: string | null;
  onOpen: (filePath: string) => void;
  onCreateIn: (folderPath: string, kind: FileEntryKind) => void;
  /** rejects when it couldn't be renamed (the name box stays open) */
  onRename: (path: string, newName: string) => Promise<void>;
  onDelete: (path: string, kind: FileEntryKind) => void;
  /** a new file or folder being named: its box shows inside `parent` ('' for the top) */
  creating: { parent: string; kind: FileEntryKind } | null;
  /** rejects when it couldn't be created (the name box stays open) */
  onCreate: (name: string) => Promise<void>;
  onCancelCreate: () => void;
}) {
  const tree = useMemo(() => buildTree(paths, emptyFolders), [paths, emptyFolders]);
  const isIgnored = useMemo(() => ignoredTest(ignored), [ignored]);
  // null until the user toggles a folder: then small trees start open, large ones closed.
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string> | null>(null);
  const shown = useMemo(
    () => openFolders ?? new Set(paths.length <= OPEN_ALL_UP_TO ? allFolderPaths(tree) : []),
    [openFolders, paths.length, tree],
  );
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);

  // Open the folders down to a new or renamed file or folder, once per path.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return;
    revealed.current = reveal;
    setOpenFolders(new Set([...shown, ...withParents(reveal)]));
  }, [reveal, shown]);

  // The folder a new file or folder goes in opens, so its name box shows there.
  const createIn = creating?.parent ?? null;
  useEffect(() => {
    if (!createIn) return;
    const needed = withParents(createIn).filter((folder) => !shown.has(folder));
    if (needed.length) setOpenFolders(new Set([...shown, ...needed]));
  }, [createIn, shown]);

  const toggle = (folderPath: string) => {
    const next = new Set(shown);
    if (next.has(folderPath)) next.delete(folderPath);
    else next.add(folderPath);
    setOpenFolders(next);
  };

  const menuItems = (path: string, kind: FileEntryKind): RowMenuItem[] => [
    ...(kind === 'folder'
      ? [
          {
            label: 'New file',
            icon: <FilePlusIcon size={13} />,
            onSelect: () => onCreateIn(path, 'file'),
          },
          {
            label: 'New folder',
            icon: <FolderPlusIcon size={13} />,
            onSelect: () => onCreateIn(path, 'folder'),
          },
        ]
      : []),
    { label: 'Rename', icon: <EditIcon size={13} />, onSelect: () => setRenaming(path) },
    {
      label: 'Delete',
      icon: <TrashIcon size={13} />,
      onSelect: () => onDelete(path, kind),
      isDanger: true,
    },
  ];

  /** The ⋯ button and, when open, the menu: shared by file and folder rows. */
  const rowMenu = (path: string, kind: FileEntryKind) => (
    <>
      <button
        type="button"
        onClick={() => setMenuFor(menuFor === path ? null : path)}
        aria-label={`More for ${path}`}
        aria-haspopup="menu"
        aria-expanded={menuFor === path}
        title="Rename, delete…"
        className={`${MENU_BUTTON} ${
          menuFor === path
            ? 'bg-surface text-ink'
            : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'
        }`}
      >
        <DotsIcon size={13} />
      </button>
      {menuFor === path && <RowMenu items={menuItems(path, kind)} onClose={closeMenu} />}
    </>
  );

  const rename = (path: string) => async (newName: string) => {
    await onRename(path, newName);
    setRenaming(null);
  };
  const lastPart = (path: string) => path.slice(path.lastIndexOf('/') + 1);

  /** The name box for a new file or folder, first in the folder it goes in. */
  const newEntry = (folderPath: string, depth: number) =>
    creating && creating.parent === folderPath ? (
      <li>
        <NameInput
          name=""
          label={`New ${creating.kind} name${folderPath ? ` in ${folderPath}` : ''}`}
          placeholder={creating.kind === 'file' ? 'name.ts' : 'folder-name'}
          isFile={creating.kind === 'file'}
          icon={
            creating.kind === 'file' ? (
              <FilePlusIcon size={14} className="shrink-0 text-accent-2" />
            ) : (
              <FolderPlusIcon size={14} className="shrink-0 text-ft-folder" />
            )
          }
          paddingLeft={10 + depth * INDENT_PX + 17}
          onSubmit={onCreate}
          onCancel={onCancelCreate}
        />
      </li>
    ) : null;

  const renderFolder = (folder: FolderNode, depth: number) => (
    <>
      {newEntry(folder.path, depth)}
      {folder.folders.map((child) => {
        const row = compact(child);
        const isOpen = shown.has(row.path);
        const folderIcon = isOpen ? (
          <FolderOpenIcon size={14} className="shrink-0 text-ft-folder" />
        ) : (
          <FolderTintIcon size={14} className="shrink-0 text-ft-folder" />
        );
        return (
          <li key={row.path}>
            {renaming === row.path ? (
              <NameInput
                name={lastPart(row.path)}
                label={`New name for ${row.path}`}
                isFile={false}
                icon={folderIcon}
                paddingLeft={10 + depth * INDENT_PX + 17}
                onSubmit={rename(row.path)}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <div className="group/row relative">
                <button
                  type="button"
                  onClick={() => toggle(row.path)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuFor(row.path);
                  }}
                  draggable
                  onDragStart={(event) =>
                    startPathDrag(event, absolutePath(root, row.path), 'folder')
                  }
                  aria-expanded={isOpen}
                  title={row.path}
                  style={{ paddingLeft: 10 + depth * INDENT_PX }}
                  className={`flex w-full items-center gap-1.5 py-[2px] pr-7 text-left font-explorer text-[13px] leading-[18px] text-ink transition-colors hover:bg-surface-2 ${
                    isIgnored(row.path) ? IGNORED_ROW : ''
                  }`}
                >
                  <ChevronRightIcon
                    size={11}
                    className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  {folderIcon}
                  <span className="min-w-0 truncate">{row.name}</span>
                </button>
                {rowMenu(row.path, 'folder')}
              </div>
            )}
            {isOpen && (
              <div className="relative">
                <span
                  aria-hidden
                  style={{ left: 15 + depth * INDENT_PX }}
                  className="absolute bottom-1 top-0 w-px bg-line-2"
                />
                <ul>{renderFolder(row, depth + 1)}</ul>
              </div>
            )}
          </li>
        );
      })}
      {folder.files.map((file) => {
        const tint = fileTint(file.name);
        const fileIcon = <FileTintIcon size={14} className={`shrink-0 ${tint.icon}`} />;
        // Files line up with folder names: past the chevron's width.
        const paddingLeft = 10 + depth * INDENT_PX + 17;
        return (
          <li key={file.path}>
            {renaming === file.path ? (
              <NameInput
                name={file.name}
                label={`New name for ${file.path}`}
                isFile
                icon={fileIcon}
                paddingLeft={paddingLeft}
                onSubmit={rename(file.path)}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <div className="group/row relative">
                <button
                  type="button"
                  onClick={() => onOpen(file.path)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuFor(file.path);
                  }}
                  draggable
                  onDragStart={(event) =>
                    startPathDrag(event, absolutePath(root, file.path), 'file')
                  }
                  disabled={opening !== null}
                  title={file.path}
                  style={{ paddingLeft }}
                  className={`flex w-full items-center gap-1.5 py-[2px] pr-7 text-left font-explorer text-[13px] leading-[18px] transition-colors hover:bg-accent-soft hover:text-accent-2 disabled:cursor-wait ${
                    tint.isMuted ? 'text-ink-3' : 'text-ink-2'
                  } ${isIgnored(file.path) ? IGNORED_ROW : ''}`}
                >
                  {opening === file.path ? <Spinner size={13} /> : fileIcon}
                  <span className="min-w-0 truncate">{file.name}</span>
                </button>
                {rowMenu(file.path, 'file')}
              </div>
            )}
          </li>
        );
      })}
    </>
  );

  return <ul className="flex flex-col">{renderFolder(tree, 0)}</ul>;
}
