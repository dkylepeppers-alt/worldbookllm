import {
  createPresetSchema,
  type CreatePreset,
  type Preset,
  type PresetModule,
} from '@worldbookllm/shared';
import { Fragment, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { PresetImportDialog } from './PresetImportDialog.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; presets: Preset[]; defaultId: string };
type Draft = Pick<Preset, 'name' | 'generation' | 'modules'>;

const sourcesModule: PresetModule = {
  key: 'sources',
  name: 'Selected sources',
  kind: 'sources',
  role: 'system',
  content: null,
  enabled: true,
  insertion: { position: 'before_history' },
};

function minimalPreset(name = 'Untitled preset'): CreatePreset {
  return {
    schemaVersion: 1,
    name,
    generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
    modules: [sourcesModule],
  };
}

function draftOf(preset: Preset): Draft {
  return {
    name: preset.name,
    generation: { ...preset.generation },
    modules: preset.modules.map((module) => ({ ...module, insertion: { ...module.insertion } })),
  };
}

function sameDraft(draft: Draft | null, preset: Preset | undefined): boolean {
  return (
    draft !== null &&
    preset !== undefined &&
    JSON.stringify(draft) === JSON.stringify(draftOf(preset))
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function PresetsPage() {
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<CreatePreset | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);

  function beginOperation(): number | null {
    if (busyRef.current) return null;
    busyRef.current = true;
    const operation = ++operationRef.current;
    setBusy(true);
    return operation;
  }

  function finishOperation(operation: number) {
    if (operationRef.current !== operation) return;
    busyRef.current = false;
    setBusy(false);
  }

  useEffect(
    () => () => {
      operationRef.current += 1;
      busyRef.current = false;
    },
    [],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [presets, settings] = await Promise.all([
        api.listPresets(signal),
        api.getAppSettings(signal),
      ]);
      return { presets, defaultId: settings.defaultPresetId };
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then(({ presets, defaultId }) => {
        setState({ status: 'ready', presets, defaultId });
        const first = presets.find((item) => item.id === defaultId) ?? presets[0];
        selectedIdRef.current = first?.id ?? null;
        setSelectedId(first?.id ?? null);
        setDraft(first === undefined ? null : draftOf(first));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [load, reload]);

  const selected =
    state.status === 'ready' ? state.presets.find((item) => item.id === selectedId) : undefined;
  const dirty = !sameDraft(draft, selected);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  function select(id: string) {
    if (busyRef.current) return;
    if (id === selectedId) return;
    if (dirty) {
      setPendingId(id);
      return;
    }
    choose(id);
  }

  function choose(id: string) {
    if (busyRef.current) return;
    if (state.status !== 'ready') return;
    const preset = state.presets.find((item) => item.id === id);
    if (preset === undefined) return;
    selectedIdRef.current = id;
    setSelectedId(id);
    setDraft(draftOf(preset));
    setErrors([]);
    setPendingId(null);
  }

  function addCreated(created: Preset) {
    setState((current) =>
      current.status === 'ready' ? { ...current, presets: [...current.presets, created] } : current,
    );
    selectedIdRef.current = created.id;
    setSelectedId(created.id);
    setDraft(draftOf(created));
    setImporting(false);
    setErrors([]);
  }

  async function create(force = false) {
    if (!force && dirty && selected !== undefined) {
      setPendingId('__create__');
      return;
    }
    const operation = beginOperation();
    if (operation === null) return;
    setErrors([]);
    try {
      const created = await api.createPreset(minimalPreset());
      if (operationRef.current === operation) addCreated(created);
    } catch (error) {
      setErrors([errorMessage(error, 'Could not create a preset.')]);
    } finally {
      finishOperation(operation);
    }
  }

  async function importPreset(input: CreatePreset) {
    setImportError(null);
    if (dirty && selected !== undefined) {
      setPendingImport(input);
      return;
    }
    const operation = beginOperation();
    if (operation === null) return;
    try {
      const created = await api.createPreset(input);
      if (operationRef.current === operation) addCreated(created);
    } finally {
      finishOperation(operation);
    }
  }

  async function confirmImport() {
    if (pendingImport === null) return;
    const input = pendingImport;
    const operation = beginOperation();
    if (operation === null) return;
    setImportError(null);
    try {
      const created = await api.createPreset(input);
      if (operationRef.current !== operation) return;
      addCreated(created);
      setPendingImport(null);
    } catch (error) {
      setPendingImport(null);
      setImportError(errorMessage(error, 'Could not import this preset.'));
    } finally {
      finishOperation(operation);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || draft === null || selected === undefined) return;
    const targetId = selected.id;
    const parsed = createPresetSchema.safeParse({ schemaVersion: 1, ...draft });
    if (!parsed.success) {
      setErrors(
        parsed.error.issues.map((issue) => `${issue.path.join('.') || 'preset'}: ${issue.message}`),
      );
      return;
    }
    const operation = beginOperation();
    if (operation === null) return;
    setErrors([]);
    try {
      const updated = await api.updatePreset(targetId, {
        name: parsed.data.name,
        generation: parsed.data.generation,
        modules: parsed.data.modules,
      });
      if (operationRef.current !== operation || updated.id !== targetId) return;
      setState((current) =>
        current.status === 'ready'
          ? {
              ...current,
              presets: current.presets.map((item) => (item.id === targetId ? updated : item)),
            }
          : current,
      );
      if (selectedIdRef.current === targetId) setDraft(draftOf(updated));
    } catch (error) {
      if (operationRef.current !== operation || selectedIdRef.current !== targetId) return;
      if (error instanceof ApiClientError && error.issues !== undefined)
        setErrors(error.issues.map((issue) => issue.message));
      else setErrors([errorMessage(error, 'Could not save this preset.')]);
    } finally {
      finishOperation(operation);
    }
  }

  async function makeDefault() {
    if (selected === undefined || state.status !== 'ready') return;
    const operation = beginOperation();
    if (operation === null) return;
    setErrors([]);
    try {
      const settings = await api.updateAppSettings({ defaultPresetId: selected.id });
      setState({ ...state, defaultId: settings.defaultPresetId });
    } catch (error) {
      setErrors([errorMessage(error, 'Could not change the global default.')]);
    } finally {
      finishOperation(operation);
    }
  }

  async function remove() {
    if (selected === undefined || state.status !== 'ready') return;
    const targetId = selected.id;
    const operation = beginOperation();
    if (operation === null) return;
    setErrors([]);
    try {
      await api.deletePreset(targetId);
      if (operationRef.current !== operation) return;
      const presets = state.presets.filter((item) => item.id !== targetId);
      const next = presets.find((item) => item.id === state.defaultId) ?? presets[0];
      setState({ ...state, presets });
      if (selectedIdRef.current === targetId) {
        selectedIdRef.current = next?.id ?? null;
        setSelectedId(next?.id ?? null);
        setDraft(next === undefined ? null : draftOf(next));
      }
      setDeleting(false);
    } catch (error) {
      setDeleting(false);
      setErrors([errorMessage(error, 'Could not delete this preset.')]);
    } finally {
      finishOperation(operation);
    }
  }

  function updateModule(index: number, update: (module: PresetModule) => PresetModule) {
    if (busyRef.current) return;
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            modules: current.modules.map((module, at) => (at === index ? update(module) : module)),
          },
    );
  }
  function move(from: number, to: number) {
    if (busyRef.current) return;
    setDraft((current) => {
      if (current === null || to < 0 || to >= current.modules.length || from === to) return current;
      const modules = [...current.modules];
      const [item] = modules.splice(from, 1);
      if (item !== undefined) modules.splice(to, 0, item);
      return { ...current, modules };
    });
  }
  function addModule() {
    if (busyRef.current || draft === null) return;
    const used = new Set(draft.modules.map((module) => module.key));
    let suffix = 1;
    while (used.has(`custom-${suffix}`)) suffix += 1;
    setDraft({
      ...draft,
      modules: [
        ...draft.modules,
        {
          key: `custom-${suffix}`,
          name: 'Custom module',
          kind: 'custom',
          role: 'system',
          content: '',
          enabled: false,
          insertion: { position: 'before_history' },
        },
      ],
    });
  }

  if (state.status === 'loading') return <LoadingState>Charting preset library…</LoadingState>;
  if (state.status === 'error')
    return (
      <ErrorState
        title="Could not load presets"
        message="The preset library or app settings could not be loaded."
        onRetry={() => {
          setState({ status: 'loading' });
          setReload((value) => value + 1);
        }}
      />
    );

  return (
    <section className="presets-page" aria-labelledby="presets-title">
      <header className="page-intro">
        <p className="coordinate-label">Prompt strategy · generation controls</p>
        <h1 id="presets-title">Preset studio</h1>
        <p>
          Shape reusable instructions and see how they assemble around sources and conversation
          history.
        </p>
      </header>
      <div className="preset-toolbar">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => void create()}
        >
          Create preset
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => setImporting(true)}
        >
          Import preset
        </button>
      </div>
      {errors.length === 0 ? null : (
        <ul className="field-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {state.presets.length === 0 ? (
        <div className="empty-map">
          <p>No presets are charted yet.</p>
        </div>
      ) : (
        <div className="preset-studio-grid">
          <aside className="preset-library" aria-label="Preset library">
            <h2>Library</h2>
            <ul>
              {state.presets.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className={item.id === selectedId ? 'active' : ''}
                    aria-label={`Select ${item.name}`}
                    onClick={() => select(item.id)}
                  >
                    <span>{item.name}</span>
                    {item.id === state.defaultId ? <small>Global default</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          {draft === null || selected === undefined ? null : (
            <PresetEditor
              key={selected.id}
              draft={draft}
              setDraft={setDraft}
              isDefault={selected.id === state.defaultId}
              busy={busy}
              onSave={save}
              onDefault={() => void makeDefault()}
              onDelete={() => setDeleting(true)}
              addModule={addModule}
              updateModule={updateModule}
              move={move}
              dragIndex={dragIndex}
              setDragIndex={setDragIndex}
            />
          )}
        </div>
      )}
      {deleting && selected !== undefined ? (
        <ConfirmDialog
          title="Delete preset?"
          confirmLabel="Delete preset permanently"
          busy={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={() => void remove()}
        >
          <p>
            Delete <strong>{selected.name}</strong>? Chats using it will inherit the global default.
          </p>
        </ConfirmDialog>
      ) : null}
      {importing ? (
        <PresetImportDialog
          onClose={() => {
            setImporting(false);
            setImportError(null);
          }}
          onSave={importPreset}
          externalError={importError}
        />
      ) : null}
      {pendingId === null && pendingImport === null ? null : (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard changes"
          onCancel={() => {
            setPendingId(null);
            setPendingImport(null);
          }}
          busy={busy}
          busyLabel={pendingImport === null ? 'Working…' : 'Importing…'}
          onConfirm={() => {
            const target = pendingId;
            setPendingId(null);
            if (pendingImport !== null) {
              void confirmImport();
              return;
            }
            if (target === '__create__') {
              setDraft(selected === undefined ? null : draftOf(selected));
              void create(true);
            } else if (target !== null) choose(target);
          }}
        >
          <p>Your unsaved preset edits will be lost.</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setPendingId(null);
              setPendingImport(null);
            }}
          >
            Keep editing
          </button>
        </ConfirmDialog>
      )}
    </section>
  );
}

interface EditorProps {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  isDefault: boolean;
  busy: boolean;
  onSave: (event: FormEvent) => void;
  onDefault: () => void;
  onDelete: () => void;
  addModule: () => void;
  updateModule: (index: number, update: (module: PresetModule) => PresetModule) => void;
  move: (from: number, to: number) => void;
  dragIndex: number | null;
  setDragIndex: (index: number | null) => void;
}

function PresetEditor(props: EditorProps) {
  const { draft, setDraft } = props;
  const [topPEnabled, setTopPEnabled] = useState(draft.generation.topP !== null);
  const [maxTokensEnabled, setMaxTokensEnabled] = useState(draft.generation.maxTokens !== null);
  const preview = useMemo(() => draft.modules.filter((module) => module.enabled), [draft.modules]);
  const setGeneration = (value: Partial<Draft['generation']>) => {
    if (props.busy) return;
    setDraft((current) =>
      current === null ? current : { ...current, generation: { ...current.generation, ...value } },
    );
  };
  return (
    <form className="preset-editor" onSubmit={(event) => void props.onSave(event)}>
      <section className="preset-card">
        <h2>Definition</h2>
        <label htmlFor="preset-name">Preset name</label>
        <input
          id="preset-name"
          disabled={props.busy}
          maxLength={200}
          value={draft.name}
          onChange={(event) => {
            if (props.busy) return;
            setDraft((current) =>
              current === null ? current : { ...current, name: event.target.value },
            );
          }}
        />
        <div className="generation-grid">
          <label>
            Temperature
            <input
              aria-label="Temperature"
              type="number"
              disabled={props.busy}
              min="0"
              max="2"
              step="0.05"
              value={draft.generation.temperature}
              onChange={(event) => setGeneration({ temperature: Number(event.target.value) })}
            />
          </label>
          <NullableNumber
            label="Top P"
            disabled={props.busy}
            enabled={topPEnabled}
            value={draft.generation.topP}
            min="0.01"
            max="1"
            step="0.01"
            onEnabled={(enabled) => {
              setTopPEnabled(enabled);
              setGeneration({ topP: enabled ? 1 : null });
            }}
            onChange={(value) => setGeneration({ topP: value })}
          />
          <NullableNumber
            label="Max tokens"
            disabled={props.busy}
            enabled={maxTokensEnabled}
            value={draft.generation.maxTokens}
            min="1"
            max="131072"
            step="1"
            onEnabled={(enabled) => {
              setMaxTokensEnabled(enabled);
              setGeneration({ maxTokens: enabled ? 1024 : null });
            }}
            onChange={(value) =>
              setGeneration({ maxTokens: value === null ? null : Math.floor(value) })
            }
          />
        </div>
        <label className="nullable-toggle">
          <input
            aria-label="Enable assistant prefill"
            type="checkbox"
            disabled={props.busy}
            checked={draft.generation.assistantPrefill !== null}
            onChange={(event) =>
              setGeneration({ assistantPrefill: event.target.checked ? '' : null })
            }
          />{' '}
          Assistant prefill (provider-dependent)
        </label>
        {draft.generation.assistantPrefill === null ? null : (
          <textarea
            aria-label="Assistant prefill"
            disabled={props.busy}
            maxLength={32768}
            value={draft.generation.assistantPrefill}
            onChange={(event) => setGeneration({ assistantPrefill: event.target.value })}
          />
        )}
      </section>
      <section className="preset-card">
        <header className="region-header">
          <h2>Modules</h2>
          <button
            type="button"
            className="button-secondary"
            disabled={props.busy}
            onClick={props.addModule}
          >
            Add custom module
          </button>
        </header>
        <ol className="module-list">
          {draft.modules.map((module, index) => (
            <ModuleEditor
              key={`${module.key}-${index}`}
              module={module}
              index={index}
              count={draft.modules.length}
              busy={props.busy}
              update={(update) => props.updateModule(index, update)}
              remove={() =>
                props.busy
                  ? undefined
                  : setDraft((current) =>
                      current === null
                        ? current
                        : { ...current, modules: current.modules.filter((_, at) => at !== index) },
                    )
              }
              move={props.move}
              setDragIndex={props.setDragIndex}
              onDrop={() => {
                if (props.dragIndex !== null) props.move(props.dragIndex, index);
                props.setDragIndex(null);
              }}
            />
          ))}
        </ol>
      </section>
      <AssemblyPreview modules={preview} />
      <div className="preset-actions">
        <button type="submit" className="button-primary" disabled={props.busy}>
          Save changes
        </button>
        {props.isDefault ? (
          <>
            <span className="active-marker">Global default</span>
            <button type="button" className="button-danger" disabled>
              Delete preset
            </button>
            <small>The global default cannot be deleted.</small>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button-secondary"
              disabled={props.busy}
              onClick={props.onDefault}
            >
              Make global default
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={props.busy}
              onClick={props.onDelete}
            >
              Delete preset
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function NullableNumber({
  label,
  disabled,
  enabled,
  value,
  onEnabled,
  onChange,
  ...input
}: {
  label: string;
  disabled: boolean;
  enabled: boolean;
  value: number | null;
  onEnabled: (enabled: boolean) => void;
  onChange: (value: number | null) => void;
  min: string;
  max: string;
  step: string;
}) {
  return (
    <div>
      <label className="nullable-toggle">
        <input
          aria-label={`Enable ${label}`}
          type="checkbox"
          disabled={disabled}
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />{' '}
        {label}
      </label>
      {enabled ? (
        <input
          aria-label={label}
          type="number"
          disabled={disabled}
          {...input}
          value={value ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
        />
      ) : null}
    </div>
  );
}

function ModuleEditor({
  module,
  index,
  count,
  busy,
  update,
  remove,
  move,
  setDragIndex,
  onDrop,
}: {
  module: PresetModule;
  index: number;
  count: number;
  busy: boolean;
  update: (fn: (module: PresetModule) => PresetModule) => void;
  remove: () => void;
  move: (from: number, to: number) => void;
  setDragIndex: (index: number | null) => void;
  onDrop: () => void;
}) {
  const name = module.name;
  const change = <K extends keyof PresetModule>(key: K, value: PresetModule[K]) =>
    update((current) => ({ ...current, [key]: value }) as PresetModule);
  return (
    <li>
      <fieldset
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (!busy) onDrop();
        }}
        aria-label={`${name} module`}
      >
        <legend>{module.kind === 'sources' ? 'Protected Sources module' : 'Custom module'}</legend>
        <button
          type="button"
          className="module-drag-handle"
          aria-label={`Drag ${name} module`}
          disabled={busy}
          draggable={!busy}
          onDragStart={() => setDragIndex(index)}
        >
          Drag to reorder
        </button>
        <label>
          Module key
          <input
            aria-label="Module key"
            disabled={busy || module.kind === 'sources'}
            value={module.key}
            onChange={(event) => change('key', event.target.value)}
          />
        </label>
        <label>
          Module name
          <input
            aria-label="Module name"
            disabled={busy}
            value={module.name}
            onChange={(event) => change('name', event.target.value)}
          />
        </label>
        {module.kind === 'custom' ? (
          <>
            <label>
              Role
              <select
                aria-label="Role"
                disabled={busy}
                value={module.role}
                onChange={(event) => change('role', event.target.value as typeof module.role)}
              >
                <option value="system">System</option>
                <option value="user">User</option>
                <option value="assistant">Assistant</option>
              </select>
            </label>
            <label className="nullable-toggle">
              <input
                aria-label="Enabled"
                type="checkbox"
                disabled={busy}
                checked={module.enabled}
                onChange={(event) => change('enabled', event.target.checked)}
              />{' '}
              Enabled
            </label>
            <label>
              Content
              <textarea
                aria-label="Content"
                disabled={busy}
                value={module.content}
                onChange={(event) => change('content', event.target.value)}
              />
            </label>
          </>
        ) : (
          <p className="provider-note">
            Sources content and message role are supplied by the active chat.
          </p>
        )}
        <label>
          Insertion position
          <select
            aria-label="Insertion position"
            disabled={busy}
            value={module.insertion.position}
            onChange={(event) =>
              change(
                'insertion',
                event.target.value === 'at_depth'
                  ? { position: 'at_depth', depth: 0 }
                  : { position: 'before_history' },
              )
            }
          >
            <option value="before_history">Before history</option>
            <option value="at_depth">At depth</option>
          </select>
        </label>
        {module.insertion.position === 'at_depth' ? (
          <label>
            Depth
            <input
              aria-label="Depth"
              type="number"
              disabled={busy}
              min="0"
              step="1"
              value={module.insertion.depth}
              onChange={(event) =>
                change('insertion', {
                  position: 'at_depth',
                  depth: Math.max(0, Number(event.target.value)),
                })
              }
            />
          </label>
        ) : null}
        <div className="inline-actions">
          <button
            type="button"
            disabled={busy || index === 0}
            aria-label={`Move ${name} up`}
            onClick={() => move(index, index - 1)}
          >
            Move up
          </button>
          <button
            type="button"
            disabled={busy || index === count - 1}
            aria-label={`Move ${name} down`}
            onClick={() => move(index, index + 1)}
          >
            Move down
          </button>
          {module.kind === 'custom' ? (
            <button
              type="button"
              className="text-danger"
              disabled={busy}
              aria-label={`Remove ${name}`}
              onClick={remove}
            >
              Remove
            </button>
          ) : null}
        </div>
      </fieldset>
    </li>
  );
}

function AssemblyPreview({ modules }: { modules: PresetModule[] }) {
  const before = modules.filter((module) => module.insertion.position === 'before_history');
  const atDepth = new Map<number, PresetModule[]>();
  for (const module of modules) {
    if (module.insertion.position !== 'at_depth') continue;
    const group = atDepth.get(module.insertion.depth) ?? [];
    group.push(module);
    atDepth.set(module.insertion.depth, group);
  }
  const positiveDepths = [...atDepth.keys()].filter((depth) => depth > 0).sort((a, b) => b - a);
  const depthZero = atDepth.get(0) ?? [];
  const moduleLabel = (module: PresetModule, depth?: number) =>
    `${module.kind === 'sources' ? '[Selected source excerpts]' : module.name}${depth === undefined ? '' : ` · at depth ${depth}`}`;
  return (
    <section className="preset-card assembly-preview">
      <p className="coordinate-label">Assembly preview · not chat content</p>
      <h2>Prompt order</h2>
      <ol>
        {before.map((module) => (
          <li key={module.key}>{moduleLabel(module)}</li>
        ))}
        {positiveDepths.length === 0 ? <li>[Conversation history]</li> : null}
        {positiveDepths.map((depth, index) => (
          <Fragment key={depth}>
            <li>
              {index === 0
                ? `[Conversation history · older than depth ${depth}]`
                : `[Conversation history · depth ${positiveDepths[index - 1]} to depth ${depth}]`}
            </li>
            {atDepth.get(depth)?.map((module) => (
              <li key={module.key}>{moduleLabel(module, depth)}</li>
            ))}
          </Fragment>
        ))}
        {positiveDepths.length > 0 ? (
          <li>
            {positiveDepths.at(-1) === 1
              ? '[Conversation history · newest message]'
              : `[Conversation history · newest ${positiveDepths.at(-1)} messages]`}
          </li>
        ) : null}
        {depthZero.map((module) => (
          <li key={module.key}>{moduleLabel(module, 0)}</li>
        ))}
        <li>[Newest user message]</li>
      </ol>
    </section>
  );
}
