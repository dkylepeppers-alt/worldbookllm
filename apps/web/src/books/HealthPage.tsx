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
      const [report, next] = await Promise.all([
        api.runBookCheck(slug, 'report', signal),
        api.runBookCheck(slug, 'next', signal),
      ]);
      return { report, next };
    },
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );

  if (health.status === 'loading') return <LoadingState>Running story checks…</LoadingState>;
  if (health.status === 'error') {
    return (
      <ErrorState title="Checks could not run" message={health.message} onRetry={health.reload} />
    );
  }

  const { report, next } = health.data;
  const findings = report.envelope.diagnostics;
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
