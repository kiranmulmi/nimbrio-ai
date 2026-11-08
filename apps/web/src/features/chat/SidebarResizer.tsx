import { useEffect, useState } from 'react';

const KEY_STEP = 24;

/** The drag handle on the chats sidebar's right edge. Arrow keys resize too; double-click resets. */
export function SidebarResizer({
  width,
  onResize,
  onReset,
}: {
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;
    document.body.classList.add('is-resizing');
    return () => document.body.classList.remove('is-resizing');
  }, [isDragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        if (isDragging) onResize(event.clientX);
      }}
      onPointerUp={() => setIsDragging(false)}
      onPointerCancel={() => setIsDragging(false)}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onResize(width + KEY_STEP);
        else if (event.key === 'ArrowLeft') onResize(width - KEY_STEP);
        else return;
        event.preventDefault();
      }}
      className="group absolute -right-1 bottom-0 top-0 z-[5] hidden w-2 cursor-col-resize touch-none outline-none xl:block"
    >
      <span
        className={`absolute bottom-0 left-[3px] top-0 w-0.5 transition-colors group-hover:bg-accent group-focus-visible:bg-accent ${
          isDragging ? 'bg-accent' : ''
        }`}
      />
    </div>
  );
}
