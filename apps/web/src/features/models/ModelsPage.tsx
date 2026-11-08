import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ModelProfile } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { TopbarActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { PlusIcon, SparkIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { SettingsTabs } from '../settings/SettingsTabs';
import { makeDefaultModel } from './api';
import { serverLabel } from './servers';
import { useModels } from './useModels';
import { APP_NAME } from '../../lib/brand';

const LIST_PATH = '/settings/models';

/**
 * `/settings/models`: every model the agent can run on, for all workspaces. The chat's
 * composer picks one per message; the default is used when none is picked (and by the CLI).
 */
export function ModelsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const models = useModels();
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const backTo = fromPath(location.state) ?? '/';

  usePageHeader({
    title: 'Settings',
    subtitle:
      'The models the agent can run on, in every workspace. Pick one per message in the chat.',
    breadcrumbs: [{ label: APP_NAME, to: backTo }, { label: 'Settings' }],
  });

  const addModel = () => navigate(`${LIST_PATH}/new`, { state: { from: LIST_PATH } });

  const makeDefault = async (model: ModelProfile) => {
    setPendingDefault(model.id);
    try {
      await makeDefaultModel(model.id);
      models.reload();
      toast(`${model.name} is now the default`);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change the default model."), 'error');
    } finally {
      setPendingDefault(null);
    }
  };

  const list = models.data;

  return (
    <div className="w-full">
      <SettingsTabs />
      <TopbarActions>
        <Button variant="primary" onClick={addModel}>
          <PlusIcon /> Add model
        </Button>
      </TopbarActions>

      {!list && models.error ? (
        <p
          role="alert"
          className="border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
        >
          {errorMessage(models.error, "Couldn't load the models.")}
        </p>
      ) : !list ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
            <SparkIcon size={22} />
          </span>
          <h2 className="text-[16px] font-bold text-ink">No models yet</h2>
          <p className="mb-5 mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-3">
            Add the model the agent should run on: OpenAI, OpenRouter, Groq, or a local server like
            Ollama or LM Studio. Any server that speaks the OpenAI API works, as long as the model
            supports tool calling.
          </p>
          <Button variant="primary" onClick={addModel}>
            <PlusIcon /> Add your first model
          </Button>
        </div>
      ) : (
        <ul className="panel divide-y divide-line-2">
          {list.map((model) => (
            <li
              key={model.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:flex-nowrap sm:px-6"
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                  model.isDefault ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'
                }`}
              >
                <SparkIcon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-[14px] font-medium text-ink">{model.name}</span>
                  {model.isDefault && <Badge tone="blue">default</Badge>}
                  {model.supportsReasoning && <Badge>reasoning effort</Badge>}
                  {!model.hasApiKey && model.baseUrl === null && (
                    <Badge tone="yellow">no API key</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[12px] text-ink-3">
                  {model.model} · {serverLabel(model.baseUrl)}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {!model.isDefault && (
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={pendingDefault !== null}
                    onClick={() => void makeDefault(model)}
                  >
                    {pendingDefault === model.id && <Spinner size={11} />}
                    Make default
                  </Button>
                )}
                <Link
                  to={`${LIST_PATH}/${model.id}/edit`}
                  state={{ from: LIST_PATH }}
                  className="inline-flex h-7 items-center rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-subtle"
                >
                  Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
