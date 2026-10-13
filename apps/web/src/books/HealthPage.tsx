import type { BookCheckResult, PathReport } from '@worldbookllm/shared';
import { Link } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { useDiscover } from './useDiscover.js';
import { useLoad } from './useLoad.js';

interface CheckCounts {
  ok: boolean;
  errors: number;
  warnings: number;
  dismissed: number;
}

interface Action {
  priority: string;
  title: string;
  detail: string;
}

function checksOf(report: BookCheckResult): Array<[string, CheckCounts]> {
  const data = report.envelope.data as { checks?: Record<string, CheckCounts> } | null;
  return Object.entries(data?.checks ?? {});
}

const INK_SEVERITY = { error: 'error', warning: 'warning', todo: 'to do' } as const;

function actionsOf(next: BookCheckResult): Action[] {
  const data = next.envelope.data as { actions?: Action[] } | null;
  return data?.actions ?? [];
}

/** The book's health: `story report` checks, `story next` actions, and every finding. */
export function HealthPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const health = useLoad(
    async (signal) => {
      const [report, next, story] = await Promise.all([
        api.runBookCheck(slug, 'report', signal),
        api.runBookCheck(slug, 'next', signal),
        tree.book.interactive === true
          ? api.getInteractiveStory(slug, signal)
          : Promise.resolve(null),
      ]);
      return { report, next, story };
    },
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );

  if (health.status === 'loading') return <LoadingState>Running story checks…</LoadingState>;
  if (health.status === 'error') {
    return (
      <ErrorState title="Checks could not run" message={health.message} onRetry={health.reload} />
    );
  }

  const { report, next, story } = health.data;
  const findings = report.envelope.diagnostics;
  const ink = story?.diagnostics ?? [];
  return (
    <section className="book-panel" aria-labelledby="health-heading">
      <p className="coordinate-label">story report · story next</p>
      <h2 id="health-heading">Health</h2>
      <ul className="check-grid" aria-label="Checks">
        {checksOf(report).map(([name, counts]) => (
          <li key={name} className={counts.errors > 0 ? 'check-card check-failed' : 'check-card'}>
            <p className="coordinate-label">{name}</p>
            <p>
              {counts.errors} {counts.errors === 1 ? 'error' : 'errors'} · {counts.warnings}{' '}
              {counts.warnings === 1 ? 'warning' : 'warnings'}
            </p>
          </li>
        ))}
      </ul>

      <h3>Next</h3>
      <ol className="entry-list">
        {actionsOf(next).map((action) => (
          <li key={`${action.priority}:${action.title}`}>
            <span className="coordinate-label">{action.priority}</span>
            <strong>{action.title}</strong>
            <span>{action.detail}</span>
          </li>
        ))}
      </ol>

      {story === null ? null : (
        <section className="health-paths" aria-labelledby="health-ink-heading">
          <h3 id="health-ink-heading">Ink</h3>
          <p>
            What the ink compiler says about the story, and what its structure shows: knots nothing
            leads to, ones that run out of story, and variables nothing reads. story-skills&apos;
            checks above read the chapters&apos; prose without their ink.
          </p>
          {ink.length === 0 ? (
            <p className="coordinate-label">The ink compiles, and nothing stands out.</p>
          ) : (
            <ul className="entry-list" aria-label="Ink findings">
              {ink.map((entry, index) => (
                <li key={`${index}:${entry.path ?? ''}:${entry.line ?? ''}:${entry.message}`}>
                  <span className="coordinate-label">{INK_SEVERITY[entry.severity]}</span>
                  <span>{entry.message}</span>
                  {entry.path === null ? null : (
                    <Link to={fileHref(slug, entry.path)}>
                      {entry.path}
                      {entry.line === null ? '' : `, line ${entry.line}`}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {story.compiled ? (
            <p>
              <Link to={`/books/${encodeURIComponent(slug)}/branches/play`}>Play the story</Link>
            </p>
          ) : null}
        </section>
      )}

      {tree.book.interactive === true ? <DiscoverySection /> : null}
      {story?.compiled === true ? <PathsSection /> : null}

      {findings.length > 0 ? (
        <>
          <h3>Findings</h3>
          <ul className="entry-list" aria-label="Findings">
            {findings.map((finding, index) => (
              <li key={`${index}:${finding.message}`}>
                <span className="coordinate-label">{finding.severity}</span>
                <span>{finding.message}</span>
                {typeof finding.file === 'string' ? (
                  <Link to={fileHref(slug, finding.file)}>{finding.file}</Link>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * Discovery (ADR 0033): branches not written yet, each a link into Play at
 * the fewest choices that reach it, and beats written from a chapter that
 * changed since, which the writer read or edited and so reviews.
 */
function DiscoverySection() {
  const { slug, tree } = useBook();
  const discover = useDiscover();
  const state = discover.state;
  if (state === null || state.setup === null) return null;
  const book = `/books/${encodeURIComponent(slug)}`;
  const titleOf = (id: string | null) =>
    id === null ? null : (state.beats.find((beat) => beat.chapterId === id)?.title ?? id);
  const fileOf = (id: string) =>
    tree.files.find((file) => file.kind === 'chapter' && file.entityId === id);
  return (
    <section className="health-paths" id="discovery" aria-labelledby="health-discovery-heading">
      <h3 id="health-discovery-heading">Discovery</h3>
      {state.openThreads.length === 0 && state.needsReview.length === 0 ? (
        <p>Every branch is written, and nothing waits for review.</p>
      ) : null}
      {state.openThreads.length > 0 ? (
        <>
          <h4>Open threads</h4>
          <ul className="entry-list" aria-label="Open threads">
            {state.openThreads.map((thread) => (
              <li key={thread.chapterId}>
                <span>{thread.title}</span>
                {thread.from === null ? null : (
                  <span className="coordinate-label">after {titleOf(thread.from)}</span>
                )}
                {thread.playPath === null ? (
                  <span className="coordinate-label">No path played reaches it yet.</span>
                ) : (
                  <Link
                    to={`${book}/branches/play?${new URLSearchParams({
                      seed: '1',
                      ...(thread.playPath.length === 0 ? {} : { path: thread.playPath.join('.') }),
                    }).toString()}`}
                  >
                    Write it in Play ({plural(thread.playPath.length, 'choice', 'choices')} in)
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {state.needsReview.length > 0 ? (
        <>
          <h4>Needs review</h4>
          <p className="coordinate-label">
            The chapter these continue changed after they were written. You read or edited them, so
            they were not rewritten: check they still follow, then mark them reviewed.
          </p>
          <ul className="entry-list" aria-label="Needs review">
            {state.needsReview.map((beat) => {
              const file = fileOf(beat.chapterId);
              return (
                <li key={beat.chapterId}>
                  {file === undefined ? (
                    <span>{beat.title}</span>
                  ) : (
                    <Link to={fileHref(slug, file.path)}>{beat.title}</Link>
                  )}
                  <span className="coordinate-label">after {titleOf(beat.from)}</span>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={discover.busy}
                    onClick={() =>
                      void discover.run((api) => api.markDiscoverReviewed(slug, beat.chapterId))
                    }
                  >
                    Mark reviewed
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {discover.error === null ? null : <p className="form-error">{discover.error}</p>}
    </section>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function pathSummary(report: PathReport): string {
  const explored = report.complete
    ? `Played every path: ${plural(report.explored, 'distinct state', 'distinct states')}.`
    : `Played ${plural(report.explored, 'distinct state', 'distinct states')}, then stopped: the story has more, so this is partial.`;
  const endings =
    report.endings === 0 || report.shortest === null || report.longest === null
      ? report.complete
        ? 'No path reaches an ending.'
        : 'No ending was reached in the states played.'
      : `${plural(report.endings, 'distinct ending', 'distinct endings')}, reached in ${
          report.shortest === report.longest
            ? plural(report.shortest, 'choice', 'choices')
            : `${report.shortest} to ${report.longest} choices`
        }.`;
  return `${explored} ${endings}`;
}

/**
 * Health → Paths (ADR 0032): the story played down every path, for what
 * reading its source cannot show.
 */
function PathsSection() {
  const api = useApi();
  const { slug, tree } = useBook();
  const paths = useLoad(
    (signal) => api.getPathReport(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const book = `/books/${encodeURIComponent(slug)}`;
  const place = (path: string | null, line: number | null) =>
    path === null ? null : (
      <Link to={fileHref(slug, path)}>
        {path}
        {line === null ? '' : `, line ${line}`}
      </Link>
    );

  return (
    <section className="health-paths" aria-labelledby="health-paths-heading">
      <h3 id="health-paths-heading">Paths</h3>
      <p>
        The story played down every path, as a reader could: where it stops with an error, how its
        paths end, and what no path reaches.
      </p>
      {paths.status === 'loading' ? <LoadingState>Playing every path…</LoadingState> : null}
      {paths.status === 'error' ? (
        <ErrorState
          title="The paths could not be played"
          message={paths.message}
          onRetry={paths.reload}
        />
      ) : null}
      {paths.status === 'ready' ? (
        <>
          <p className="coordinate-label">{pathSummary(paths.data)}</p>
          {paths.data.errors.length > 0 ? (
            <>
              <h4>Errors while playing</h4>
              <ul className="entry-list" aria-label="Errors while playing">
                {paths.data.errors.map((error) => (
                  <li key={error.message}>
                    <span className="coordinate-label">error</span>
                    <span>{error.message}</span>
                    <Link
                      to={`${book}/branches/play?${new URLSearchParams({
                        seed: '1',
                        ...(error.path.length === 0 ? {} : { path: error.path.join('.') }),
                      }).toString()}`}
                    >
                      Reproduce in Play ({plural(error.path.length, 'choice', 'choices')})
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {paths.data.unreached.length > 0 ? (
            <>
              <h4>
                {paths.data.complete ? 'No path reaches' : 'Not reached in the states played'}
              </h4>
              {paths.data.complete ? null : (
                <p className="coordinate-label">
                  The rest of the story was not played, so these may still be reachable.
                </p>
              )}
              <ul className="entry-list" aria-label="Knots no path reaches">
                {paths.data.unreached.map((node) => (
                  <li key={node.node}>
                    <strong>{node.title}</strong>
                    <span className="coordinate-label">{node.node}</span>
                    {place(node.path, node.line)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {paths.data.neverOffered.length > 0 ? (
            <>
              <h4>
                {paths.data.complete
                  ? 'Choices never offered'
                  : 'Choices not offered in the states played'}
              </h4>
              {paths.data.complete ? null : (
                <p className="coordinate-label">
                  The rest of the story was not played, so these may still be offered.
                </p>
              )}
              <ul className="entry-list" aria-label="Choices never offered">
                {paths.data.neverOffered.map((choice) => (
                  <li key={`${choice.node}:${choice.line ?? ''}:${choice.text}`}>
                    <strong>{choice.text}</strong>
                    <span className="coordinate-label">{choice.node}</span>
                    {place(choice.path, choice.line)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
