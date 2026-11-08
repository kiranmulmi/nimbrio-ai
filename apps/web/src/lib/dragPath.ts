import type { DragEvent } from 'react';

/**
 * Dragging a file or folder from the Files panel carries its absolute path under this type
 * (plus text/plain), so the message box can insert the path instead of attaching a file.
 */
export const PATH_DRAG_TYPE = 'application/x-nimbrio-path';
/** "file" or "folder", alongside the path. */
export const PATH_KIND_DRAG_TYPE = 'application/x-nimbrio-path-kind';

/** The absolute path of `relative` inside the workspace folder `root`. */
export function absolutePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relative}`;
}

export function startPathDrag(
  event: DragEvent<HTMLElement>,
  path: string,
  kind: 'file' | 'folder',
): void {
  event.dataTransfer.setData(PATH_DRAG_TYPE, path);
  event.dataTransfer.setData(PATH_KIND_DRAG_TYPE, kind);
  event.dataTransfer.setData('text/plain', path);
  event.dataTransfer.effectAllowed = 'copy';
}
