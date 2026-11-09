import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_CONTEXT_WINDOW,
  LIMITS,
  modelInputSchema,
  modelUpdateSchema,
  type ModelProvider,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, INPUT_ERROR, INPUT_OK } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { TrashIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { createModel, deleteModel, fetchModel, updateModel } from './api';
import { SERVER_PRESETS } from './servers';
import { APP_NAME } from '../../lib/brand';

type Field = 'name' | 'model' | 'baseUrl' | 'apiKey' | 'maxTokens' | 'contextWindow';
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly string[] = [
  'name',
  'model',
  'baseUrl',
  'apiKey',
  'maxTokens',
  'contextWindow',
];
/** Common context window sizes, offered as quick picks. */
const WINDOW_PRESETS = [32_000, 128_000, 200_000, 1_000_000] as const;
const windowLabel = (tokens: number) =>
  tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1_000)}K`;
const isField = (value: unknown): value is Field =>
  typeof value === 'string' && FIELDS.includes(value);

const PRESET =
  'h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50';

// A denser take on the shared form styles: this form opens in the settings popup.
const LABEL = 'block text-[13px] font-semibold text-ink';
const OPTIONAL = 'font-normal text-ink-3';
const FIELD_BOX =
  'h-9 rounded-lg border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent focus-visible:outline-none';
const FIELD = `${FIELD_BOX} mt-1 w-full`;
const TIP = 'mt-1 text-[12px] leading-snug text-ink-3';

/**
 * Add or edit one model: `/settings/models/new` and `/settings/models/:modelId/edit`.
 * A saved API key is never shown again: leave the field empty to keep it.
 */
export function ModelFormPage() {
  const { modelId } = useParams();
  const isEdit = modelId !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? '/settings/models';

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  // Cursor models are added from Settings → Model providers; here they only change their details.
  const [provider, setProvider] = useState<ModelProvider>('openai');
  const isCursor = provider === 'cursor';
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [isKeyRemoved, setIsKeyRemoved] = useState(false);
  const [maxTokens, setMaxTokens] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [wasDefault, setWasDefault] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  usePageHeader({
    title: isEdit ? 'Edit model' : 'Add model',
    subtitle:
      'Any server that speaks the OpenAI API; the model must support tool calling. Shared by every workspace.',
    breadcrumbs: [
      { label: APP_NAME, to: '/' },
      { label: 'Models', to: '/settings/models' },
      { label: isEdit ? name || 'Model' : 'New model' },
    ],
  });

  useEffect(() => {
    if (!modelId) return;
    let isCurrent = true;
    setIsLoading(true);
    fetchModel(modelId)
      .then((saved) => {
        if (!isCurrent) return;
        setName(saved.name);
        setModel(saved.model);
        setProvider(saved.provider);
        setBaseUrl(saved.baseUrl ?? '');
        setHasSavedKey(saved.hasApiKey);
        setMaxTokens(saved.maxTokens === null ? '' : String(saved.maxTokens));
        setContextWindow(saved.contextWindow === null ? '' : String(saved.contextWindow));
        setSupportsReasoning(saved.supportsReasoning);
        setIsDefault(saved.isDefault);
        setWasDefault(saved.isDefault);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(errorMessage(cause, "Couldn't load the model."), 'error');
        navigate(backTo, { replace: true });
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [modelId, backTo, navigate, toast]);

  const clearError = (field: Field) => setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const tokens = maxTokens.trim();
    const window = contextWindow.trim();
    const typedKey = apiKey.trim();
    const body = {
      // A blank name takes the model's own name.
      name: name.trim() || model.trim(),
      model,
      baseUrl,
      maxTokens: tokens === '' ? null : Number(tokens),
      contextWindow: window === '' ? null : Number(window),
      supportsReasoning,
      isDefault,
    };
    // Editing: an untouched key field keeps the saved key.
    const apiKeyChange = typedKey ? typedKey : isKeyRemoved || !isEdit ? '' : undefined;
    const checked = isEdit
      ? modelUpdateSchema.safeParse({ ...body, apiKey: apiKeyChange })
      : modelInputSchema.safeParse({ ...body, apiKey: apiKeyChange ?? '' });
    if (!checked.success) {
      const found: FieldErrors = {};
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (isField(field)) found[field] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});

    setIsSaving(true);
    try {
      if (modelId) await updateModel(modelId, { ...body, apiKey: apiKeyChange });
      else await createModel({ ...body, apiKey: apiKeyChange ?? '' });
      toast(isEdit ? 'Model saved' : 'Model added');
      navigate(backTo);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the model."), 'error');
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!modelId) return;
    setIsDeleting(true);
    try {
      await deleteModel(modelId);
      toast('Model deleted');
      navigate(backTo, { replace: true });
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the model."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  if (isLoading) return <PageLoader />;

  const keyPlaceholder =
    hasSavedKey && !isKeyRemoved ? 'Saved. Type a new key to replace it' : 'sk-…';

  return (
    <div className="w-full">
      <form
        id="model-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="panel flex flex-col gap-4 px-5 py-4 sm:px-6"
      >
        {isCursor && (
          <p className="border-l-[3px] border-accent bg-accent-bg px-4 py-2.5 text-[13px] text-ink-2">
            Served by Cursor with the account signed in under Settings → Model providers.
          </p>
        )}
        <div hidden={isCursor}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="model-url" className={LABEL}>
              Server
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SERVER_PRESETS.map((preset) => {
                const isOn = baseUrl.trim().replace(/\/+$/, '') === preset.baseUrl;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() => {
                      setBaseUrl(preset.baseUrl);
                      clearError('baseUrl');
                    }}
                    className={`${PRESET} ${
                      isOn
                        ? 'border-accent bg-accent-soft text-accent-2'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <input
            id="model-url"
            value={baseUrl}
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.modelUrl}
            placeholder="https://api.openai.com/v1"
            aria-invalid={errors.baseUrl ? true : undefined}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              clearError('baseUrl');
            }}
            className={`${FIELD} ${errors.baseUrl ? INPUT_ERROR : INPUT_OK} font-mono`}
          />
          {errors.baseUrl && (
            <p role="alert" className={ERROR}>
              {errors.baseUrl}
            </p>
          )}
          <p className={TIP}>
            OpenAI-compatible base URL, usually ending in <span className="font-mono">/v1</span>.
            Empty uses api.openai.com.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="model-id" className={LABEL}>
              Model name
            </label>
            <input
              id="model-id"
              value={model}
              autoFocus={!isEdit}
              autoComplete="off"
              spellCheck={false}
              maxLength={LIMITS.modelId}
              placeholder="gpt-4.1, llama3.1:8b, …"
              aria-invalid={errors.model ? true : undefined}
              onChange={(event) => {
                setModel(event.target.value);
                clearError('model');
              }}
              className={`${FIELD} ${errors.model ? INPUT_ERROR : INPUT_OK} font-mono`}
            />
            {errors.model ? (
              <p role="alert" className={ERROR}>
                {errors.model}
              </p>
            ) : (
              <p className={TIP}>
                {isCursor ? 'Cursor’s id for the model.' : 'Exactly as the server lists it.'}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <label htmlFor="model-name" className={LABEL}>
              Display name <span className={OPTIONAL}>· optional</span>
            </label>
            <input
              id="model-name"
              value={name}
              autoComplete="off"
              maxLength={LIMITS.modelName}
              placeholder={model.trim() || 'GPT-4.1'}
              aria-invalid={errors.name ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                clearError('name');
              }}
              className={`${FIELD} ${errors.name ? INPUT_ERROR : INPUT_OK}`}
            />
            {errors.name ? (
              <p role="alert" className={ERROR}>
                {errors.name}
              </p>
            ) : (
              <p className={TIP}>Shown in the model picker.</p>
            )}
          </div>
        </div>

        <div hidden={isCursor}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="model-key" className={LABEL}>
              API key <span className={OPTIONAL}>· not needed for Ollama or LM Studio</span>
            </label>
            {hasSavedKey && !apiKey && (
              <Button
                size="sm"
                variant={isKeyRemoved ? 'plain' : 'danger-ghost'}
                onClick={() => setIsKeyRemoved(!isKeyRemoved)}
              >
                {isKeyRemoved ? 'Keep the saved key' : 'Remove saved key'}
              </Button>
            )}
          </div>
          <input
            id="model-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.apiKey}
            placeholder={keyPlaceholder}
            aria-invalid={errors.apiKey ? true : undefined}
            onChange={(event) => {
              setApiKey(event.target.value);
              clearError('apiKey');
            }}
            className={`${FIELD} ${errors.apiKey ? INPUT_ERROR : INPUT_OK} font-mono`}
          />
          {errors.apiKey && (
            <p role="alert" className={ERROR}>
              {errors.apiKey}
            </p>
          )}
          <p className={TIP}>
            {isKeyRemoved
              ? 'The saved key is removed when you save.'
              : 'Kept in ~/.nimbrio-ai/models.json, readable only by you, sent only to this server, and never shown again.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <label htmlFor="model-max-tokens" className={LABEL}>
              Max output tokens <span className={OPTIONAL}>· optional</span>
            </label>
            <input
              id="model-max-tokens"
              inputMode="numeric"
              value={maxTokens}
              autoComplete="off"
              placeholder="Server default"
              aria-invalid={errors.maxTokens ? true : undefined}
              onChange={(event) => {
                setMaxTokens(event.target.value.replace(/[^\d]/g, ''));
                clearError('maxTokens');
              }}
              className={`${FIELD} ${errors.maxTokens ? INPUT_ERROR : INPUT_OK} tabular-nums`}
            />
            {errors.maxTokens && (
              <p role="alert" className={ERROR}>
                {errors.maxTokens}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <label htmlFor="model-context-window" className={LABEL}>
              Context window <span className={OPTIONAL}>· tokens, optional</span>
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input
                id="model-context-window"
                inputMode="numeric"
                value={contextWindow}
                autoComplete="off"
                placeholder={`${DEFAULT_CONTEXT_WINDOW.toLocaleString('en')} (default)`}
                aria-invalid={errors.contextWindow ? true : undefined}
                onChange={(event) => {
                  setContextWindow(event.target.value.replace(/[^\d]/g, ''));
                  clearError('contextWindow');
                }}
                className={`${FIELD_BOX} ${errors.contextWindow ? INPUT_ERROR : INPUT_OK} min-w-0 flex-1 basis-[16ch] tabular-nums`}
              />
              {WINDOW_PRESETS.map((preset) => {
                const isOn = contextWindow === String(preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setContextWindow(String(preset));
                      clearError('contextWindow');
                    }}
                    aria-pressed={isOn}
                    className={`${PRESET} tabular-nums ${
                      isOn
                        ? 'border-accent bg-accent-soft text-accent-2'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {windowLabel(preset)}
                  </button>
                );
              })}
            </div>
            {errors.contextWindow ? (
              <p role="alert" className={ERROR}>
                {errors.contextWindow}
              </p>
            ) : (
              <p className={TIP}>
                Input and output together; long chats are summarized near it. Empty assumes{' '}
                {windowLabel(DEFAULT_CONTEXT_WINDOW)}.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 border-t border-line-2 pt-4 sm:grid-cols-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={LABEL}>Reasoning effort</p>
              <p className={TIP}>
                Offers Low, Medium or High per message (o-series, GPT-5, DeepSeek R1, …).
              </p>
            </div>
            <Switch
              isOn={supportsReasoning}
              onChange={setSupportsReasoning}
              label="Supports reasoning effort"
            />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={LABEL}>Default model</p>
              <p className={TIP}>
                {wasDefault
                  ? 'This is the default. Make another model the default to change it.'
                  : 'Used when no model is picked, and by the terminal chat.'}
              </p>
            </div>
            <Switch
              isOn={isDefault}
              onChange={setIsDefault}
              disabled={wasDefault}
              label="Default model"
            />
          </div>
        </div>
      </form>

      <FormActions>
        {isEdit && (
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={() => setIsDeleteOpen(true)}
            disabled={isSaving}
          >
            <TrashIcon /> Delete
          </Button>
        )}
        <Button onClick={() => navigate(backTo)}>Cancel</Button>
        <Button variant="primary" type="submit" form="model-form" disabled={isSaving}>
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Add model'}
        </Button>
      </FormActions>

      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this model?"
          message={
            <>
              <strong className="text-ink">{name || model}</strong> and its saved API key are
              removed. Chats keep their history.
              {wasDefault && ' The oldest remaining model becomes the default.'}
            </>
          }
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
