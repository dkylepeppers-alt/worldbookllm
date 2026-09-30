import type { BookSummary } from '@worldbookllm/shared';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { MigrationReport } from './MigrationReport.js';
import { errorMessage, useLoad } from './useLoad.js';

function countLabel(book: BookSummary): string {
  const chapters = book.counts.chapter ?? 0;
  const cast = book.counts.character ?? 0;
  return `${chapters} ${chapters === 1 ? 'chapter' : 'chapters'} · ${cast} in cast`;
}

/** The library of story-skills books (ADR 0014). */
export function BookLibraryPage() {
  const api = useApi();
  const navigate = useNavigate();
  const books = useLoad((signal) => api.listBooks(signal), 'books');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<'create' | 'import' | null>(null);
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

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('import');
    setError(null);
    try {
      const result = await api.importManuscript(file);
      await navigate(`/books/${result.book.slug}`);
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

      <form className="book-create" onSubmit={(event) => void handleCreate(event)}>
        <label htmlFor="new-book-title">New book title</label>
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
        </div>
        <label className="button-secondary file-button">
          {busy === 'import' ? 'Importing…' : 'Import a manuscript (.md or .txt)'}
          <input
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
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
          <p className="empty-map">No books yet. Create one or import a manuscript.</p>
        ) : (
          <ul className="book-grid" aria-label="Books">
            {books.data.map((book, index) => (
              <li key={book.slug} className="book-card">
                <span className="map-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Link className="book-link" to={`/books/${book.slug}`}>
                  <h2>{book.title}</h2>
                </Link>
                <p className="coordinate-label">
                  {[book.genre, book.status].filter(Boolean).join(' · ')}
                </p>
                <p className="coordinate-label">{countLabel(book)}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
