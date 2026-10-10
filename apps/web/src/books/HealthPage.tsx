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

/** story-skills findings about choices and the paths through them. */
const PATH_CODES = new Set(['invalid-choice', 'unreachable-chapter', 'state-differs-by-path']);

function isPathFinding(finding: { code?: string; message: string }): boolean {
  return (
    PATH_CODES.has(finding.code ?? '') ||
    (finding.code === 'missing-reference' && /choices\[\d+\]/u.test(finding.message))
  );
}

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
      const [report, next, branches] = await Promise.all([
        api.runBookCheck(slug, 'report', signal),
        api.runBookCheck(slug, 'next', signal),
        tree.book.interactive === true ? api.getBranches(slug, signal) : Promise.resolve(null),
      ]);
      return { report, next, branches };
    },
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );

  if (health.status === 'loading') return <LoadingState>Running story checks…</LoadingState>;
  if (health.status === 'error') {
    return (
      <ErrorState title="Checks could not run" message={health.message} onRetry={health.reload} />
    );
  }

  const { report, next, branches } = health.data;
  const findings = report.envelope.diagnostics;
  const pathFindings = findings.filter(isPathFinding);
  const stateProblems =
    branches?.chapters.flatMap((chapter) =>
      chapter.problems.map((problem) => ({ chapter, problem })),
    ) ?? [];
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

      {branches === null ? null : (
        <section className="health-paths" aria-labelledby="health-paths-heading">
          <h3 id="health-paths-heading">Paths</h3>
          <p>
            story-skills follows every path of choices: a chapter no path reaches, a choice to a
            missing chapter, or state that differs by the path that led to a chapter. It does not
            read the flags choices set or require, so check those by playing the story.
          </p>
          {pathFindings.length === 0 && stateProblems.length === 0 ? (
            <p className="coordinate-label">No path problems.</p>
          ) : (
            <ul className="entry-list" aria-label="Path findings">
              {pathFindings.map((finding, index) => {
                const chapter =
                  typeof finding.file === 'string'
                    ? branches.chapters.find((entry) => entry.path === finding.file)
                    : undefined;
                return (
                  <li key={`${index}:${finding.message}`}>
                    <span className="coordinate-label">{finding.severity}</span>
                    <span>{finding.message}</span>
                    {typeof finding.file !== 'string' ? null : chapter === undefined ? (
                      <Link to={fileHref(slug, finding.file)}>{finding.file}</Link>
                    ) : (
                      <Link
                        to={`/books/${encodeURIComponent(slug)}/branches/edit#branch-${chapter.id}`}
                      >
                        {chapter.title}
                      </Link>
                    )}
                  </li>
                );
              })}
              {stateProblems.map(({ chapter, problem }) => (
                <li key={`${chapter.id}:${problem}`}>
                  <span className="coordinate-label">choices</span>
                  <span>
                    {chapter.title}: {problem}
                  </span>
                  <Link
                    to={`/books/${encodeURIComponent(slug)}/branches/edit#branch-${chapter.id}`}
                  >
                    Edit the choices
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link to={`/books/${encodeURIComponent(slug)}/branches/play`}>Play the story</Link>
          </p>
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
