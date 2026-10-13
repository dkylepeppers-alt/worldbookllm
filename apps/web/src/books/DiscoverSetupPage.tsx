import type { DiscoverSetup, DiscoverState, DiscoverVariable } from '@worldbookllm/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { useDiscover } from './useDiscover.js';

const DEFAULT_SETUP: DiscoverSetup = {
  mode: 'lead',
  lookahead: 1,
  choices: 3,
  beatLength: 'scene',
  rejoin: 'sometimes',
  endings: '',
  kernel: '',
  shape: '',
};

/**
 * Branches → Story setup (ADR 0033): how the book is discovered by playing
 * it. The premise, the shape, the variables the story tracks and what each
 * means, the rules every set of choices follows, and how much the beat
 * writer does on its own. For a book with no chapters, the opening too.
 */
export function DiscoverSetupPage() {
  const { slug } = useBook();
  const discover = useDiscover();
  const branches = `/books/${encodeURIComponent(slug)}/branches`;
  return (
    <section className="book-panel branches-page" aria-labelledby="discover-setup-heading">
      <p className="coordinate-label">
        <Link to={branches}>Branches</Link>
      </p>
      <h2 id="discover-setup-heading">Story setup</h2>
      <p>
        Discover the story by playing it. The beat writer writes each scene and the choices it ends
        with, following your bible, your premise, the variables below, and the rules for choices.
        Everything it writes is an ordinary chapter you can read, edit, or undo.
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
  const [setup, setSetup] = useState<DiscoverSetup>(state.setup ?? DEFAULT_SETUP);
  const [rules, setRules] = useState(state.rules);
  const [variables, setVariables] = useState<DiscoverVariable[]>(state.variables);
  const hasChapters = tree.files.some((file) => file.kind === 'chapter');
  const [openingKind, setOpeningKind] = useState<'agent' | 'writer'>('agent');
  const [opening, setOpening] = useState('');
  const update = (change: Partial<DiscoverSetup>) => setSetup({ ...setup, ...change });

  const proposing = state.jobs.find((job) => job.kind === 'variables');
  const proposed = proposing?.status === 'done' ? proposing.variables : [];
  const fresh = proposed.filter(
    (entry) => !variables.some((variable) => variable.name === entry.name),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await discover.run((api) =>
      api.saveDiscoverSetup(slug, {
        setup,
        rules,
        variables: variables.filter((variable) => variable.name.trim() !== ''),
        ...(hasChapters ? {} : { opening: openingKind === 'writer' ? opening : null }),
      }),
    );
    if (saved) navigate(`/books/${encodeURIComponent(slug)}/branches/play`);
  }

  return (
    <form className="discover-form" onSubmit={(event) => void submit(event)}>
      {state.writerReady ? null : (
        <p className="branch-warning" role="status">
          {state.writerProblem} <Link to="/settings">Settings</Link>
        </p>
      )}

      <fieldset className="branch-card">
        <legend>The story</legend>
        <label>
          Premise
          <span className="coordinate-label">
            One paragraph: a character in a situation, what they want, what stands in the way, and
            the tone. It is saved as the story kernel in story.md.
          </span>
          <textarea
            className="prose-input"
            rows={5}
            value={setup.kernel}
            maxLength={4000}
            onChange={(event) => update({ kernel: event.target.value })}
          />
        </label>
        <label>
          Shape and tone
          <span className="coordinate-label">
            Length, mood, what kind of choices you want, anything the beat writer should keep in
            mind. Your words, as long as you like.
          </span>
          <textarea
            className="prose-input"
            rows={4}
            value={setup.shape}
            maxLength={8000}
            onChange={(event) => update({ shape: event.target.value })}
          />
        </label>
        <label>
          Endings
          <input
            value={setup.endings}
            maxLength={300}
            placeholder="Three, one of them bittersweet"
            onChange={(event) => update({ endings: event.target.value })}
          />
        </label>
        <fieldset className="discover-options">
          <legend>Branches rejoin</legend>
          {(
            [
              ['often', 'Often: fewer beats, more state'],
              ['sometimes', 'When the story allows'],
              ['rarely', 'Rarely: paths stay apart'],
            ] as const
          ).map(([value, label]) => (
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
      </fieldset>

      <fieldset className="branch-card">
        <legend>How you write</legend>
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
      </fieldset>

      <fieldset className="branch-card">
        <legend>What the story remembers</legend>
        <p className="coordinate-label">
          Variables that choices set and later beats read. Say what each one means; the beat writer
          reads it. It can propose more while it writes, and you approve each one.
        </p>
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
        <div className="branch-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={() => setVariables([...variables, { name: '', initial: '0', meaning: '' }])}
          >
            Add a variable
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={
              !state.writerReady ||
              proposing?.status === 'queued' ||
              proposing?.status === 'running'
            }
            onClick={() =>
              void discover.run((api) =>
                api.proposeDiscoverVariables(slug, { kernel: setup.kernel, shape: setup.shape }),
              )
            }
          >
            {proposing?.status === 'queued' || proposing?.status === 'running'
              ? 'Proposing…'
              : 'Propose from the premise and bible'}
          </button>
        </div>
        {proposing?.status === 'failed' ? <p className="form-error">{proposing.message}</p> : null}
        {fresh.length > 0 ? (
          <div className="discover-proposed" role="status">
            <p>The beat writer proposes:</p>
            <ul>
              {fresh.map((variable) => (
                <li key={variable.name}>
                  <code>{variable.name}</code> = <code>{variable.initial}</code>: {variable.meaning}
                </li>
              ))}
            </ul>
            <div className="branch-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setVariables([...variables, ...fresh]);
                  if (proposing)
                    void discover.run((api) => api.dismissDiscoverJob(slug, proposing.id));
                }}
              >
                Add {fresh.length === 1 ? 'it' : 'all'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (proposing)
                    void discover.run((api) => api.dismissDiscoverJob(slug, proposing.id));
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="branch-card">
        <legend>Rules for choices</legend>
        <p className="coordinate-label">
          Every set of choices is checked against these before it is written, and sent back when it
          breaks one. Edit them, or add your own. They are saved in{' '}
          <code>adaptations/interactive/choice-rules.md</code>.
        </p>
        <textarea
          aria-label="Rules for choices"
          rows={12}
          value={rules}
          maxLength={20000}
          onChange={(event) => setRules(event.target.value)}
        />
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
              <span className="coordinate-label">
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

      {discover.error === null ? null : <p className="form-error">{discover.error}</p>}
      <div className="branch-actions">
        <button
          type="submit"
          className="button-primary"
          disabled={discover.busy || setup.kernel.trim() === '' || rules.trim() === ''}
        >
          {state.setup === null ? 'Save and start playing' : 'Save and go to Play'}
        </button>
        {setup.kernel.trim() === '' ? (
          <span className="coordinate-label">Write the premise first.</span>
        ) : null}
      </div>
    </form>
  );
}
