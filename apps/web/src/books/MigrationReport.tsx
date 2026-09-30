import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { useLoad } from './useLoad.js';

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/**
 * The one-time report of notebooks moved into books when the notebook era
 * ended (ADR 0017), shown on the library until the writer dismisses it.
 */
export function MigrationReport() {
  const api = useApi();
  const report = useLoad((signal) => api.getNotebookMigration(signal), 'notebook-migration');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || report.status !== 'ready') return null;
  if (report.data.seen || report.data.entries.length === 0) return null;

  function dismiss() {
    setDismissed(true);
    void api.markNotebookMigrationSeen().catch(() => undefined);
  }

  const entries = report.data.entries;
  return (
    <section className="agent-notice migration-report" aria-label="Notebooks moved into books">
      <p className="coordinate-label">Notebooks moved</p>
      <p>
        Your {count(entries.length, 'notebook is', 'notebooks are')} now{' '}
        {entries.length === 1 ? 'a book' : 'books'}. Sources became research notes and chats
        continue in each book's Agent tab. The original files are kept in{' '}
        <code>data/notebooks.migrated/</code>.
      </p>
      <ul className="entry-list">
        {entries.map((entry) => (
          <li key={entry.bookSlug}>
            <Link to={`/books/${encodeURIComponent(entry.bookSlug)}`}>{entry.notebookName}</Link>
            <span className="coordinate-label">
              {count(entry.fileCount, 'research note', 'research notes')} of{' '}
              {count(entry.sourceCount, 'source', 'sources')} ·{' '}
              {count(entry.chatCount, 'chat', 'chats')}
            </span>
            {entry.error === null ? null : (
              <span className="form-error">Its sources could not be written: {entry.error}</span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="button-secondary" onClick={dismiss}>
        Dismiss
      </button>
    </section>
  );
}
