import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  APPROVAL_MODES,
  DEFAULT_AGENT_SETTINGS,
  LOG_LEVELS,
  SETTINGS_LIMITS,
  agentSettingsSchema,
  type AgentSettings,
  type ApprovalMode,
  type LogLevel,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL, SECTION } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { compactNumber } from '../../lib/format';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { fetchSettings, saveSettings } from './api';
import { SettingsTabs } from './SettingsTabs';
import { APP_NAME } from '../../lib/brand';

/** The form keeps numbers as typed text, so a half-typed value isn't snapped to a number. */
type Draft = Omit<AgentSettings, 'maxSteps' | 'maxTotalTokens' | 'maxInputChars'> & {
  maxSteps: string;
  maxTotalTokens: string;
  maxInputChars: string;
};
type Field = keyof AgentSettings;
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly string[] = Object.keys(DEFAULT_AGENT_SETTINGS);
const isField = (value: unknown): value is Field =>
  typeof value === 'string' && FIELDS.includes(value);

const toDraft = (settings: AgentSettings): Draft => ({
  ...settings,
  maxSteps: String(settings.maxSteps),
  maxTotalTokens: String(settings.maxTotalTokens),
  maxInputChars: String(settings.maxInputChars),
});

const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

const fromDraft = (draft: Draft) => ({
  ...draft,
  maxSteps: toNumber(draft.maxSteps),
  maxTotalTokens: toNumber(draft.maxTotalTokens),
  maxInputChars: toNumber(draft.maxInputChars),
});

const APPROVALS: Record<ApprovalMode, { title: string; detail: string }> = {
  ask: {
    title: 'Ask first',
    detail: 'Asks before each tool that changes something: writing files, running commands, …',
  },
  auto: {
    title: 'Run without asking',
    detail: 'Tools that change things run straight away, commands included.',
  },
  deny: {
    title: 'Refuse',
    detail: 'Tools that change things are refused. The agent can still read and search.',
  },
};

const LOG_TEXT: Record<LogLevel, string> = {
  debug: 'Every event',
  info: 'Steps and problems',
  silent: 'Nothing',
};

const fmt = (value: number) => value.toLocaleString('en');

/**
 * `/settings/agent`: how the agent behaves in every workspace (approvals, planning,
 * limits, web search, logging). Saved in ~/.nimbrio-ai; applies from the next message.
 */
export function AgentSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? '/';

  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);

  usePageHeader({
    title: 'Settings',
    subtitle: 'How the agent behaves in every workspace. Changes apply from the next message.',
    breadcrumbs: [{ label: APP_NAME, to: backTo }, { label: 'Settings' }],
  });

  useEffect(() => {
    let isCurrent = true;
    fetchSettings()
      .then((settings) => {
        if (!isCurrent) return;
        setSaved(settings);
        setDraft(toDraft(settings));
      })
      .catch((cause: unknown) => {
        if (isCurrent) setLoadError(cause);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  if (!draft || !saved) {
    return (
      <div className="w-full">
        <SettingsTabs />
        {loadError ? (
          <p
            role="alert"
            className="border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
          >
            {errorMessage(loadError, "Couldn't load the settings.")}
          </p>
        ) : (
          <PageLoader />
        )}
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft({ ...draft, [key]: value });
    if (isField(key)) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const isDirty = JSON.stringify(toDraft(saved)) !== JSON.stringify(draft);
  const isDefault = JSON.stringify(toDraft(DEFAULT_AGENT_SETTINGS)) === JSON.stringify(draft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = agentSettingsSchema.safeParse(fromDraft(draft));
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
      const next = await saveSettings(checked.data);
      setSaved(next);
      setDraft(toDraft(next));
      toast('Settings saved');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the settings."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const numberField = (
    key: 'maxSteps' | 'maxTotalTokens' | 'maxInputChars',
    label: string,
    unit: string,
    hint: ReactNode,
    isCompact = false,
  ) => {
    const { min, max } = SETTINGS_LIMITS[key];
    const id = `setting-${key}`;
    const error = errors[key];
    const show = isCompact ? compactNumber : fmt;
    const typed = toNumber(draft[key]);
    return (
      <div className="min-w-0">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <div className="relative max-w-[22ch]">
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={draft[key]}
            aria-invalid={error ? true : undefined}
            onChange={(event) => set(key, event.target.value.replace(/[^\d]/g, ''))}
            className={`${INPUT} ${error ? INPUT_ERROR : INPUT_OK} pr-16 tabular-nums`}
          />
          <span className="pointer-events-none absolute bottom-2 right-3 text-[12px] text-ink-3">
            {unit}
          </span>
        </div>
        {isCompact && Number.isFinite(typed) && (
          <p aria-live="polite" className="mt-1 text-[13px] font-medium text-ink-2 tabular-nums">
            = {compactNumber(typed)} {unit}
          </p>
        )}
        {error && (
          <p role="alert" className={ERROR}>
            {error}
          </p>
        )}
        <p className={HINT}>
          {hint} {show(min)}–{show(max)}, default {show(DEFAULT_AGENT_SETTINGS[key])}.
        </p>
      </div>
    );
  };

  return (
    <div className="w-full">
      <SettingsTabs />

      <form
        id="settings-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <section className="panel">
          <SectionHeader
            title="Tool approvals"
            detail="Tools that change things outside the agent. File tools always stay inside the workspace folder."
          />
          <div className={SECTION}>
            <div
              role="radiogroup"
              aria-label="Tool approvals"
              className="grid gap-2 sm:grid-cols-3"
            >
              {APPROVAL_MODES.map((mode) => {
                const isOn = draft.approval === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => set('approval', mode)}
                    className={`flex flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors ${
                      isOn
                        ? 'border-accent bg-accent-soft ring-1 ring-accent'
                        : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                      <span
                        aria-hidden
                        className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${
                          isOn ? 'border-accent' : 'border-line-strong'
                        }`}
                      >
                        {isOn && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      </span>
                      {APPROVALS[mode].title}
                    </span>
                    <span className="text-[12px] leading-snug text-ink-3">
                      {APPROVALS[mode].detail}
                    </span>
                  </button>
                );
              })}
            </div>
            {draft.approval === 'auto' && (
              <p className="mt-3 border border-l-[3px] border-line border-l-warn-line bg-warn-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-warn">
                The agent will write files and run commands without asking. A few catastrophic
                commands (sudo, deleting your home folder, …) are still refused, but a command runs
                with your user&apos;s permissions.
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <SectionHeader
            title="Planning and limits"
            detail="Guardrails for each message you send."
          />
          <div className="flex flex-col divide-y divide-line-2">
            <div className={`${SECTION} flex items-start justify-between gap-4`}>
              <div>
                <p className={LABEL}>Plan multi-step work first</p>
                <p className={HINT}>
                  Before each request, a quick planning step decides whether to answer directly or
                  write a plan (shown in the Plan panel). Off: always answer directly.
                </p>
              </div>
              <Switch
                isOn={draft.planning === 'auto'}
                onChange={(isOn) => set('planning', isOn ? 'auto' : 'off')}
                label="Plan multi-step work first"
              />
            </div>
            <div className={`${SECTION} grid gap-5 md:grid-cols-3`}>
              {numberField(
                'maxSteps',
                'Max steps',
                'calls',
                'Model calls per message. Research with a plan can take 20+.',
              )}
              {numberField(
                'maxTotalTokens',
                'Token budget',
                'tokens',
                'Input + output tokens per message.',
                true,
              )}
              {numberField(
                'maxInputChars',
                'Longest message',
                'chars',
                'Longer messages are rejected.',
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <SectionHeader title="Web search and logging" />
          <div className="flex flex-col divide-y divide-line-2">
            <div className={SECTION}>
              <label htmlFor="setting-searxng" className={LABEL}>
                SearXNG URL
              </label>
              <input
                id="setting-searxng"
                value={draft.searxngUrl}
                autoComplete="off"
                spellCheck={false}
                maxLength={SETTINGS_LIMITS.searxngUrl}
                placeholder={DEFAULT_AGENT_SETTINGS.searxngUrl}
                aria-invalid={errors.searxngUrl ? true : undefined}
                onChange={(event) => set('searxngUrl', event.target.value)}
                className={`${INPUT} ${errors.searxngUrl ? INPUT_ERROR : INPUT_OK} max-w-[56ch] font-mono text-[13px]`}
              />
              {errors.searxngUrl && (
                <p role="alert" className={ERROR}>
                  {errors.searxngUrl}
                </p>
              )}
              <p className={HINT}>
                The instance the <span className="font-mono">web_search</span> tool uses, with the
                JSON format turned on (
                <span className="font-mono">search.formats: [html, json]</span>
                ).
              </p>
            </div>
            <div className={SECTION}>
              <p className={LABEL}>Console log level</p>
              <div
                role="radiogroup"
                aria-label="Console log level"
                className="mt-2 inline-flex rounded-lg border border-line bg-surface-2 p-0.5"
              >
                {LOG_LEVELS.map((level) => {
                  const isOn = draft.logLevel === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={isOn}
                      onClick={() => set('logLevel', level)}
                      className={`h-7 rounded-md px-3 text-[12.5px] font-medium capitalize transition-colors ${
                        isOn
                          ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]'
                          : 'text-ink-3 hover:text-ink'
                      }`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
              <p className={HINT}>
                {LOG_TEXT[draft.logLevel]} in the server&apos;s terminal. Each run is also written
                to a JSONL log in <span className="font-mono">~/.nimbrio-ai/logs</span> (move it
                with <span className="font-mono">AGENT_LOG_DIR</span> in .env).
              </p>
            </div>
          </div>
        </section>

        <p className="text-[12.5px] leading-relaxed text-ink-3">
          Still in <span className="font-mono">.env</span>, because the server needs them when it
          starts: <span className="font-mono">PORT</span>,{' '}
          <span className="font-mono">CORS_ORIGIN</span>,{' '}
          <span className="font-mono">LOG_LEVEL</span> (HTTP logs) and{' '}
          <span className="font-mono">AGENT_LOG_DIR</span>.
        </p>
      </form>

      <FormActions>
        <Button
          variant="plain"
          className="mr-auto"
          disabled={isDefault || isSaving}
          onClick={() => {
            setDraft(toDraft(DEFAULT_AGENT_SETTINGS));
            setErrors({});
          }}
          title="Fill in the defaults; nothing changes until you save"
        >
          Reset to defaults
        </Button>
        <Button onClick={() => navigate(backTo)}>{isDirty ? 'Cancel' : 'Back'}</Button>
        <Button
          variant="primary"
          type="submit"
          form="settings-form"
          disabled={!isDirty || isSaving}
        >
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </FormActions>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="border-b border-line bg-subtle px-5 py-3 sm:px-6">
      <h2 className="text-[15px] font-bold text-ink">{title}</h2>
      {detail && <p className="text-[13px] text-ink-3">{detail}</p>}
    </div>
  );
}
