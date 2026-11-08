import { Navigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { errorMessage } from '../../lib/api';
import { useWorkspaces } from './useWorkspaces';

/** `/`: opens the first workspace, or the create form when there are none yet. */
export function RootRedirect() {
  const { data, error, isLoading, reload } = useWorkspaces();

  if (data) {
    const [first] = data;
    return <Navigate to={first ? `/workspaces/${first.id}` : '/workspaces/new'} replace />;
  }

  if (isLoading) return <PageLoader label="Loading workspaces…" />;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p role="alert" className="text-[13px] text-danger">
        {errorMessage(error, "Couldn't load the workspaces.")}
      </p>
      <Button onClick={reload}>Try again</Button>
    </div>
  );
}
