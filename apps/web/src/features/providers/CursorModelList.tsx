import { useCallback, useMemo, useState } from 'react';
import type { ModelProfile, ProviderModel } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { CheckIcon, PlusIcon, RefreshIcon, SearchIcon } from '../../lib/icons';
import { useAsync } from '../../lib/useAsync';
import { useToast } from '../../lib/toast';
import { createModel, fetchModels } from '../models/api';
import { fetchCursorModels } from './api';

const windowLabel = (tokens: number) =>
  tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1_000)}K`;

/**
 * The models the signed-in Cursor account can use, each with Add: that saves it under
 * Settings → Models (provider `cursor`), so the composer can pick it like any other.
 */
export function CursorModelList() {
  const toast = useToast();
  const available = useAsync(fetchCursorModels);
  const saved = useAsync(fetchModels);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const { setData: setSaved } = saved;

  const addedIds = useMemo(
    () => new Set((saved.data ?? []).filter((m) => m.provider === 'cursor').map((m) => m.model)),
    [saved.data],
  );

  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const list = available.data ?? [];
    return wanted ? list.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(wanted)) : list;
  }, [available.data, query]);

  const add = useCallback(
    async (model: ProviderModel) => {
      setAdding(model.id);
      try {
        const created = await createModel({
          name: model.name,
          model: model.id,
          provider: 'cursor',
          contextWindow: model.contextWindow,
          supportsReasoning: model.supportsReasoning,
        });
        setSaved((list: ModelProfile[] | null) => [...(list ?? []), created]);
        toast(`${model.name} added to Models`);
      } catch (cause) {
        toast(errorMessage(cause, `Couldn't add ${model.name}.`), 'error');
      } finally {
        setAdding(null);
      }
    },
    [setSaved, toast],
  );

  return (
    <section className="mt-6" aria-labelledby="cursor-models">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="cursor-models" className="text-[14px] font-semibold text-ink">
          Cursor models
        </h2>
        {available.data && (
          <span className="text-[12px] text-ink-3">{available.data.length} available</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="relative block">
            <span className="sr-only">Search Cursor models</span>
            <SearchIcon
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-44 rounded-lg border border-line bg-surface pl-8 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>
          <Button
            size="sm"
            onClick={available.reload}
            disabled={available.isLoading}
            aria-label="Reload the list from Cursor"
            title="Reload the list from Cursor"
          >
            {available.isLoading ? <Spinner size={12} /> : <RefreshIcon size={12} />}
          </Button>
        </div>
      </div>

      {!available.data && available.error ? (
        <p
          role="alert"
          className="border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
        >
          {errorMessage(available.error, "Couldn't load Cursor's models.")}
        </p>
      ) : !available.data ? (
        <PageLoader />
      ) : shown.length === 0 ? (
        <p className="panel px-5 py-6 text-center text-[13px] text-ink-3">
          No model matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="panel divide-y divide-line-2">
          {shown.map((model) => {
            const isAdded = addedIds.has(model.id);
            return (
              <li key={model.id} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{model.name}</span>
                    {model.supportsReasoning && <Badge>reasoning effort</Badge>}
                    {model.supportsImages && <Badge>images</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[12px] text-ink-3">
                    {model.id}
                    {model.contextWindow !== null &&
                      ` · ${windowLabel(model.contextWindow)} context`}
                  </p>
                </div>
                {isAdded ? (
                  <Badge tone="green" icon={<CheckIcon size={11} />}>
                    added
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => void add(model)}
                    disabled={adding !== null || !saved.data}
                  >
                    {adding === model.id ? <Spinner size={12} /> : <PlusIcon size={12} />}
                    Add
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
