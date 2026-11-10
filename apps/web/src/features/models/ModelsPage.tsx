import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ModelProfile } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { PageLoader } from '../../components/PageLoader';
import { RowMenu } from '../../components/RowMenu';
import { Spinner } from '../../components/Spinner';
import { TopbarActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import {
  CheckIcon,
  DotsVerticalIcon,
  EditIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon,
} from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { SettingsTabs } from '../settings/SettingsTabs';
import { deleteModel, makeDefaultModel } from './api';
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
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [toDelete, setToDelete] = useState<ModelProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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
      toast(`${model.name} is now the default`);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change the default model."), 'error');
    } finally {
      setPendingDefault(null);
    }
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  const cancelDelete = useCallback(() => setToDelete(null), []);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await deleteModel(toDelete.id);
      toast('Model deleted');
      setToDelete(null);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the model."), 'error');
      setToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const editModel = (model: ModelProfile) =>
    navigate(`${LIST_PATH}/${model.id}/edit`, { state: { from: LIST_PATH } });

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
            <li key={model.id} className="flex items-center gap-x-4 px-5 py-4 sm:px-6">
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
                  {model.provider === 'openai' && !model.hasApiKey && model.baseUrl === null && (
                    <Badge tone="yellow">no API key</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[12px] text-ink-3">
                  {model.model} · {serverLabel(model)}
                </p>
              </div>
              {pendingDefault === model.id && <Spinner size={13} label="Making it the default" />}
              <button
                type="button"
                onClick={(event) =>
                  setMenu(
                    menu?.id === model.id ? null : { id: model.id, anchor: event.currentTarget },
                  )
                }
                aria-label={`More for ${model.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === model.id}
                title="Edit, make default, delete…"
                className={`ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-subtle hover:text-ink ${
                  menu?.id === model.id ? 'bg-subtle text-ink' : 'text-ink-3'
                }`}
              >
                <DotsVerticalIcon size={15} />
              </button>
              {menu?.id === model.id && (
                <RowMenu
                  anchor={menu.anchor}
                  onClose={closeMenu}
                  items={[
                    {
                      label: 'Edit',
                      icon: <EditIcon size={13} />,
                      onSelect: () => editModel(model),
                    },
                    ...(model.isDefault || pendingDefault !== null
                      ? []
                      : [
                          {
                            label: 'Make default',
                            icon: <CheckIcon size={13} />,
                            onSelect: () => void makeDefault(model),
                          },
                        ]),
                    {
                      label: 'Delete',
                      icon: <TrashIcon size={13} />,
                      onSelect: () => setToDelete(model),
                      isDanger: true,
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDeleteDialog
        open={toDelete !== null}
        title="Delete this model?"
        message={
          <>
            <strong className="text-ink">{toDelete?.name}</strong> and its saved API key are
            removed. Chats keep their history.
            {toDelete?.isDefault && ' The oldest remaining model becomes the default.'}
          </>
        }
        busy={isDeleting}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
