import {
  seriesEntitySchema,
  type BookCheckResult,
  type SeriesHealth,
  type SeriesSummary,
  type SeriesSyncInput,
} from '@worldbookllm/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { fileHref } from './book-sections.js';
import { errorMessage, useLoad } from './useLoad.js';

/** A series-wide reference view; books stay navigable even if a CLI check fails. */
export function SeriesPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const series = useLoad((signal) => api.getSeries(id, signal), id);
  const health = useLoad((signal) => api.getSeriesHealth(id, signal), id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function sync(input: SeriesSyncInput) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.syncSeries(id, input);
      setNotice(
        `Series sync recorded in ${result.checkpoints.length} ${result.checkpoints.length === 1 ? 'book' : 'books'}. Undo is available in each book’s Project history.`,
      );
      health.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
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
      {error === null ? null : (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice === null ? null : <p role="status">{notice}</p>}
      <CarryForm series={series.data} busy={busy} onSync={(input) => void sync(input)} />
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
        <SeriesHealthView
          health={health.data}
          bible={series.data.bible.slug}
          busy={busy}
          onSync={(input) => void sync(input)}
        />
      ) : null}
    </section>
  );
}

function SeriesHealthView({
  health,
  bible,
  busy,
  onSync,
}: {
  health: SeriesHealth;
  bible: string;
  busy: boolean;
  onSync(input: SeriesSyncInput): void;
}) {
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
              <div className="field-action">
                <button
                  className="button-primary"
                  disabled={busy}
                  onClick={() =>
                    onSync({ direction: 'push', entity: row.entity, books: [row.book] })
                  }
                  aria-label={`Push ${row.entity.id} to ${row.book}`}
                >
                  Push bible canon
                </button>
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => onSync({ direction: 'pull', entity: row.entity, book: row.book })}
                  aria-label={`Pull ${row.entity.id} from ${row.book}`}
                >
                  Pull into bible
                </button>
              </div>
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

function CarryForm({
  series,
  busy,
  onSync,
}: {
  series: SeriesSummary;
  busy: boolean;
  onSync(input: SeriesSyncInput): void;
}) {
  const api = useApi();
  const tree = useLoad((signal) => api.getBookTree(series.bible.slug, signal), series.id);
  const [entity, setEntity] = useState('');
  const [book, setBook] = useState('');
  if (series.books.length === 0) return null;
  if (tree.status === 'loading') return <LoadingState>Reading bible entities…</LoadingState>;
  if (tree.status === 'error')
    return (
      <ErrorState
        title="Bible entities could not load"
        message={tree.message}
        onRetry={tree.reload}
      />
    );
  const entities = tree.data.files.filter(
    (file) => seriesEntitySchema.safeParse({ kind: file.kind, id: file.entityId }).success,
  );
  return (
    <section aria-labelledby="carry-heading">
      <h2 id="carry-heading">Carry canon into a book</h2>
      <p>Creates a missing entity with fresh local state. Existing copies are never overwritten.</p>
      <form
        className="series-form"
        onSubmit={(event) => {
          event.preventDefault();
          const [kind, id] = entity.split(':');
          const parsed = seriesEntitySchema.safeParse({ kind, id });
          if (parsed.success && book !== '')
            onSync({ direction: 'carry', entity: parsed.data, book });
        }}
      >
        <label htmlFor="carry-entity">Bible entity</label>
        <select
          id="carry-entity"
          value={entity}
          onChange={(event) => setEntity(event.target.value)}
          disabled={busy}
        >
          <option value="">Choose an entity</option>
          {entities.map((file) => (
            <option key={file.path} value={`${file.kind}:${file.entityId}`}>
              {file.title} · {file.kind}
            </option>
          ))}
        </select>
        <label htmlFor="carry-book">Carry into book</label>
        <select
          id="carry-book"
          value={book}
          onChange={(event) => setBook(event.target.value)}
          disabled={busy}
        >
          <option value="">Choose a book</option>
          {series.books.map((book) => (
            <option key={book.slug} value={book.slug}>
              {book.title}
            </option>
          ))}
        </select>
        <button className="button-secondary" disabled={busy || entity === '' || book === ''}>
          Carry entity
        </button>
      </form>
    </section>
  );
}
