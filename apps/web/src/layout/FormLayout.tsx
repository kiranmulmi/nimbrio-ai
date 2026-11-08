import { Outlet, useMatch } from 'react-router-dom';
import { useAppInfo } from '../features/chat/useAppInfo';
import { useWorkspaces } from '../features/workspaces/useWorkspaces';
import { AppNav } from './AppNav';
import { PageHeaderProvider } from './pageHeader';
import { Topbar } from './Topbar';

/** Frame for the form pages: the app bar, the page heading (set with `usePageHeader`), the page. */
export function FormLayout() {
  // Settings and MCP pages belong to a workspace; /workspaces/new matches as "new" and finds none.
  const workspaceId = useMatch('/workspaces/:workspaceId/*')?.params.workspaceId;
  const info = useAppInfo();
  const workspaces = useWorkspaces();
  const list = workspaces.data ?? [];
  const workspace = list.find((item) => item.id === workspaceId) ?? null;

  return (
    <PageHeaderProvider>
      <div className="flex h-full flex-col bg-bg">
        <AppNav
          workspace={workspace}
          workspaces={list}
          onOpenWorkspaces={workspaces.reload}
          info={info.data}
          infoError={info.error}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <main className="mx-auto w-full min-w-0 max-w-[960px] px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
            <Topbar />
            <Outlet />
          </main>
        </div>
      </div>
    </PageHeaderProvider>
  );
}
