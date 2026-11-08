import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_CONTEXT_WINDOW, LIMITS, modelInputSchema, modelUpdateSchema } from '@app/shared';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL, SECTION } from '../../components/form';
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
    subtitle: 'Any server that speaks the OpenAI API. The model must support tool calling.',
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
      <form id="model-form" noValidate onSubmit={(event) => void submit(event)} className="panel">
        <div className="border-b border-line bg-subtle px-5 py-3 sm:px-6">
          <h2 className="text-[15px] font-bold text-ink">Model</h2>
          <p className="text-[13px] text-ink-3">
            Shared by every workspace. Choose it per message from the chat&apos;s message box.
          </p>
        </div>

        <div className="flex flex-col divide-y divide-line-2">
          <div className={SECTION}>
            <span className={LABEL}>Server</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
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
            <label htmlFor="model-url" className="sr-only">
              Server URL
            </label>
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
              className={`${INPUT} ${errors.baseUrl ? INPUT_ERROR : INPUT_OK} font-mono text-[13px]`}
            />
            {errors.baseUrl && (
              <p role="alert" className={ERROR}>
                {errors.baseUrl}
              </p>
            )}
            <p className={HINT}>
              The server&apos;s OpenAI-compatible base URL, usually ending in{' '}
              <span className="font-mono">/v1</span>. Leave it empty for api.openai.com.
            </p>
          </div>

          <div className={`${SECTION} grid gap-5 sm:grid-cols-2`}>
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
                className={`${INPUT} ${errors.model ? INPUT_ERROR : INPUT_OK} font-mono text-[13px]`}
              />
              {errors.model && (
                <p role="alert" className={ERROR}>
                  {errors.model}
                </p>
              )}
              <p className={HINT}>Exactly as the server lists it.</p>
            </div>
            <div className="min-w-0">
              <label htmlFor="model-name" className={LABEL}>
                Display name <span className="font-normal text-ink-3">· optional</span>
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
                className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK}`}
              />
              {errors.name && (
                <p role="alert" className={ERROR}>
                  {errors.name}
                </p>
              )}
              <p className={HINT}>What the model picker shows. Empty uses the model name.</p>
            </div>
          </div>

          <div className={SECTION}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label htmlFor="model-key" className={LABEL}>
                API key{' '}
                <span className="font-normal text-ink-3">· not needed for Ollama or LM Studio</span>
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
              className={`${INPUT} ${errors.apiKey ? INPUT_ERROR : INPUT_OK} max-w-[56ch] font-mono text-[13px]`}
            />
            {errors.apiKey && (
              <p role="alert" className={ERROR}>
                {errors.apiKey}
              </p>
            )}
            <p className={HINT}>
              {isKeyRemoved
                ? 'The saved key is removed when you save.'
                : "Stored on this machine in ~/.nimbrio-ai/models.json, readable only by you, and only sent to this server. It's never shown again."}
            </p>
          </div>

          <div className={`${SECTION} grid gap-5`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={LABEL}>Reasoning effort</p>
                <p className={HINT}>
                  For reasoning models (o-series, GPT-5, DeepSeek R1, …): the chat offers Low,
                  Medium or High per message. Models without it may reject the setting.
                </p>
              </div>
              <Switch
                isOn={supportsReasoning}
                onChange={setSupportsReasoning}
                label="Supports reasoning effort"
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={LABEL}>Default model</p>
                <p className={HINT}>
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
            <div className="max-w-[24ch]">
              <label htmlFor="model-max-tokens" className={LABEL}>
                Max output tokens <span className="font-normal text-ink-3">· optional</span>
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
                className={`${INPUT} ${errors.maxTokens ? INPUT_ERROR : INPUT_OK} tabular-nums`}
              />
              {errors.maxTokens && (
                <p role="alert" className={ERROR}>
                  {errors.maxTokens}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="model-context-window" className={LABEL}>
                Context window <span className="font-normal text-ink-3">· tokens, optional</span>
              </label>
              <p className={HINT}>
                How much the model takes in one request, input and output together. Long chats are
                summarized as they near it. Empty assumes {windowLabel(DEFAULT_CONTEXT_WINDOW)}.
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
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
                  className={`${INPUT} ${errors.contextWindow ? INPUT_ERROR : INPUT_OK} max-w-[24ch] tabular-nums`}
                />
                {WINDOW_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setContextWindow(String(preset));
                      clearError('contextWindow');
                    }}
                    aria-pressed={contextWindow === String(preset)}
                    className={`rounded-lg border px-2 py-1 text-[12px] font-medium tabular-nums transition-colors ${
                      contextWindow === String(preset)
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {windowLabel(preset)}
                  </button>
                ))}
              </div>
              {errors.contextWindow && (
                <p role="alert" className={ERROR}>
                  {errors.contextWindow}
                </p>
              )}
            </div>
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
