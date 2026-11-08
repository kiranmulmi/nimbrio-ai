import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '../lib/icons';
import { useHeaderState, useTopbarSlotRef } from './pageHeader';

/**
 * The heading of a form page: breadcrumb trail, title, and the page's actions. `inModal`: the
 * popup's own header shows the title, so only the subtitle and the actions are left here.
 */
export function Topbar({ inModal = false }: { inModal?: boolean }) {
  const header = useHeaderState();
  const setActionsNode = useTopbarSlotRef();

  const actionsRef = useCallback(
    (node: HTMLDivElement | null) => setActionsNode(node),
    [setActionsNode],
  );

  if (inModal) {
    return (
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-4">
        <p className="min-w-0 flex-1 basis-60 text-[13px] text-ink-3">{header?.subtitle}</p>
        <div ref={actionsRef} className="flex shrink-0 flex-wrap items-center gap-2" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[64px] flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-5">
      {header && (
        <div className="min-w-0 flex-1 basis-60">
          {header.breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-1.5">
              <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
                {header.breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === header.breadcrumbs.length - 1;
                  return (
                    <li
                      key={`${crumb.label}-${idx}`}
                      // The page you are on stays readable; the trail above it gives way first.
                      className={`flex min-w-0 items-center gap-1.5 ${isLast ? 'shrink-0' : ''}`}
                    >
                      {crumb.to && !isLast ? (
                        <Link
                          to={crumb.to}
                          className="truncate text-ink-3 transition-colors hover:text-ink"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span
                          aria-current={isLast ? 'page' : undefined}
                          className="truncate font-medium text-ink"
                        >
                          {crumb.label}
                        </span>
                      )}
                      {!isLast && <ChevronRightIcon size={11} className="shrink-0 text-ink-4" />}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          <h1 className="truncate text-[26px] font-extrabold leading-tight text-ink">
            {header.title}
          </h1>
          {header.subtitle && <p className="mt-1 text-[13.5px] text-ink-3">{header.subtitle}</p>}
        </div>
      )}
      <div ref={actionsRef} className="flex shrink-0 flex-wrap items-center gap-2" />
    </div>
  );
}
