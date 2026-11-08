import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ModelProfile, ReasoningEffort } from '@app/shared';
import { Badge } from '../../components/Badge';
import { ChevronRightIcon, GearIcon, PlusIcon, SparkIcon } from '../../lib/icons';
import { serverLabel } from '../models/servers';
import { ComposerMenu, ComposerMenuItem } from './ComposerMenu';
import type { ModelChoice } from './useModelChoice';

const EFFORTS: { value: ReasoningEffort | null; label: string; detail: string }[] = [
  { value: null, label: 'Auto', detail: "The model server's default" },
  { value: 'low', label: 'Low', detail: 'Quick answers, the fewest thinking tokens' },
  { value: 'medium', label: 'Medium', detail: 'Balanced speed and depth' },
  { value: 'high', label: 'High', detail: 'Thinks longest: slower and costs more' },
];

const FOOTER_LINK =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink-2 outline-none transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle';

const ROW =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle';

/**
 * One chip for the model the next message goes to and, for reasoning models, how hard it
 * thinks. Its menu has a Reasoning and a Model row, each opening its own list.
 * With no model set up yet, a link to add one instead.
 */
export function ModelControls({
  models,
  choice,
  disabled,
  onChooseModel,
  onChooseEffort,
}: {
  /** Null while loading. */
  models: ModelProfile[] | null;
  choice: ModelChoice;
  disabled: boolean;
  onChooseModel: (id: string) => void;
  onChooseEffort: (effort: ReasoningEffort | null) => void;
}) {
  const { pathname } = useLocation();
  const { model, effort } = choice;

  if (models && models.length === 0) {
    return (
      <Link
        to="/settings/models/new"
        state={{ from: pathname }}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent-2 transition-colors hover:bg-accent-bg"
      >
        <PlusIcon size={11} /> Add a model to start
      </Link>
    );
  }
  if (!models || !model) return <span className="h-7" />;

  const effortLabel = EFFORTS.find((option) => option.value === effort)?.label ?? 'Auto';

  return (
    <ComposerMenu
      label={
        <>
          {model.name}
          {model.supportsReasoning && <span className="text-ink-3"> {effortLabel}</span>}
        </>
      }
      icon={<SparkIcon size={12} className="shrink-0 text-accent" />}
      title={`${model.model} at ${serverLabel(model.baseUrl)}${
        model.supportsReasoning ? ` · reasoning effort: ${effortLabel}` : ''
      }`}
      menuLabel="Model"
      showHeading={false}
      disabled={disabled}
      className="max-w-[min(260px,48vw)]"
      footer={(close) => (
        <Link
          to="/settings/models"
          state={{ from: pathname }}
          role="menuitem"
          onClick={close}
          className={FOOTER_LINK}
        >
          <GearIcon size={13} className="text-ink-3" /> Manage models
        </Link>
      )}
    >
      {(close) => (
        <ModelMenuBody
          models={models}
          model={model}
          effort={effort}
          effortLabel={effortLabel}
          onChooseModel={(id) => {
            onChooseModel(id);
            close();
          }}
          onChooseEffort={(value) => {
            onChooseEffort(value);
            close();
          }}
        />
      )}
    </ComposerMenu>
  );
}

type View = 'root' | 'model' | 'effort';

/**
 * The open menu. Mounted each time it opens, so it always starts at the top level.
 * A model without reasoning effort has nothing else to set, so it opens on the models.
 */
function ModelMenuBody({
  models,
  model,
  effort,
  effortLabel,
  onChooseModel,
  onChooseEffort,
}: {
  models: ModelProfile[];
  model: ModelProfile;
  effort: ReasoningEffort | null;
  effortLabel: string;
  onChooseModel: (id: string) => void;
  onChooseEffort: (effort: ReasoningEffort | null) => void;
}) {
  const [view, setView] = useState<View>(model.supportsReasoning ? 'root' : 'model');
  const ref = useRef<HTMLDivElement>(null);
  const isFirstView = useRef(true);

  // Moving between levels: focus the chosen item (or the first), as on opening.
  useEffect(() => {
    if (isFirstView.current) {
      isFirstView.current = false;
      return;
    }
    const body = ref.current;
    const item =
      body?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      body?.querySelector<HTMLElement>('[role^="menuitem"]');
    item?.focus();
  }, [view]);

  return (
    <div ref={ref}>
      {view === 'root' && (
        <>
          <SubmenuRow label="Reasoning" value={effortLabel} onOpen={() => setView('effort')} />
          <SubmenuRow label="Model" value={model.name} onOpen={() => setView('model')} />
        </>
      )}

      {view !== 'root' && model.supportsReasoning && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => setView('root')}
            className={`${ROW} text-ink-3 hover:text-ink`}
          >
            <ChevronRightIcon size={12} className="shrink-0 rotate-180" />
            {view === 'effort' ? 'Reasoning' : 'Model'}
          </button>
          <div className="my-1 h-px bg-line-2" />
        </>
      )}

      {view === 'effort' &&
        EFFORTS.map((option) => (
          <ComposerMenuItem
            key={option.label}
            isSelected={option.value === effort}
            onSelect={() => onChooseEffort(option.value)}
            title={option.label}
            detail={option.detail}
          />
        ))}

      {view === 'model' &&
        models.map((item) => (
          <ComposerMenuItem
            key={item.id}
            isSelected={item.id === model.id}
            onSelect={() => onChooseModel(item.id)}
            title={item.name}
            detail={<span className="font-mono">{item.model}</span>}
            badge={
              <>
                {item.isDefault && <Badge>default</Badge>}
                {item.supportsReasoning && <Badge tone="blue">reasoning</Badge>}
              </>
            }
          />
        ))}
    </div>
  );
}

/** A top-level row: what it sets, its current value, and an arrow into its list. */
function SubmenuRow({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`${ROW} text-ink-2 hover:text-ink`}
    >
      <span className="flex-1">{label}</span>
      <span className="min-w-0 truncate text-ink-3">{value}</span>
      <ChevronRightIcon size={12} className="shrink-0 text-ink-3" />
    </button>
  );
}
