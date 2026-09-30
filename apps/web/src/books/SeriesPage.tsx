import type { BookCheckResult, SeriesHealth } from '@worldbookllm/shared';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { fileHref } from './book-sections.js';
import { useLoad } from './useLoad.js';

/** A series-wide reference view; books stay navigable even if a CLI check fails. */
export function SeriesPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const series = useLoad((signal) => api.getSeries(id, signal), id);
  const health = useLoad((signal) => api.getSeriesHealth(id, signal), id);
  if (series.status === 'loading') return <LoadingState>Reading series…</LoadingState>;
  if (series.status === 'error')
    return (
      <ErrorState title="Series could not load" message={series.message} onRetry={series.reload} />
    );
  return (
    <section className="book-library">
      <header className="page-intro">
        <Link to="/books">Library</Link>
        <h1>{series.data.bible.title}</h1>
        <p>Shared canon, book copies, and checks across this series.</p>
      </header>
      <h2>Books</h2>
      <ul className="entry-list">
        <li>
          <Link to={`/books/${series.data.bible.slug}`}>Series bible</Link>
        </li>
        {series.data.books.map((book) => (
          <li key={book.slug}>
            <Link to={`/books/${book.slug}`}>{book.title}</Link>
            {book.bookNumber === null ? null : <span>Book {book.bookNumber}</span>}
          </li>
        ))}
      </ul>
      {series.data.books.length === 0 ? (
        <p>No books yet. Add one from the bible’s Project tab.</p>
      ) : null}
      {health.status === 'loading' ? (
        <LoadingState>Checking series canon and links…</LoadingState>
      ) : null}
      {health.status === 'error' ? (
        <ErrorState
          title="Series health could not load"
          message={health.message}
          onRetry={health.reload}
        />
      ) : null}
      {health.status === 'ready' ? (
        <SeriesHealthView health={health.data} bible={series.data.bible.slug} />
      ) : null}
    </section>
  );
}

function SeriesHealthView({ health, bible }: { health: SeriesHealth; bible: string }) {
  const checks: Array<{ book: string; result: BookCheckResult }> = [
    { book: bible, result: health.series },
    ...health.links,
  ];
  return (
    <>
      <h2>Canon drift</h2>
      <p>Only identity fields are compared. Book-local state is left alone.</p>
      {health.drift.length === 0 ? (
        <p>No canon drift in existing book copies.</p>
      ) : (
        <ul className="entry-list" aria-label="Canon drift">
          {health.drift.map((row) => (
            <li key={`${row.entity.kind}:${row.entity.id}:${row.book}`}>
              <strong>{row.entity.id}</strong>
              <span>
                {row.entity.kind} · {row.book}
              </span>
              <span>{row.fields.map((field) => field.replace(/^body:/u, '')).join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      <h2>Series health</h2>
      <ul className="entry-list" aria-label="Series checks">
        {checks.map(({ book, result }) => (
          <li key={`${book}:${result.command}`}>
            <strong>
              {book} · {result.command}
            </strong>
            <span>
              {result.envelope.ok && result.exitCode === 0 ? 'Passed' : 'Needs attention'}
            </span>
            {result.envelope.diagnostics.map((finding, index) => (
              <div key={index}>
                <span>{finding.severity}: </span>
                <span>{finding.message}</span>{' '}
                {typeof finding.file === 'string' && result.command === 'links' ? (
                  <Link to={fileHref(book, finding.file)}>{finding.file}</Link>
                ) : null}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
