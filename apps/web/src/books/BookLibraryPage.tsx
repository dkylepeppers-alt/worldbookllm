import type { BookSummary } from '@worldbookllm/shared';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { groupLibrary } from './library-groups.js';
import { MigrationReport } from './MigrationReport.js';
import { errorMessage, useLoad } from './useLoad.js';

function countLabel(book: BookSummary): string {
  const chapters = book.counts.chapter ?? 0;
  const cast = book.counts.character ?? 0;
  return `${chapters} ${chapters === 1 ? 'chapter' : 'chapters'} · ${cast} in cast`;
}

function BookCard({ book, index, label }: { book: BookSummary; index: number; label?: string }) {
  return (
    <li className="book-card">
      <span className="map-index" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      {label === undefined ? null : <p className="coordinate-label">{label}</p>}
      <Link className="book-link" to={`/books/${book.slug}`}>
        <h2>{book.title}</h2>
      </Link>
      <p className="coordinate-label">{[book.genre, book.status].filter(Boolean).join(' · ')}</p>
      <p className="coordinate-label">{countLabel(book)}</p>
    </li>
  );
}

/** The library of story-skills books (ADR 0014), with each series gathered behind its bible (ADR 0018). */
export function BookLibraryPage() {
  const api = useApi();
  const navigate = useNavigate();
  const books = useLoad((signal) => api.listBooks(signal), 'books');
  const conflicts = useLoad((signal) => api.listBookConflicts(signal), 'conflicts');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<'create' | 'series' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Enter a title for the book.');
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const created = await api.createBook({ title: trimmed });
      await navigate(`/books/${created.slug}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateSeries() {
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Enter a title for the series.');
      return;
    }
    setBusy('series');
    setError(null);
    try {
      const bible = await api.createSeries({ title: trimmed });
      await navigate(`/books/${bible.slug}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('import');
    setError(null);
    try {
      const result = await api.importManuscript(file);
      await navigate(`/books/${result.book.slug}/write`, {
        state: { importReport: result.output },
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="book-library">
      <header className="page-intro">
        <p className="coordinate-label">Library</p>
        <h1>Books</h1>
        <p>
          Each book is a story-skills project: plain Markdown files for the manuscript, cast, world,
          and continuity, checked by the <code>story</code> tool.
        </p>
      </header>

      <MigrationReport />
      {conflicts.status === 'error' ? (
        <ErrorState
          title="Folder conflicts could not be checked"
          message={conflicts.message}
          onRetry={conflicts.reload}
        />
      ) : null}
      {conflicts.status !== 'ready' || conflicts.data.length === 0 ? null : (
        <section role="alert">
          <h2>Duplicate book folders</h2>
          <p>
            These later copies share a slug with an existing book and cannot be opened. Rename or
            move the conflicting folders on disk before using them.
          </p>
          <ul>
            {conflicts.data.map((conflict) => (
              <li key={conflict.path}>
                <code>{conflict.path}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="book-create" onSubmit={(event) => void handleCreate(event)}>
        <label htmlFor="new-book-title">New book or series title</label>
        <div className="field-action">
          <input
            id="new-book-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The Salt Road"
            maxLength={300}
          />
          <button type="submit" className="button-primary" disabled={busy !== null}>
            {busy === 'create' ? 'Creating…' : 'Create book'}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy !== null}
            onClick={() => void handleCreateSeries()}
          >
            {busy === 'series' ? 'Creating…' : 'Create series'}
          </button>
        </div>
        <label className="button-secondary file-button">
          {busy === 'import' ? 'Importing…' : 'Import a manuscript or project (.md, .txt, .zip)'}
          <input
            type="file"
            accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip"
            onChange={(event) => void handleImport(event)}
            disabled={busy !== null}
          />
        </label>
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {books.status === 'loading' ? <LoadingState>Charting books…</LoadingState> : null}
      {books.status === 'error' ? (
        <ErrorState title="Books could not load" message={books.message} onRetry={books.reload} />
      ) : null}
      {books.status === 'ready' ? (
        books.data.length === 0 ? (
          <p className="empty-map">
            No books yet. Create one, or import a manuscript or a zipped project.
          </p>
        ) : (
          <LibraryGroupsView books={books.data} />
        )
      ) : null}
    </section>
  );
}

function LibraryGroupsView({ books }: { books: BookSummary[] }) {
  const { standalone, series } = groupLibrary(books);
  let index = 0;
  return (
    <>
      {standalone.length === 0 ? null : (
        <ul className="book-grid" aria-label="Books">
          {standalone.map((book) => (
            <BookCard key={book.slug} book={book} index={index++} />
          ))}
        </ul>
      )}
      {series.map((group) => {
        const title = group.bible?.title ?? group.id;
        return (
          <section key={group.id} className="series-group" aria-labelledby={`series-${group.id}`}>
            <p className="coordinate-label">
              Series · {group.books.length} {group.books.length === 1 ? 'book' : 'books'}
            </p>
            <h2 id={`series-${group.id}`}>{title}</h2>
            {group.bible === null ? null : (
              <p>
                <Link to={`/series/${group.id}`}>Series overview</Link>
              </p>
            )}
            {group.bible === null ? null : (
              <Link className="series-bible-link" to={`/books/${group.bible.slug}`}>
                Series bible
              </Link>
            )}
            {group.books.length === 0 ? (
              <p className="empty-map">No books in this series yet. Add one from its bible.</p>
            ) : (
              <ul className="book-grid" aria-label={`Books in ${title}`}>
                {group.books.map((book) => (
                  <BookCard
                    key={book.slug}
                    book={book}
                    index={index++}
                    label={book.bookNumber === null ? undefined : `Book ${book.bookNumber}`}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
