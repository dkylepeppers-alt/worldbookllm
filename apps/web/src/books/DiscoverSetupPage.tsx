import {
  isBeatWriterSkill,
  type CustomAgent,
  type DiscoverSetup,
  type DiscoverState,
  type DiscoverVariable,
  type SkillMetadata,
  type StoryDraft,
} from '@worldbookllm/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { useDiscover } from './useDiscover.js';
import { errorMessage, useLoad } from './useLoad.js';

const DEFAULT_SETUP: DiscoverSetup = {
  mode: 'lead',
  lookahead: 1,
  choices: 3,
  beatLength: 'scene',
  rejoin: 'sometimes',
  endings: '',
  kernel: '',
  shape: '',
  agentId: null,
};

const REJOINS = [
  ['often', 'Often: fewer beats, more state'],
  ['sometimes', 'When the story allows'],
  ['rarely', 'Rarely: paths stay apart'],
] as const;

/** Everything the form holds; unsaved, it is kept in this browser so leaving the page loses nothing. */
interface FormValues {
  setup: DiscoverSetup;
  rules: string;
  variables: DiscoverVariable[];
  openingKind: 'agent' | 'writer';
  opening: string;
}

const draftKey = (slug: string) => `worldbookllm:discover-setup:${slug}`;

function readDraft(slug: string): FormValues | null {
  try {
    const text = localStorage.getItem(draftKey(slug));
    if (text === null) return null;
    const value = JSON.parse(text) as Partial<FormValues>;
    if (typeof value.setup !== 'object' || value.setup === null) return null;
    return {
      setup: { ...DEFAULT_SETUP, ...value.setup },
      rules: typeof value.rules === 'string' ? value.rules : '',
      variables: Array.isArray(value.variables) ? value.variables : [],
      openingKind: value.openingKind === 'writer' ? 'writer' : 'agent',
      opening: typeof value.opening === 'string' ? value.opening : '',
    };
  } catch {
    return null;
  }
}

function writeDraft(slug: string, values: FormValues | null): void {
  try {
    if (values === null) localStorage.removeItem(draftKey(slug));
    else localStorage.setItem(draftKey(slug), JSON.stringify(values));
  } catch {
    // Storage may be full or blocked; the form still works, it just is not kept.
  }
}

/**
 * Branches → Story setup (ADR 0033): how the book is discovered by playing
 * it. The premise, the shape, the variables the story tracks and what each
 * means, the rules every set of choices follows, and how much the beat
 * writer does on its own. For a book with no chapters, the opening too.
 * The beat writer drafts the premise, shape and tone, and endings from the
 * bible when the book is first set up; the writer edits them from there.
 * Unsaved changes are kept in the browser until saved or discarded.
 */
export function DiscoverSetupPage() {
  const { slug, tree } = useBook();
  const hasChapters = tree.files.some((file) => file.kind === 'chapter');
  const discover = useDiscover();
  const branches = `/books/${encodeURIComponent(slug)}/branches`;
  return (
    <section className="book-panel branches-page" aria-labelledby="discover-setup-heading">
      <p className="coordinate-label">
        <Link to={branches}>Branches</Link>
      </p>
      <h2 id="discover-setup-heading">Story setup</h2>
      <p>
        Discover the story by playing it: the beat writer writes each scene and the choices it ends
        with, and everything it writes is an ordinary chapter you can read, edit, or undo.
        {hasChapters
          ? ' The story starts from the chapters you already have, which stay as you wrote them; at the end of one in Play, choose Write what happens next.'
          : null}
      </p>
      {discover.state === null ? (
        discover.error === null ? (
          <LoadingState>Reading the setup…</LoadingState>
        ) : (
          <ErrorState title="The setup could not load" message={discover.error} />
        )
      ) : (
        <SetupForm
          key={discover.state.setup === null ? 'new' : 'saved'}
          discover={discover}
          state={discover.state}
        />
      )}
    </section>
  );
}

function SetupForm({
  discover,
  state,
}: {
  discover: ReturnType<typeof useDiscover>;
  state: DiscoverState;
}) {
  const { slug, tree } = useBook();
  const navigate = useNavigate();
  const saved: FormValues = {
    setup: state.setup ?? DEFAULT_SETUP,
    rules: state.rules,
    variables: state.variables,
    openingKind: 'agent',
    opening: '',
  };
  const [kept] = useState(() => readDraft(slug));
  const start = kept ?? saved;
  const [setup, setSetup] = useState<DiscoverSetup>(start.setup);
  const [rules, setRules] = useState(start.rules || state.rules);
  const [variables, setVariables] = useState<DiscoverVariable[]>(start.variables);
  const [openingKind, setOpeningKind] = useState(start.openingKind);
  const [opening, setOpening] = useState(start.opening);
  const hasChapters = tree.files.some((file) => file.kind === 'chapter');
  // The beat writer writes a new book's opening from the premise; a scene already there tells it the story.
  const writesOpening = !hasChapters && (openingKind === 'agent' || opening.trim() === '');
  const update = (change: Partial<DiscoverSetup>) =>
    setSetup((current) => ({ ...current, ...change }));
  const pickAgent = (agentId: string | null) => setSetup((current) => ({ ...current, agentId }));
  const api = useApi();
  const agents = useLoad((signal) => api.listCustomAgents(signal), 'agents');
  // The agent Add the Beat writer agent made, until the reloaded list has it.
  const [added, setAdded] = useState<CustomAgent | null>(null);
  const agentList =
    agents.status !== 'ready'
      ? null
      : added === null || agents.data.some((agent) => agent.id === added.id)
        ? agents.data
        : [...agents.data, added];
  const skills = useLoad((signal) => api.listSkills(signal), 'skills');
  // A deleted agent cannot be saved; the default beat writer takes its place.
  const agentId =
    agentList !== null && !agentList.some((agent) => agent.id === setup.agentId)
      ? null
      : setup.agentId;

  const values: FormValues = { setup, rules, variables, openingKind, opening };
  const unsaved = JSON.stringify(values) !== JSON.stringify(saved);
  const valuesKey = JSON.stringify(values);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    writeDraft(slug, valuesKey === savedKey ? null : (JSON.parse(valuesKey) as FormValues));
  }, [slug, valuesKey, savedKey]);

  function discard() {
    writeDraft(slug, null);
    setSetup(saved.setup);
    setRules(saved.rules);
    setVariables(saved.variables);
    setOpeningKind(saved.openingKind);
    setOpening(saved.opening);
  }

  // The story fields the writer changed since the last draft was asked for, which it leaves alone.
  const touched = useRef(new Set<keyof StoryDraft>());
  const editStory = (change: Partial<StoryDraft>) => {
    for (const key of Object.keys(change)) touched.current.add(key as keyof StoryDraft);
    update(change);
  };
  const drafting = state.jobs.find((job) => job.kind === 'story');
  const source = hasChapters ? 'the story so far and your bible' : 'your bible';
  const draftingNow = drafting?.status === 'queued' || drafting?.status === 'running';
  const draftStory = () => {
    touched.current.clear();
    void discover.run((api) =>
      api.proposeDiscoverStory(slug, {
        kernel: setup.kernel,
        shape: setup.shape,
        endings: setup.endings,
        ...(!hasChapters && openingKind === 'writer' ? { opening } : {}),
      }),
    );
  };

  // A new book's story is drafted as soon as the form opens, unless the writer has started on it.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const blank = [setup.kernel, setup.shape, setup.endings].every((text) => text.trim() === '');
    if (state.setup === null && state.writerReady && drafting === undefined && blank) draftStory();
  });

  // A finished draft fills the fields the writer has not changed meanwhile, then is cleared.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (drafting?.status !== 'done' || drafting.story === null) return;
    if (applied.current === drafting.id) return;
    applied.current = drafting.id;
    const story = drafting.story;
    setSetup((current) => ({
      ...current,
      ...Object.fromEntries(
        (['kernel', 'shape', 'endings'] as const)
          .filter((key) => !touched.current.has(key))
          .map((key) => [key, story[key]]),
      ),
    }));
    void discover.run((api) => api.dismissDiscoverJob(slug, drafting.id));
  }, [drafting, discover, slug]);

  const proposing = state.jobs.find((job) => job.kind === 'variables');
  const proposingNow = proposing?.status === 'queued' || proposing?.status === 'running';
  const proposed = proposing?.status === 'done' ? proposing.variables : [];
  const fresh = proposed.filter(
    (entry) => !variables.some((variable) => variable.name === entry.name),
  );
  const dismissProposal = () => {
    if (proposing) void discover.run((api) => api.dismissDiscoverJob(slug, proposing.id));
  };
  const addProposed = (added: DiscoverVariable[]) => {
    setVariables([...variables, ...added]);
    if (added.length === fresh.length) dismissProposal();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await discover.run((api) =>
      api.saveDiscoverSetup(slug, {
        setup: { ...setup, agentId },
        rules,
        variables: variables.filter((variable) => variable.name.trim() !== ''),
        ...(hasChapters ? {} : { opening: openingKind === 'writer' ? opening : null }),
      }),
    );
    if (ok) {
      writeDraft(slug, null);
      navigate(`/books/${encodeURIComponent(slug)}/branches/play`);
    }
  }

  const needsPremise = writesOpening && setup.kernel.trim() === '';
  const ruleCount = rules.split('\n').filter((line) => /^\s*\d+[.)]\s/u.test(line)).length;
  const options = [
    setup.mode === 'lead'
      ? setup.lookahead === 1
        ? 'writes one step ahead'
        : 'writes two steps ahead'
      : null,
    `${setup.choices} choices`,
    setup.beatLength === 'scene' ? 'scenes' : 'short chapters',
    `rejoin ${setup.rejoin === 'sometimes' ? 'when the story allows' : setup.rejoin}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <form className="discover-form" onSubmit={(event) => void submit(event)}>
      {state.writerReady ? null : (
        <p className="branch-warning" role="status">
          {state.writerProblem} <Link to="/settings">Settings</Link>
        </p>
      )}

      <fieldset className="branch-card">
        <legend>The story</legend>
        <div className="discover-draft">
          <p className="field-hint" role="status">
            {draftingNow ? <span className="discover-dot" aria-hidden="true" /> : null}
            {draftingNow
              ? `Drafting from ${source}. Anything you type meanwhile is kept.`
              : `The beat writer drafts these from ${source}. Edit them freely.`}
          </p>
          <button
            type="button"
            className="button-secondary"
            disabled={!state.writerReady || draftingNow || discover.busy}
            onClick={draftStory}
          >
            {draftingNow
              ? 'Drafting…'
              : setup.kernel.trim() === ''
                ? 'Draft with the beat writer'
                : 'Redraft with the beat writer'}
          </button>
        </div>
        {drafting?.status === 'failed' ? <p className="form-error">{drafting.message}</p> : null}
        <label>
          Premise
          <span className="field-hint">
            A character in a situation, what they want, and what stands in the way.{' '}
            {writesOpening
              ? 'The beat writer writes the opening from it.'
              : 'Optional: your chapters tell the story so far; this says where it is going.'}
          </span>
          <textarea
            className="prose-input"
            rows={5}
            value={setup.kernel}
            maxLength={4000}
            onChange={(event) => editStory({ kernel: event.target.value })}
          />
        </label>
        <label>
          Shape and tone
          <span className="field-hint">Length, mood, the kind of choices you want.</span>
          <textarea
            className="prose-input"
            rows={4}
            value={setup.shape}
            maxLength={8000}
            onChange={(event) => editStory({ shape: event.target.value })}
          />
        </label>
        <label>
          Endings
          <input
            value={setup.endings}
            maxLength={300}
            placeholder="Three, one of them bittersweet"
            onChange={(event) => editStory({ endings: event.target.value })}
          />
        </label>
      </fieldset>

      {hasChapters ? null : (
        <fieldset className="branch-card">
          <legend>The opening</legend>
          <fieldset className="discover-options">
            <legend>Who writes it</legend>
            <label className="checkbox-label">
              <input
                type="radio"
                name="opening"
                checked={openingKind === 'agent'}
                onChange={() => setOpeningKind('agent')}
              />
              The beat writer, from the premise
            </label>
            <label className="checkbox-label">
              <input
                type="radio"
                name="opening"
                checked={openingKind === 'writer'}
                onChange={() => setOpeningKind('writer')}
              />
              I will: here is the first scene
            </label>
          </fieldset>
          {openingKind === 'writer' ? (
            <label>
              First scene
              <span className="field-hint">
                Plain prose; a first line starting with # is its title. The beat writer adds the
                choices it ends with and never rewrites it.
              </span>
              <textarea
                className="prose-input"
                rows={10}
                value={opening}
                onChange={(event) => setOpening(event.target.value)}
              />
            </label>
          ) : null}
        </fieldset>
      )}

      <fieldset className="branch-card">
        <legend>How you play</legend>
        <fieldset className="discover-options">
          <legend>Mode</legend>
          <label className="checkbox-label">
            <input
              type="radio"
              name="mode"
              checked={setup.mode === 'lead'}
              onChange={() => update({ mode: 'lead' })}
            />
            Lead: the beat writer writes ahead while you play
          </label>
          <label className="checkbox-label">
            <input
              type="radio"
              name="mode"
              checked={setup.mode === 'cowrite'}
              onChange={() => update({ mode: 'cowrite' })}
            />
            Co-write: it drafts a beat only when you ask
          </label>
        </fieldset>
        <BeatWriterPicker
          agents={agentList}
          skills={skills.status === 'ready' ? skills.data : null}
          agentId={setup.agentId}
          onChange={pickAgent}
        />
        {agentList === null || agentList.some((agent) => agent.name === 'Beat writer') ? null : (
          <AddBeatWriter
            onAdded={(agent) => {
              setAdded(agent);
              agents.reload();
              pickAgent(agent.id);
            }}
          />
        )}
        <details className="discover-more">
          <summary>
            More options <span className="field-hint">{options}</span>
          </summary>
          <div className="discover-more-body">
            {setup.mode === 'lead' ? (
              <fieldset className="discover-options">
                <legend>Write ahead</legend>
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="lookahead"
                    checked={setup.lookahead === 1}
                    onChange={() => update({ lookahead: 1 })}
                  />
                  One step: the beat after every choice you can see
                </label>
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="lookahead"
                    checked={setup.lookahead === 2}
                    onChange={() => update({ lookahead: 2 })}
                  />
                  Two steps: about three times as many model calls
                </label>
              </fieldset>
            ) : null}
            <div className="discover-pair">
              <label>
                Choices per beat
                <select
                  value={setup.choices}
                  onChange={(event) => update({ choices: Number(event.target.value) })}
                >
                  {[2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count}, plus Something else
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Each beat is
                <select
                  value={setup.beatLength}
                  onChange={(event) =>
                    update({ beatLength: event.target.value as DiscoverSetup['beatLength'] })
                  }
                >
                  <option value="scene">A scene (250–600 words)</option>
                  <option value="chapter">A short chapter (900–1,800 words)</option>
                </select>
              </label>
            </div>
            <fieldset className="discover-options">
              <legend>Branches rejoin</legend>
              {REJOINS.map(([value, label]) => (
                <label key={value} className="checkbox-label">
                  <input
                    type="radio"
                    name="rejoin"
                    checked={setup.rejoin === value}
                    onChange={() => update({ rejoin: value })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        </details>
      </fieldset>

      <fieldset className="branch-card">
        <legend>What the story remembers</legend>
        <p className="field-hint">
          Variables that choices set and later beats read, like trust or what the hero knows. The
          beat writer can suggest more while it writes; you approve each one.
        </p>
        {variables.length === 0 ? (
          <p className="field-hint">No variables yet. You can start without any.</p>
        ) : (
          <ul className="discover-variables" aria-label="Variables">
            {variables.map((variable, index) => (
              <li key={index} className="choice-row">
                <label>
                  Name
                  <input
                    className="mono-input"
                    value={variable.name}
                    spellCheck={false}
                    onChange={(event) =>
                      setVariables(
                        variables.map((entry, at) =>
                          at === index ? { ...entry, name: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Starts as
                  <input
                    className="mono-input"
                    value={variable.initial}
                    spellCheck={false}
                    placeholder='0, false, or "text"'
                    onChange={(event) =>
                      setVariables(
                        variables.map((entry, at) =>
                          at === index ? { ...entry, initial: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label className="discover-meaning">
                  What it means
                  <input
                    value={variable.meaning}
                    maxLength={300}
                    onChange={(event) =>
                      setVariables(
                        variables.map((entry, at) =>
                          at === index ? { ...entry, meaning: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button-secondary"
                  aria-label={`Remove ${variable.name || 'this variable'}`}
                  onClick={() => setVariables(variables.filter((_entry, at) => at !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="branch-actions">
          <button
            type="button"
            className="button-secondary"
            disabled={!state.writerReady || proposingNow}
            onClick={() =>
              void discover.run((api) =>
                api.proposeDiscoverVariables(slug, { kernel: setup.kernel, shape: setup.shape }),
              )
            }
          >
            {proposingNow ? 'Suggesting…' : 'Suggest variables'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setVariables([...variables, { name: '', initial: '0', meaning: '' }])}
          >
            Add a variable
          </button>
        </div>
        {proposing?.status === 'failed' ? (
          <p className="form-error">{proposing.message}</p>
        ) : proposing?.status === 'done' && fresh.length === 0 && proposed.length > 0 ? (
          <p className="field-hint" role="status">
            You already have every variable the beat writer suggested.{' '}
            <button type="button" className="text-button" onClick={dismissProposal}>
              OK
            </button>
          </p>
        ) : null}
        {fresh.length > 0 ? (
          <div className="discover-proposed" role="status">
            <p>The beat writer suggests:</p>
            <ul className="discover-suggestions">
              {fresh.map((variable) => (
                <li key={variable.name}>
                  <span>
                    <code>{variable.name}</code> = <code>{variable.initial}</code>
                    {variable.meaning === '' ? null : `: ${variable.meaning}`}
                  </span>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => addProposed([variable])}
                  >
                    Add {variable.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="branch-actions">
              {fresh.length > 1 ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => addProposed(fresh)}
                >
                  Add all
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={dismissProposal}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </fieldset>

      <details className="branch-card discover-rules">
        <summary>
          Rules for choices{' '}
          <span className="field-hint">
            {ruleCount > 0 ? `${ruleCount} rules, ` : ''}checked before any choices are written
          </span>
        </summary>
        <p className="field-hint">
          A set of choices that breaks one is sent back to the beat writer. Edit them, or add your
          own. They are saved in <code>adaptations/interactive/choice-rules.md</code>.
        </p>
        <textarea
          aria-label="Rules for choices"
          rows={12}
          value={rules}
          maxLength={20000}
          onChange={(event) => setRules(event.target.value)}
        />
      </details>

      <div className="discover-save-bar">
        {discover.error === null ? null : <p className="form-error">{discover.error}</p>}
        <div className="branch-actions">
          <button
            type="submit"
            className="button-primary"
            disabled={discover.busy || needsPremise || rules.trim() === ''}
          >
            {state.setup === null ? 'Save and start playing' : 'Save and go to Play'}
          </button>
          {needsPremise ? (
            <span className="field-hint">Write the premise, or the opening scene, first.</span>
          ) : unsaved ? (
            <span className="field-hint">
              Not saved yet; kept in this browser until you save.{' '}
              <button type="button" className="text-button" onClick={discard}>
                Discard changes
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/**
 * Which agent writes the beats: the default beat writer, or a custom agent
 * from the Agents page, whose instructions and the skills it names guide
 * every beat.
 */
/** Installs the beat writer skills and the agent that names them (ADR 0034), and picks it. */
function AddBeatWriter({ onAdded }: { onAdded: (agent: CustomAgent) => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="branch-actions">
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          api
            .installBeatWriter()
            .then((result) => onAdded(result.agent))
            .catch((caught: unknown) => setError(errorMessage(caught)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Adding…' : 'Add the Beat writer agent'}
      </button>
      <span className="field-hint">
        Six skills written for discovery: beat shape, choices, memory, branching, voice, and the
        reader&apos;s own actions.
      </span>
      {error === null ? null : <p className="form-error">{error}</p>}
    </div>
  );
}

/** What the picked agent's skills come to in the beat writer, which uses beat writer skills and the writer's own (ADR 0034). */
function skillsHint(named: string[] | null, skills: SkillMetadata[] | null): string {
  if (named === null) {
    return 'Skills: the beat writer skills and your own, loaded when one fits. Story Skills are for chats and are not used here.';
  }
  if (named.length === 0) return 'No skills.';
  // Until the skills load, which of them the beat writer uses is not known.
  if (skills === null) return `Skills: ${named.join(', ')}.`;
  const installed = (name: string) => skills.find((skill) => skill.name === name);
  const used = named.filter((name) => {
    const skill = installed(name);
    return skill !== undefined && isBeatWriterSkill(skill);
  });
  const unused = named.filter((name) => {
    const skill = installed(name);
    return skill !== undefined && !isBeatWriterSkill(skill);
  });
  const missing = named.filter((name) => installed(name) === undefined);
  return [
    used.length === 0
      ? 'None of its skills are used here.'
      : `Skills, followed on every beat: ${used.join(', ')}.`,
    unused.length === 0
      ? ''
      : ` Not used here, since Story Skills are for chats: ${unused.join(', ')}.`,
    missing.length === 0 ? '' : ` Not installed: ${missing.join(', ')}.`,
  ].join('');
}

function BeatWriterPicker({
  agents,
  skills,
  agentId,
  onChange,
}: {
  /** The custom agents, or null while they load. */
  agents: CustomAgent[] | null;
  /** The installed skills, or null while they load. */
  skills: SkillMetadata[] | null;
  agentId: string | null;
  onChange: (agentId: string | null) => void;
}) {
  const picked = agents?.find((agent) => agent.id === agentId);
  const gone = agents !== null && agentId !== null && picked === undefined;
  return (
    <label>
      Beat writer
      <span className="field-hint">
        A custom agent writes with its own instructions and follows the beat writer skills and your
        own skills it names on every beat. <Link to="/agents">Make or edit agents</Link>.
      </span>
      <select
        value={gone ? '' : (agentId ?? '')}
        disabled={agents === null}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">Default beat writer</option>
        {(agents ?? []).map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      {gone ? (
        <span className="form-error">
          The agent this book used no longer exists, so saving picks the default beat writer.
        </span>
      ) : picked !== undefined ? (
        <span className="field-hint">
          {picked.description === '' ? null : `${picked.description} `}
          {skillsHint(picked.skills, skills)}
        </span>
      ) : null}
    </label>
  );
}
