import type { BookCheckResult } from '@worldbookllm/shared';
import { Link } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
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
