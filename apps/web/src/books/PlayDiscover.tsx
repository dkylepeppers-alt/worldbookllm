import type { DiscoverBeat, DiscoverJob, DiscoverState, PlayPosition } from '@worldbookllm/shared';
import { useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import type { Discover } from './useDiscover.js';

/**
 * Discovery in Play (ADR 0033): what the beat writer is doing, the panel at
 * a beat not written yet (drafts, write it now, write it yourself), the
 * reader's own "Something else", rewriting a beat with a direction, and the
 * variables the beat writer asked for.
 */

const active = (job: DiscoverJob) => job.status === 'queued' || job.status === 'running';

/** The beat writer's work, in one line, and any job that failed. */
export function DiscoverStatus({ discover, state }: { discover: Discover; state: DiscoverState }) {
  const { slug } = useBook();
  const working = state.jobs.filter(
    (job) => active(job) && job.kind !== 'variables' && job.kind !== 'something-else',
  );
  const failed = state.jobs.filter((job) => job.status === 'failed' && job.kind !== 'variables');
  const noted = state.jobs.filter(
    (job) =>
      job.status === 'done' &&
      job.message !== null &&
      ['beat', 'choices', 'rewrite'].includes(job.kind),
  );
  if (working.length === 0 && failed.length === 0 && noted.length === 0) return null;
  return (
    <div className="discover-status" role="status" aria-live="polite">
      {working.length === 0 ? null : (
        <p>
          <span className="discover-dot" aria-hidden="true" />
          {working[0]!.title}…{working.length > 1 ? ` (${working.length - 1} more queued)` : ''}
        </p>
      )}
      {failed.map((job) => (
        <div key={job.id} className="branch-warning">
          <p>
            {job.title} failed: {job.message}
          </p>
          <div className="branch-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => void discover.run((api) => api.retryDiscoverJob(slug, job.id))}
            >
              Try again
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => void discover.run((api) => api.dismissDiscoverJob(slug, job.id))}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {noted.map((job) => (
        <div key={job.id}>
          <p className="coordinate-label">
            {job.title}: {job.message}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => void discover.run((api) => api.dismissDiscoverJob(slug, job.id))}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

/** At a beat not written yet: the beat writer's progress, its drafts, or the ways to write it. */
export function SeedPanel({
  discover,
  state,
  beat,
  position,
}: {
  discover: Discover;
  state: DiscoverState;
  beat: DiscoverBeat;
  position: PlayPosition;
}) {
  const { slug, tree } = useBook();
  const [direction, setDirection] = useState('');
  const [note, setNote] = useState(beat.note.split('\n\n').slice(1).join('\n\n'));
  const jobs = state.jobs.filter((job) => job.chapterId === beat.chapterId);
  const writing = jobs.findLast((job) => active(job) && job.kind !== 'drafts');
  // The newest drafts job: a retry after a failure is the one to show.
  const drafting = jobs.findLast((job) => job.kind === 'drafts');
  const file = tree.files.find((entry) => entry.path === beat.path);
  const reached = beat.note.split('\n\n')[0] ?? '';
  const lead = state.setup?.mode === 'lead';

  return (
    <section className="discover-panel" aria-labelledby="seed-heading">
      <h3 id="seed-heading">Not written yet</h3>
      <p className="coordinate-label">{reached}</p>
      {writing !== undefined ? (
        <p role="status">
          <span className="discover-dot" aria-hidden="true" />
          The beat writer is writing this beat…
        </p>
      ) : drafting !== undefined && active(drafting) ? (
        <p role="status">
          <span className="discover-dot" aria-hidden="true" />
          Drafting three directions…{' '}
          {drafting.drafts.length > 0 ? `(${drafting.drafts.length} of 3)` : ''}
        </p>
      ) : null}
      {drafting?.status === 'failed' ? <p className="form-error">{drafting.message}</p> : null}
      {drafting !== undefined && drafting.drafts.length > 0 ? (
        <Drafts discover={discover} job={drafting} />
      ) : null}
      {writing === undefined && (drafting === undefined || !active(drafting)) ? (
        state.writerReady ? (
          <form
            className="discover-ask"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void discover.run((api) =>
                api.draftDiscoverBeat(slug, {
                  chapterId: beat.chapterId,
                  position,
                  ...(direction.trim() === '' ? {} : { direction: direction.trim() }),
                }),
              );
            }}
          >
            <label>
              Direction (optional)
              <input
                value={direction}
                maxLength={1000}
                placeholder="Darker; Mara lies; the storm breaks"
                onChange={(event) => setDirection(event.target.value)}
              />
            </label>
            <div className="branch-actions">
              <button
                type="submit"
                className={lead ? 'button-secondary' : 'button-primary'}
                disabled={discover.busy}
              >
                {drafting === undefined ? 'Draft three directions' : 'Draft three more'}
              </button>
              <button
                type="button"
                className={lead ? 'button-primary' : 'button-secondary'}
                disabled={discover.busy}
                onClick={() =>
                  void discover.run((api) =>
                    api.writeDiscoverBeat(slug, {
                      chapterId: beat.chapterId,
                      position,
                      ...(direction.trim() === '' ? {} : { direction: direction.trim() }),
                    }),
                  )
                }
              >
                Write it now
              </button>
            </div>
          </form>
        ) : (
          <p className="branch-warning">
            {state.writerProblem} <Link to="/settings">Settings</Link>
          </p>
        )
      ) : null}
      {file === undefined ? null : (
        <p>
          <Link to={fileHref(slug, file.path)}>Write it yourself</Link>
          <span className="coordinate-label"> — replace the TODO line under Chapter Text.</span>
        </p>
      )}
      <details className="play-tools">
        <summary>Note for this beat</summary>
        <form
          className="play-tools-form"
          onSubmit={(event) => {
            event.preventDefault();
            void discover.run((api) => api.setSeedNote(slug, beat.chapterId, note));
          }}
        >
          <label>
            Where it should go
            <textarea
              rows={3}
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button type="submit" className="button-secondary" disabled={discover.busy}>
            Save note
          </button>
        </form>
      </details>
    </section>
  );
}

function Drafts({ discover, job }: { discover: Discover; job: DiscoverJob }) {
  const { slug } = useBook();
  return (
    <ol className="discover-drafts" aria-label="Drafts">
      {job.drafts.map((draft, index) => (
        <li key={draft.id} className="branch-card">
          <h4>
            Draft {index + 1}: {draft.title}
          </h4>
          <div className="markdown-body reader-text discover-draft-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {draft.prose}
            </ReactMarkdown>
          </div>
          {draft.ending ? (
            <p className="coordinate-label">Ends the story.</p>
          ) : (
            <ul className="discover-draft-choices" aria-label={`Choices in draft ${index + 1}`}>
              {draft.choices.map((choice) => (
                <li key={choice.text}>
                  <strong>{choice.text}</strong>
                  <span className="coordinate-label">
                    {' '}
                    {choice.intent} · {choice.leads}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>ink</summary>
            <pre className="build-output">{draft.ink}</pre>
          </details>
          <button
            type="button"
            className="button-primary"
            disabled={discover.busy}
            onClick={() =>
              void discover.run((api) => api.acceptDiscoverDraft(slug, job.id, draft.id))
            }
          >
            Use this draft
          </button>
        </li>
      ))}
    </ol>
  );
}

/** At a written beat that leads nowhere yet: the way on. */
export function EndPanel({
  discover,
  state,
  chapterId,
  position,
}: {
  discover: Discover;
  state: DiscoverState;
  chapterId: string;
  position: PlayPosition;
}) {
  const { slug } = useBook();
  const job = state.jobs.find((entry) => entry.chapterId === chapterId && active(entry));
  if (job !== undefined) {
    return (
      <p role="status" className="discover-status">
        <span className="discover-dot" aria-hidden="true" />
        {job.title}…
      </p>
    );
  }
  if (!state.writerReady) return null;
  return (
    <div className="branch-actions">
      <button
        type="button"
        className="button-primary"
        disabled={discover.busy}
        onClick={() =>
          void discover.run((api) => api.writeDiscoverBeat(slug, { chapterId, position }))
        }
      >
        Write what happens next
      </button>
    </div>
  );
}

/** Rewrite the beat the reader is in, with a direction; its choices keep leading where they lead. */
export function RewriteBeat({
  discover,
  beat,
  position,
}: {
  discover: Discover;
  beat: DiscoverBeat;
  position: PlayPosition;
}) {
  const { slug } = useBook();
  const [direction, setDirection] = useState('');
  return (
    <details className="play-tools">
      <summary>Rewrite {beat.title}</summary>
      <form
        className="play-tools-form"
        onSubmit={(event) => {
          event.preventDefault();
          void discover.run((api) =>
            api.writeDiscoverBeat(slug, {
              chapterId: beat.chapterId,
              position,
              direction: direction.trim(),
            }),
          );
          setDirection('');
        }}
      >
        <label>
          How should it change?
          <input
            value={direction}
            maxLength={1000}
            placeholder="Make it darker; she should lie"
            onChange={(event) => setDirection(event.target.value)}
          />
        </label>
        <p className="coordinate-label">
          The choices keep leading where they lead now. The rewrite is one change you can undo.
          {beat.edited ? ' You have edited this beat; the rewrite replaces your edits.' : ''}
        </p>
        <button
          type="submit"
          className="button-secondary"
          disabled={discover.busy || direction.trim() === ''}
        >
          Rewrite it
        </button>
      </form>
    </details>
  );
}

/**
 * The reader's own action: typed, judged by the beat writer, and either
 * added as a real choice (play goes on into it) or declined with a reason
 * and the nearest action that works.
 */
export function SomethingElse({
  discover,
  state,
  position,
  asked,
  onAsk,
}: {
  discover: Discover;
  state: DiscoverState;
  position: PlayPosition;
  /** The jobs that existed when the reader asked here, or null before they ask. */
  asked: readonly string[] | null;
  onAsk: (known: string[] | null) => void;
}) {
  const { slug } = useBook();
  const [open, setOpen] = useState(asked !== null);
  const [action, setAction] = useState('');
  const mine =
    asked === null
      ? undefined
      : state.jobs.findLast(
          (entry) => entry.kind === 'something-else' && !asked.includes(entry.id),
        );
  const outcome = mine?.status === 'done' ? mine.outcome : null;

  if (!state.writerReady) return null;
  if (!open) {
    return (
      <li>
        <button
          type="button"
          className="button-secondary discover-else"
          onClick={() => setOpen(true)}
        >
          Something else…
        </button>
      </li>
    );
  }
  const working = mine !== undefined && active(mine);
  return (
    <li>
      <form
        className="discover-ask"
        onSubmit={(event) => {
          event.preventDefault();
          if (action.trim() === '') return;
          onAsk(state.jobs.map((entry) => entry.id));
          void discover.run((api) => api.somethingElse(slug, { position, action: action.trim() }));
        }}
      >
        <label>
          What do you do?
          <input
            value={action}
            maxLength={500}
            autoFocus
            disabled={working}
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        {working ? (
          <p role="status">
            <span className="discover-dot" aria-hidden="true" />
            Writing what happens…
          </p>
        ) : null}
        {mine?.status === 'failed' ? <p className="form-error">{mine.message}</p> : null}
        {outcome !== null && !outcome.accepted ? (
          <div className="branch-warning" role="status">
            <p>{outcome.reason}</p>
            {outcome.suggestion.trim() === '' ? null : (
              <button
                type="button"
                className="text-button"
                onClick={() => setAction(outcome.suggestion)}
              >
                Try: {outcome.suggestion}
              </button>
            )}
          </div>
        ) : null}
        <div className="branch-actions">
          <button
            type="submit"
            className="button-primary"
            disabled={working || action.trim() === ''}
          >
            Try it
          </button>
          <button
            type="button"
            className="text-button"
            disabled={working}
            onClick={() => {
              setOpen(false);
              onAsk(null);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

/** Variables the beat writer asked for, for the writer to approve or decline. */
export function Proposals({ discover, state }: { discover: Discover; state: DiscoverState }) {
  const { slug } = useBook();
  if (state.proposals.length === 0) return null;
  return (
    <section className="branch-card" aria-labelledby="proposals-heading">
      <h3 id="proposals-heading">The beat writer asks for new variables</h3>
      <ul className="entry-list">
        {state.proposals.map((proposal) => (
          <li key={proposal.id}>
            <p>
              <code>{proposal.variable.name}</code> starts as{' '}
              <code>{proposal.variable.initial}</code>: {proposal.variable.meaning}
            </p>
            {proposal.reason === '' ? null : <p className="coordinate-label">{proposal.reason}</p>}
            <div className="branch-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={discover.busy}
                onClick={() =>
                  void discover.run((api) =>
                    api.decideDiscoverProposal(slug, proposal.id, { approve: true }),
                  )
                }
              >
                Add it
              </button>
              <button
                type="button"
                className="text-button"
                disabled={discover.busy}
                onClick={() =>
                  void discover.run((api) =>
                    api.decideDiscoverProposal(slug, proposal.id, { approve: false }),
                  )
                }
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The choices taken so far, each a way back to that moment. */
export function PathTrail({
  trail,
  onBack,
}: {
  trail: readonly string[];
  onBack: (steps: number) => void;
}) {
  if (trail.length === 0) return null;
  return (
    <nav className="discover-trail" aria-label="Your path">
      <ol>
        <li>
          <button type="button" className="text-button" onClick={() => onBack(0)}>
            Start
          </button>
        </li>
        {trail.map((choice, index) => (
          <li key={`${index}:${choice}`}>
            {index === trail.length - 1 ? (
              <span aria-current="step">{choice}</span>
            ) : (
              <button type="button" className="text-button" onClick={() => onBack(index + 1)}>
                {choice}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
