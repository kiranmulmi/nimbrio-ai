import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LIMITS,
  workspaceInputSchema,
  workspaceUpdateSchema,
  type McpServerEntry,
  type ToolGroup,
  type Workspace,
  type WorkspacePlanning,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';

/** One section of a tab: flat on the popup (no card), split by thin lines. */
const SECTION = 'py-5 first:pt-1';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage, isNotFound } from '../../lib/api';
import { FolderIcon, TrashIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import {
  checkWorkspaceFolder,
  createWorkspace,
  deleteWorkspace,
  fetchWorkspace,
  pickFolderWithSystemDialog,
  updateWorkspace,
} from './api';
import { FolderPicker } from './FolderPicker';
import { announceWorkspaceSaved } from './workspaceEvents';
import { InstructionsEditor } from './InstructionsEditor';
import {
  ChatModeChoice,
  McpServerSwitches,
  PlanningChoice,
  PanelTabSwitches,
  ToolGroupSwitches,
} from './AgentChoices';
import { VoiceSettings } from './VoiceSettings';
import { readVoicePrefs, writeVoicePrefs, type VoicePrefs } from '../chat/voicePrefs';
import { fetchMcpEnabled, fetchMcpServers, saveMcpEnabled } from '../mcp/api';
import { APP_NAME } from '../../lib/brand';

type FieldErrors = { name?: string; path?: string; instructions?: string };

/** Wait for a pause in typing before asking whether the folder is free. */
const FOLDER_CHECK_DELAY_MS = 300;

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'agent', label: 'Planning & tools' },
  { id: 'voice', label: 'Voice' },
  { id: 'mcp', label: 'MCP servers' },
] as const;
type FormTab = (typeof TABS)[number]['id'];

/** The tab holding the first field with an error, so a failed save shows it. */
function tabWithError(errors: FieldErrors): FormTab | null {
  if (errors.name || errors.path) return 'general';
  if (errors.instructions) return 'instructions';
  return null;
}

function toFieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if ((field === 'name' || field === 'path' || field === 'instructions') && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

/** One setting: its label and a short hint, with the control under them at full width. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={SECTION}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Shared create and edit form for a workspace: `/workspaces/new` and
 * `/workspaces/:workspaceId/settings`. Deleting lives here too, behind a confirm modal.
 */
export function WorkspaceFormPage() {
  const { workspaceId } = useParams();
  const isEdit = workspaceId !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [instructions, setInstructions] = useState('');
  const [planning, setPlanning] = useState<WorkspacePlanning>('default');
  const [disabledTools, setDisabledTools] = useState<ToolGroup[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  // This browser's voice choices: edited here, written when the form saves (Cancel drops them).
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(readVoicePrefs);
  const changeVoicePrefs = useCallback(
    (next: Partial<VoicePrefs>) => setVoicePrefs((current) => ({ ...current, ...next })),
    [],
  );
  const [hasTerminalTab, setHasTerminalTab] = useState(false);
  const [hasGitTab, setHasGitTab] = useState(false);
  // MCP servers: the app's list, and which are on here (saved to mcp.json after the workspace).
  const [mcpServers, setMcpServers] = useState<McpServerEntry[] | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState<string[]>([]);
  const [savedMcp, setSavedMcp] = useState<string[]>([]);
  const [isMcpTrusted, setIsMcpTrusted] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [tab, setTab] = useState<FormTab>('general');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loaded, setLoaded] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const from = fromPath(location.state);
  // Editing: back to the chat it was opened from (in this workspace), else its newest chat.
  const backTo = isEdit
    ? from?.startsWith(`/workspaces/${workspaceId}`)
      ? from
      : `/workspaces/${workspaceId}`
    : (from ?? '/');

  usePageHeader({
    // The saved name, so the popup's header names the workspace being edited.
    title: isEdit
      ? loaded
        ? `Workspace settings · ${loaded.name}`
        : 'Workspace settings'
      : 'New workspace',
    subtitle: isEdit
      ? 'Changes apply to the next message in every chat of this workspace.'
      : 'A workspace keeps its own folder, chats, memories and instructions.',
    breadcrumbs: isEdit
      ? [
          { label: APP_NAME, to: '/' },
          { label: loaded?.name ?? 'Workspace', to: backTo },
          { label: 'Settings' },
        ]
      : [{ label: APP_NAME, to: '/' }, { label: 'New workspace' }],
  });

  useEffect(() => {
    if (!workspaceId) return;
    let isCurrent = true;
    setIsLoading(true);
    fetchWorkspace(workspaceId)
      .then((workspace) => {
        if (!isCurrent) return;
        setLoaded(workspace);
        setName(workspace.name);
        setFolderPath(workspace.path);
        setInstructions(workspace.instructions);
        setPlanning(workspace.planning);
        setDisabledTools(workspace.disabledTools);
        setVoiceMode(workspace.voiceMode);
        setHasTerminalTab(workspace.hasTerminalTab);
        setHasGitTab(workspace.hasGitTab);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        if (isNotFound(cause)) {
          toast('That workspace no longer exists.', 'warning');
          navigate('/', { replace: true });
        } else {
          toast(errorMessage(cause, "Couldn't load the workspace."), 'error');
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, navigate, toast]);

  useEffect(() => {
    let isCurrent = true;
    Promise.all([fetchMcpServers(), workspaceId ? fetchMcpEnabled(workspaceId) : null])
      .then(([servers, state]) => {
        if (!isCurrent) return;
        setMcpServers(servers);
        const known = new Set(servers.map((entry) => entry.name));
        const on = (state?.enabled ?? []).filter((name) => known.has(name));
        setMcpEnabled(on);
        setSavedMcp(on);
        setIsMcpTrusted(state?.isTrusted ?? true);
      })
      .catch((cause: unknown) => {
        if (isCurrent) setMcpError(errorMessage(cause, "Couldn't load the MCP servers."));
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId]);

  // Checked as the folder is typed or picked (e.g. another workspace already uses it), so it
  // shows under the field before Save. A failed check stays quiet: saving checks again.
  const [folderProblem, setFolderProblem] = useState<string | null>(null);
  const savedPath = loaded?.path;
  useEffect(() => {
    const wanted = folderPath.trim();
    setFolderProblem(null);
    if (!wanted || wanted === savedPath) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      checkWorkspaceFolder(wanted, workspaceId)
        .then((problem) => {
          if (isCurrent) setFolderProblem(problem);
        })
        .catch(() => {});
    }, FOLDER_CHECK_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [folderPath, savedPath, workspaceId]);
  const pathError = errors.path ?? folderProblem;

  const isMcpChanged =
    mcpServers !== null &&
    (mcpEnabled.length !== savedMcp.length || mcpEnabled.some((name) => !savedMcp.includes(name)));

  const save = async (write: () => Promise<Workspace>, message: string) => {
    setErrors({});
    setIsSaving(true);
    try {
      const workspace = await write();
      writeVoicePrefs(voicePrefs);
      if (isMcpChanged) {
        try {
          await saveMcpEnabled(workspace.id, mcpEnabled);
        } catch (cause) {
          toast(
            `${message}, but its MCP servers didn't change: ${errorMessage(cause, 'try again.')}`,
            'warning',
          );
          announceWorkspaceSaved();
          navigate(isEdit ? backTo : `/workspaces/${workspace.id}`);
          return;
        }
      }
      toast(message);
      announceWorkspaceSaved();
      navigate(isEdit ? backTo : `/workspaces/${workspace.id}`);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the workspace."), 'error');
      setIsSaving(false);
    }
  };

  const showErrors = (next: FieldErrors) => {
    setErrors(next);
    const errorTab = tabWithError(next);
    if (errorTab) setTab(errorTab);
  };

  /** Arrow keys move between the tabs (up/down in the side column, left/right on phones). */
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`workspace-tab-${next.id}`)?.focus();
  };
  const panelProps = (id: FormTab) => ({
    id: `workspace-panel-${id}`,
    role: 'tabpanel',
    'aria-labelledby': `workspace-tab-${id}`,
    hidden: tab !== id,
    // `hidden` alone loses to the `flex` class, so the class hides it too. Hidden tabs stay
    // mounted, so what's typed in them is kept.
    className: tab === id ? 'flex flex-col divide-y divide-line-2' : 'hidden',
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (folderProblem) return showErrors({ path: folderProblem });
    if (workspaceId) {
      const parsed = workspaceUpdateSchema.safeParse({
        name,
        path: folderPath,
        instructions,
        planning,
        disabledTools,
        voiceMode,
        hasTerminalTab,
        hasGitTab,
      });
      if (!parsed.success) return showErrors(toFieldErrors(parsed.error.issues));
      void save(() => updateWorkspace(workspaceId, parsed.data), 'Workspace saved');
    } else {
      const parsed = workspaceInputSchema.safeParse({
        name,
        path: folderPath,
        instructions,
        planning,
        disabledTools,
        voiceMode,
        hasTerminalTab,
        hasGitTab,
      });
      if (!parsed.success) return showErrors(toFieldErrors(parsed.error.issues));
      void save(() => createWorkspace(parsed.data), 'Workspace created');
    }
  };

  const confirmDelete = async () => {
    if (!workspaceId) return;
    setIsDeleting(true);
    try {
      const { filesKeptAt } = await deleteWorkspace(workspaceId);
      toast(`Workspace deleted. Its files are still in ${filesKeptAt}.`);
      navigate('/', { replace: true });
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the workspace."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };

  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);
  const closePicker = useCallback(() => setIsPickerOpen(false), []);
  // Browse: the system's own folder window; the in-app browser only where there is none.
  const [isChoosing, setIsChoosing] = useState(false);
  const browse = () => {
    setIsChoosing(true);
    pickFolderWithSystemDialog(folderPath.trim() || undefined)
      .then(({ path: picked, isSupported }) => {
        if (!isSupported) setIsPickerOpen(true);
        else if (picked) pickFolder(picked);
      })
      .catch((cause: unknown) => {
        toast(errorMessage(cause, "Couldn't open the folder window."), 'error');
        setIsPickerOpen(true);
      })
      .finally(() => setIsChoosing(false));
  };
  const pickFolder = useCallback((picked: string) => {
    setFolderPath(picked);
    setErrors((current) => ({ ...current, path: undefined }));
    setIsPickerOpen(false);
  }, []);
  const isFolderChanged = loaded !== null && folderPath.trim() !== loaded.path;

  return (
    <div className="w-full">
      {isLoading ? (
        <PageLoader />
      ) : (
        <form
          id="workspace-form"
          noValidate
          onSubmit={submit}
          className="flex flex-col gap-4 md:flex-row md:gap-6"
        >
          {/* Vertical tabs beside the form; a row above it on phones. */}
          <div
            role="tablist"
            aria-label="Workspace settings"
            aria-orientation="vertical"
            onKeyDown={moveTab}
            className="-mx-1 flex shrink-0 gap-1 overflow-x-auto border-b border-line pb-2 md:sticky md:top-0 md:mx-0 md:w-44 md:flex-col md:self-start md:overflow-visible md:border-b-0 md:border-r md:pb-0 md:pr-4"
          >
            {TABS.map((item) => {
              const isActive = tab === item.id;
              const hasError = tabWithError(errors) === item.id;
              const count = item.id === 'mcp' && mcpEnabled.length > 0 ? mcpEnabled.length : null;
              return (
                <button
                  key={item.id}
                  id={`workspace-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`workspace-panel-${item.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-left text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-ink'
                      : 'text-ink-2 hover:bg-subtle hover:text-ink'
                  }`}
                >
                  {item.label}
                  {count !== null && (
                    <span className="rounded-full bg-accent-soft px-1.5 text-[11px] tabular-nums text-accent-2">
                      {count}
                    </span>
                  )}
                  {hasError && (
                    <span
                      aria-label="has an error"
                      className="h-1.5 w-1.5 rounded-full bg-danger"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1">
            <div {...panelProps('general')}>
              <Field id="workspace-name" label="Name" hint="Shown in the sidebar and the switcher.">
                <input
                  id="workspace-name"
                  value={name}
                  autoFocus
                  autoComplete="off"
                  maxLength={LIMITS.workspaceName}
                  placeholder="e.g. English tutor"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? 'workspace-name-error' : undefined}
                  onChange={(event) => setName(event.target.value)}
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK}`}
                />
                {errors.name && (
                  <p id="workspace-name-error" role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
              </Field>

              <Field id="workspace-path" label="Folder" hint="Where the agent's file tools work.">
                <div className="flex items-start gap-2">
                  <input
                    id="workspace-path"
                    value={folderPath}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={LIMITS.folderPath}
                    placeholder="/Users/you/projects/my-app"
                    aria-invalid={pathError ? true : undefined}
                    aria-describedby={
                      pathError ? 'workspace-path-error workspace-path-hint' : 'workspace-path-hint'
                    }
                    onChange={(event) => {
                      setFolderPath(event.target.value);
                      setErrors((current) => ({ ...current, path: undefined }));
                    }}
                    className={`${INPUT} min-w-0 flex-1 font-mono text-[13px] ${
                      pathError ? INPUT_ERROR : INPUT_OK
                    }`}
                  />
                  <Button
                    className="mt-2 h-[38px] shrink-0"
                    onClick={browse}
                    disabled={isChoosing}
                    title={isChoosing ? 'Choose a folder in the window that opened' : undefined}
                  >
                    {isChoosing ? <Spinner size={13} /> : <FolderIcon />}
                    {isChoosing ? 'Choosing…' : 'Browse…'}
                  </Button>
                </div>
                {pathError && (
                  <p id="workspace-path-error" role="alert" className={ERROR}>
                    {pathError}
                  </p>
                )}
                <p
                  id="workspace-path-hint"
                  className={isFolderChanged ? 'mt-1.5 text-[13px] text-warn' : HINT}
                >
                  {isFolderChanged ? (
                    'Chats, memories and instructions move to the new folder with it, and the agent works there from now on.'
                  ) : (
                    <>
                      An existing project, or a new folder created for you. The agent can read and
                      change anything inside it, asking before each change. Its chats and memories
                      are kept in <span className="font-mono text-[12px]">.nimbrio-ai/</span> there.
                    </>
                  )}
                </p>
              </Field>

              {isEdit && (
                <div
                  className={`${SECTION} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
                >
                  <div>
                    <h2 className="text-[14px] font-medium text-ink">Delete this workspace</h2>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                      Removes its chats, memories and instructions. The other files in its folder
                      stay where they are.
                    </p>
                  </div>
                  <Button
                    variant="danger-outline"
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => setIsDeleteOpen(true)}
                    disabled={!loaded || isSaving}
                  >
                    <TrashIcon /> Delete workspace
                  </Button>
                </div>
              )}
            </div>

            <div {...panelProps('instructions')}>
              <Field
                id="workspace-instructions"
                label={
                  <>
                    Instructions <span className="font-normal text-ink-3">· optional</span>
                  </>
                }
                hint="Added to the agent's prompt in every chat here."
              >
                <InstructionsEditor
                  id="workspace-instructions"
                  value={instructions}
                  onChange={setInstructions}
                  hasError={Boolean(errors.instructions)}
                  describedBy="workspace-instructions-hint"
                  workspaceName={name}
                  folderPath={folderPath}
                />
                {errors.instructions && (
                  <p role="alert" className={ERROR}>
                    {errors.instructions}
                  </p>
                )}
                <p
                  id="workspace-instructions-hint"
                  className={`${HINT} flex flex-wrap justify-between gap-x-4`}
                >
                  <span>Memories are kept separately for each workspace.</span>
                  <span className="tabular-nums">
                    {instructions.length.toLocaleString('en')} /{' '}
                    {LIMITS.instructions.toLocaleString('en')}
                  </span>
                </p>
              </Field>
            </div>

            <div {...panelProps('agent')}>
              <Field
                id="workspace-planning"
                label="Planning"
                hint="A short step before each message decides whether to plan first. Off saves one model call per message."
              >
                <PlanningChoice
                  id="workspace-planning"
                  value={planning}
                  onChange={setPlanning}
                  isPlansOff={disabledTools.includes('plans')}
                />
              </Field>

              <Field
                id="workspace-tools"
                label="Tools"
                hint="Turn off what this workspace doesn't need: every message gets smaller. The clock and calculator are always on; attachment, skill and MCP tools come when needed."
              >
                <div id="workspace-tools">
                  <ToolGroupSwitches disabled={disabledTools} onChange={setDisabledTools} />
                </div>
              </Field>

              <Field
                id="workspace-panel-tabs"
                label="Side panel tabs"
                hint="Extra tabs for the side panel. Files and Tasks always show."
              >
                <div id="workspace-panel-tabs">
                  <PanelTabSwitches
                    tabs={[
                      {
                        label: 'Terminal',
                        detail: 'A shell in the workspace folder',
                        isOn: hasTerminalTab,
                        onChange: setHasTerminalTab,
                      },
                      {
                        label: 'Git diff',
                        detail: 'What changed since the last commit',
                        isOn: hasGitTab,
                        onChange: setHasGitTab,
                      },
                    ]}
                  />
                </div>
              </Field>
            </div>

            <div {...panelProps('voice')}>
              <Field
                id="workspace-chat-mode"
                label="Chat mode"
                hint="Voice: talk with the agent and hear its replies, instead of the message box."
              >
                <ChatModeChoice
                  id="workspace-chat-mode"
                  isVoice={voiceMode}
                  onChange={setVoiceMode}
                />
                <p className={HINT}>
                  {voiceMode
                    ? 'Tap the mic once and talk; when you pause, it sends what you said and reads the reply aloud, then listens again. Replies are kept short for listening. Uses the browser’s speech recognition (Chrome, Edge or Safari; Chrome turns speech into text on Google’s servers).'
                    : 'Type messages in the message box. Switch to Voice to choose a microphone and voice.'}
                </p>
                {voiceMode && <VoiceSettings value={voicePrefs} onChange={changeVoicePrefs} />}
              </Field>
            </div>

            <div {...panelProps('mcp')}>
              <Field
                id="workspace-mcp"
                label="MCP servers"
                hint="Which of the app's MCP servers this workspace uses. Their tools load only when a task needs them."
              >
                <div id="workspace-mcp">
                  {mcpError ? (
                    <p role="alert" className={ERROR}>
                      {mcpError}
                    </p>
                  ) : !mcpServers ? (
                    <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-3">
                      <Spinner size={13} /> Loading MCP servers…
                    </div>
                  ) : mcpServers.length === 0 ? (
                    <p className="mt-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-[13px] text-ink-3">
                      No MCP servers set up yet. Add them in Settings → MCP servers, then turn them
                      on here.
                    </p>
                  ) : (
                    <>
                      <McpServerSwitches
                        servers={mcpServers}
                        enabled={mcpEnabled}
                        onChange={setMcpEnabled}
                      />
                      <p className={HINT}>
                        {isMcpTrusted
                          ? 'Set up and edited once for the whole app in Settings → MCP servers.'
                          : "This workspace's mcp.json changed outside the app: approve it in the MCP tab before these start."}
                      </p>
                    </>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </form>
      )}

      <FormActions>
        <Button onClick={() => navigate(backTo)}>Cancel</Button>
        <Button
          variant="primary"
          type="submit"
          form="workspace-form"
          disabled={isSaving || isLoading}
        >
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </Button>
      </FormActions>

      {isPickerOpen && (
        <FolderPicker startAt={folderPath.trim()} onPick={pickFolder} onClose={closePicker} />
      )}

      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this workspace?"
          message={
            <>
              All chats, memories and instructions of{' '}
              <strong className="text-ink">{loaded?.name}</strong> are deleted (its{' '}
              <code className="font-mono text-[12px]">.nimbrio-ai</code> folder). Its other files
              stay in <code className="font-mono text-[12px]">{loaded?.path}</code>.
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
