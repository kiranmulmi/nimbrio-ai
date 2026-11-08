import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { mcpServerInputSchema } from '@app/shared';
import { Button } from '../../components/Button';
import { CodeText } from '../../components/CodeText';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL, SECTION } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage, isNotFound } from '../../lib/api';
import { TrashIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { addMcpServer, deleteMcpServer, fetchMcpServer, replaceMcpServer } from './api';
import { parseServerJson, TEMPLATES, toJson } from './serverForm';
import { APP_NAME } from '../../lib/brand';

const JSON_PLACEHOLDER = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" }
}`;

/** Shared by the textarea and its coloured copy, so their text lines up exactly. */
const JSON_EDITOR =
  'whitespace-pre-wrap font-mono text-[13px] leading-relaxed [overflow-wrap:break-word] [scrollbar-gutter:stable] [tab-size:2]';

/**
 * Add or edit one of the app's MCP servers: `/settings/mcp/new` and
 * `/settings/mcp/:serverName/edit`. The server is edited as the JSON entry other MCP clients
 * use. Each workspace then turns it on or off in its MCP tab. Deleting lives here too.
 */
export function McpServerFormPage() {
  const { serverName } = useParams();
  const isEdit = serverName !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? '/settings/mcp';

  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const highlightRef = useRef<HTMLPreElement>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  usePageHeader({
    title: isEdit ? 'Edit MCP server' : 'Add MCP server',
    subtitle:
      'Set up once for every workspace. It stays off until you turn it on in a workspace’s MCP tab.',
    breadcrumbs: [
      { label: APP_NAME, to: '/' },
      { label: 'MCP servers', to: '/settings/mcp' },
      { label: isEdit ? (serverName ?? '') : 'New server' },
    ],
  });

  useEffect(() => {
    if (!serverName) return;
    let isCurrent = true;
    setIsLoading(true);
    fetchMcpServer(serverName)
      .then((entry) => {
        if (!isCurrent) return;
        setName(entry.name);
        setJson(toJson(entry.server));
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(
          isNotFound(cause)
            ? errorMessage(cause, 'That MCP server no longer exists.')
            : errorMessage(cause, "Couldn't load the MCP server."),
          isNotFound(cause) ? 'warning' : 'error',
        );
        navigate(backTo, { replace: true });
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [serverName, backTo, navigate, toast]);

  /** A pasted README snippet becomes the server's own object, and brings its name along. */
  const tidy = (text: string) => {
    const parsed = parseServerJson(text);
    if ('error' in parsed) {
      if (text.trim()) setJsonError(parsed.error);
      return;
    }
    setJsonError(null);
    setJson(toJson(parsed.server));
    if (parsed.name && !name.trim()) {
      setName(parsed.name);
      setNameError(null);
    }
    if (parsed.skipped) {
      toast(`Kept the first server. Add the other ${parsed.skipped} one by one.`, 'warning');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseServerJson(json);
    const finalName = name.trim() || ('server' in parsed ? (parsed.name ?? '') : '');
    const checked = mcpServerInputSchema.safeParse({
      name: finalName,
      server: 'server' in parsed ? parsed.server : {},
    });
    const badName = checked.success
      ? null
      : (checked.error.issues.find((issue) => issue.path[0] === 'name')?.message ?? null);
    setNameError(badName);
    setJsonError('error' in parsed ? parsed.error : null);
    if (!checked.success || 'error' in parsed) return;

    setIsSaving(true);
    try {
      if (serverName) await replaceMcpServer(serverName, checked.data);
      else await addMcpServer(checked.data);
      toast(isEdit ? 'MCP server saved' : 'MCP server added');
      navigate(backTo);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the MCP server."), 'error');
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!serverName) return;
    setIsDeleting(true);
    try {
      await deleteMcpServer(serverName);
      toast('MCP server deleted');
      navigate(backTo, { replace: true });
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the MCP server."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  if (isLoading) return <PageLoader />;

  return (
    <div className="w-full">
      <form id="mcp-form" noValidate onSubmit={(event) => void submit(event)} className="panel">
        <div className="border-b border-line bg-subtle px-5 py-3 sm:px-6">
          <h2 className="text-[15px] font-bold text-ink">Server</h2>
          <p className="text-[13px] text-ink-3">
            Saved in this workspace&apos;s <span className="font-mono">.nimbrio-ai/mcp.json</span>,
            in the format other MCP apps use.
          </p>
        </div>

        <div className="flex flex-col divide-y divide-line-2">
          <div className={SECTION}>
            <label htmlFor="mcp-name" className={LABEL}>
              Name
            </label>
            <input
              id="mcp-name"
              value={name}
              autoFocus={!isEdit}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              placeholder="github"
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              className={`${INPUT} ${nameError ? INPUT_ERROR : INPUT_OK} max-w-[32ch] font-mono text-[13px]`}
            />
            {nameError && (
              <p role="alert" className={ERROR}>
                {nameError}
              </p>
            )}
            <p className={HINT}>
              Letters, digits, - and _. Its tools show up as{' '}
              <span className="font-mono">mcp__{name.trim() || 'name'}__tool</span>.
            </p>
          </div>

          <div className={SECTION}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label htmlFor="mcp-json" className={LABEL}>
                Configuration <span className="font-normal text-ink-3">· JSON</span>
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {!isEdit &&
                  TEMPLATES.map((template) => (
                    <Button
                      key={template.label}
                      size="sm"
                      variant="plain"
                      onClick={() => {
                        setJson(toJson(template.server));
                        setJsonError(null);
                      }}
                    >
                      {template.label}
                    </Button>
                  ))}
                <Button size="sm" onClick={() => tidy(json)} disabled={!json.trim()}>
                  Format
                </Button>
              </div>
            </div>
            <div className="relative">
              {/* The coloured copy sits behind a see-through textarea and scrolls with it. */}
              <pre
                ref={highlightRef}
                aria-hidden
                className={`${JSON_EDITOR} pointer-events-none absolute inset-x-0 bottom-0 top-2 m-0 overflow-hidden rounded-lg border border-transparent bg-surface px-3 py-2 text-ink`}
              >
                <CodeText text={json} language="json" />
                {'\n'}
              </pre>
              <textarea
                id="mcp-json"
                rows={14}
                value={json}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={JSON_PLACEHOLDER}
                aria-invalid={jsonError ? true : undefined}
                aria-describedby="mcp-json-hint"
                onChange={(event) => {
                  setJson(event.target.value);
                  setJsonError(null);
                }}
                onPaste={(event) => {
                  // Pasting over everything (or into an empty box): take the snippet as a whole.
                  const box = event.currentTarget;
                  if (box.selectionStart !== 0 || box.selectionEnd !== box.value.length) return;
                  event.preventDefault();
                  const text = event.clipboardData.getData('text');
                  setJson(text);
                  tidy(text);
                }}
                onBlur={() => tidy(json)}
                onScroll={(event) => {
                  const highlight = highlightRef.current;
                  if (!highlight) return;
                  highlight.scrollTop = event.currentTarget.scrollTop;
                  highlight.scrollLeft = event.currentTarget.scrollLeft;
                }}
                className={`${INPUT} ${jsonError ? INPUT_ERROR : INPUT_OK} ${JSON_EDITOR} relative min-h-[220px] resize-y caret-ink !bg-transparent !text-[13px] ${
                  json ? '[-webkit-text-fill-color:transparent]' : ''
                }`}
              />
            </div>
            {jsonError && (
              <p role="alert" className={ERROR}>
                {jsonError}
              </p>
            )}
            <div id="mcp-json-hint" className={`${HINT} grid gap-1`}>
              <p>
                Paste a server&apos;s <span className="font-mono">mcpServers</span> snippet from its
                README as it is: it&apos;s unwrapped to this server, with its name.
              </p>
              <p>
                Local: <span className="font-mono">command</span>,{' '}
                <span className="font-mono">args</span>, <span className="font-mono">env</span>.
                Remote: <span className="font-mono">url</span>,{' '}
                <span className="font-mono">headers</span> (and{' '}
                <span className="font-mono">&quot;type&quot;: &quot;sse&quot;</span> for older
                servers). Optional: <span className="font-mono">autoApprove</span> (tool names that
                run without asking).
              </p>
            </div>
          </div>

          <div className={`${SECTION} bg-subtle`}>
            <p className="text-[13px] leading-relaxed text-ink-3">
              A local server runs its command in the folder of each workspace that turns it on, with
              only the variables in <span className="font-mono">env</span> plus basics like PATH and
              HOME, never this app&apos;s own keys. Keys and tokens in it are saved in
              ~/.nimbrio-ai/mcp-servers.json, readable only by you, not in your project folders.
            </p>
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
        <Button variant="primary" type="submit" form="mcp-form" disabled={isSaving}>
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Add server'}
        </Button>
      </FormActions>

      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this MCP server?"
          message={
            <>
              <strong className="font-mono text-ink">{serverName}</strong> is removed from every
              workspace and stopped. The agent loses its tools from your next message.
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
