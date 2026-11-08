import { useEffect, useRef, type ReactNode } from 'react';

export interface RowMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  isDanger?: boolean;
}

/**
 * A file or folder row's menu (its ⋯ button or a right-click): opens under the row, closes on
 * a pick, an outside click or Escape.
 */
export function RowMenu({ items, onClose }: { items: RowMenuItem[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={menu}
      role="menu"
      className="absolute right-1.5 top-full z-20 mt-0.5 w-44 rounded-xl border border-line bg-surface py-1 shadow-float"
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
}
