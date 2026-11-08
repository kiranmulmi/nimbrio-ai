import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type Crumb = { label: string; to?: string };

export type PageHeaderState = {
  title: string;
  subtitle?: string;
  breadcrumbs: Crumb[];
};

type ContextValue = {
  header: PageHeaderState | null;
  setHeader: (header: PageHeaderState | null) => void;
  actionsNode: HTMLDivElement | null;
  setActionsNode: (node: HTMLDivElement | null) => void;
  /** the popup's footer bar, where a form's buttons go when it opens in the settings popup */
  footerNode: HTMLDivElement | null;
  setFooterNode: (node: HTMLDivElement | null) => void;
};

const PageHeaderContext = createContext<ContextValue | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState | null>(null);
  const [actionsNode, setActionsNode] = useState<HTMLDivElement | null>(null);
  const [footerNode, setFooterNode] = useState<HTMLDivElement | null>(null);

  const value = useMemo(
    () => ({ header, setHeader, actionsNode, setActionsNode, footerNode, setFooterNode }),
    [header, actionsNode, footerNode],
  );

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

function usePageHeaderContext(): ContextValue {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error('PageHeader hooks must be used within PageHeaderProvider');
  return ctx;
}

export function useTopbarSlotRef() {
  const { setActionsNode } = usePageHeaderContext();
  return setActionsNode;
}

export function useFooterSlotRef() {
  return usePageHeaderContext().setFooterNode;
}

export function useHeaderState(): PageHeaderState | null {
  return usePageHeaderContext().header;
}

export function useTopbarActionsNode(): HTMLDivElement | null {
  return usePageHeaderContext().actionsNode;
}

export function usePageHeader(state: PageHeaderState): void {
  const { setHeader } = usePageHeaderContext();
  // Serialising gives the effect a value-equal dependency, so callers can pass a
  // fresh object (and inline breadcrumbs) on every render without re-firing it.
  const serialized = JSON.stringify(state);

  useEffect(() => {
    setHeader(JSON.parse(serialized) as PageHeaderState);
    return () => setHeader(null);
  }, [serialized, setHeader]);
}

export function TopbarActions({ children }: { children: ReactNode }) {
  const node = useTopbarActionsNode();
  if (!node) return null;
  return createPortal(children, node);
}

/**
 * A form's Cancel / Save buttons: in the settings popup's footer bar, or in the top bar when
 * the form is a full page.
 */
export function FormActions({ children }: { children: ReactNode }) {
  const { footerNode, actionsNode } = usePageHeaderContext();
  const node = footerNode ?? actionsNode;
  if (!node) return null;
  return createPortal(children, node);
}
