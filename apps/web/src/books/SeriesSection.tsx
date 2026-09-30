import type { BookSummary } from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { groupLibrary } from './library-groups.js';
import { errorMessage, useLoad } from './useLoad.js';

/** New linked books append after the highest numbered book, avoiding duplicate numbers. */
function nextBookNumber(books: BookSummary[]): number {
  const numbers = books.flatMap((book) => (book.bookNumber === null ? [] : [book.bookNumber]));
  return Math.max(0, ...numbers) + 1;
}

/**
 * The Project tab's series controls (ADR 0018): make a standalone book a
 * series or move it into one, and add books to the series a book belongs to.
 */
export function SeriesSection() {
  const api = useApi();
  const navigate = useNavigate();
  const { slug, tree, reload } = useBook();
  const book = tree.book;
  const library = useLoad((signal) => api.listBooks(signal), `library:${book.seriesId ?? ''}`);
  const [seriesTitle, setSeriesTitle] = useState(book.title);
  const [joinId, setJoinId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [follows, setFollows] = useState(book.kind === 'book' ? slug : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = library.status === 'ready' ? groupLibrary(library.data).series : [];
  const own = groups.find((group) => group.id === book.seriesId);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function makeSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = seriesTitle.trim();
    if (title === '') {
      setError('Enter a title for the series.');
      return;
    }
    void run(async () => {
      await api.moveBookToSeries(slug, { newSeriesTitle: title });
      reload();
      library.reload();
    });
  }

  function joinSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinId === '') return;
    void run(async () => {
      await api.moveBookToSeries(slug, { seriesId: joinId });
      reload();
      library.reload();
    });
  }

  function addBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (title === '' || book.seriesId === null) {
      setError('Enter a title for the new book.');
      return;
    }
    const books = own?.books ?? [];
    const anchor = books.find((candidate) => candidate.slug === follows);
    const seriesId = book.seriesId;
    void run(async () => {
      const created = await api.addSeriesBook(seriesId, {
        title,
        ...(anchor === undefined ? {} : { follows: anchor.slug }),
        bookNumber: nextBookNumber(books),
      });
      await navigate(`/books/${created.slug}`);
    });
  }

  const errorNote =
    error === null ? null : (
      <p className="form-error" role="alert">
        {error}
      </p>
    );

  if (book.seriesId === null) {
    return (
      <section className="series-section" aria-labelledby="series-heading">
        <h3 id="series-heading">Series</h3>
        <p>This book stands alone. Make it the first book of a series to share a series bible.</p>
        <form className="series-form" onSubmit={makeSeries}>
          <label htmlFor="new-series-title">New series title</label>
          <div className="field-action">
            <input
              id="new-series-title"
              value={seriesTitle}
              onChange={(event) => setSeriesTitle(event.target.value)}
              maxLength={300}
            />
            <button type="submit" className="button-primary" disabled={busy}>
              Make this a series
            </button>
          </div>
        </form>
        {groups.length === 0 ? null : (
          <form className="series-form" onSubmit={joinSeries}>
            <label htmlFor="join-series">Or join a series</label>
            <div className="field-action">
              <select
                id="join-series"
                value={joinId}
                onChange={(event) => setJoinId(event.target.value)}
              >
                <option value="">Choose a series</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.bible?.title ?? group.id}
                  </option>
                ))}
              </select>
              <button type="submit" className="button-secondary" disabled={busy || joinId === ''}>
                Join series
              </button>
            </div>
          </form>
        )}
        {errorNote}
      </section>
    );
  }

  const seriesTitleText = own?.bible?.title ?? book.seriesId;
  const books = own?.books ?? [];
  return (
    <section className="series-section" aria-labelledby="series-heading">
      <h3 id="series-heading">Series</h3>
      {book.kind === 'series-bible' ? (
        <p>
          The canon shared by the books of {seriesTitleText}: characters, places, terms, and the
          series timeline.
        </p>
      ) : (
        <p>
          {book.bookNumber === null ? 'A book' : `Book ${book.bookNumber}`} of{' '}
          <Link to={`/books/${book.seriesId}`}>{seriesTitleText}</Link>.
        </p>
      )}
      {library.status === 'loading' ? <LoadingState>Reading the series…</LoadingState> : null}
      <form className="series-form" onSubmit={addBook}>
        <label htmlFor="series-book-title">Add a book to this series</label>
        <input
          id="series-book-title"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="Title"
          maxLength={300}
        />
        <label htmlFor="series-book-follows">Comes after</label>
        <div className="field-action">
          <select
            id="series-book-follows"
            value={follows}
            onChange={(event) => setFollows(event.target.value)}
          >
            <option value="">No book (not linked)</option>
            {books.map((candidate) => (
              <option key={candidate.slug} value={candidate.slug}>
                {candidate.title}
              </option>
            ))}
          </select>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add book'}
          </button>
        </div>
      </form>
      {errorNote}
    </section>
  );
}
