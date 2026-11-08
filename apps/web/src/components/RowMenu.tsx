import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface RowMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  isDanger?: boolean;
}

/** Space kept between the menu and its button, and from the window's edges. */
const GAP = 4;
const EDGE = 8;

const MENU = 'z-[75] w-44 rounded-xl border border-line bg-surface py-1 shadow-float';

/**
 * A row's action menu: closes on a pick, an outside click or Escape. Without `anchor` it opens
 * under the row's right end (the row is `relative`), as the file tree's ⋯ and right-click do.
 * With `anchor` (the ⋮ button that opened it) it's drawn over the page next to that button,
 * under it or above it when there's no room below, so a scrolling popup can't clip it.
 */
export function RowMenu({
  items,
  onClose,
  anchor = null,
}: {
  items: RowMenuItem[];
  onClose: () => void;
  anchor?: HTMLElement | null;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    const fitsBelow = box.bottom + GAP + height <= window.innerHeight - EDGE;
    setPlace({
      top: fitsBelow ? box.bottom + GAP : Math.max(EDGE, box.top - GAP - height),
      right: Math.max(EDGE, window.innerWidth - box.right),
    });
    // It stays where it opened, so moving the page closes it.
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); // not the panel or a dialog behind it
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    menu.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const list = (
    <div
      ref={menu}
      role="menu"
      style={anchor ? place : undefined}
      className={`${MENU} ${anchor ? 'fixed' : 'absolute right-1.5 top-full mt-0.5'}`}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors focus:outline-none ${
            item.isDanger
              ? 'text-danger hover:bg-danger-bg focus:bg-danger-bg'
              : 'text-ink-2 hover:bg-subtle hover:text-ink focus:bg-subtle focus:text-ink'
          }`}
        >
          <span className="grid w-4 shrink-0 place-items-center">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
  // Portalled to <body>: an ancestor that scrolls or is transformed would clip or trap it.
  return anchor ? createPortal(list, document.body) : list;
}
