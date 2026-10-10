import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';

import { AgentRunnerProvider } from '../agent/agent-runner.js';
import { useAgentRunner } from '../agent/agent-runner-context.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { BookContext, useBook } from './book-context.js';
import { useLoad } from './useLoad.js';

const TABS = [
  { to: 'write', label: 'Write' },
  { to: 'branches', label: 'Branches', interactiveOnly: true },
  { to: 'read', label: 'Reader', booksOnly: true },
  { to: 'bible', label: 'Bible' },
  { to: 'agent', label: 'Agent' },
  { to: 'health', label: 'Health' },
  { to: 'project', label: 'Project' },
] as const;

/**
 * A book's workspace: the tab screens render in the outlet, and the tab bar
 * sits at the bottom on phones and becomes a side rail on wider screens.
 */
export function BookLayout() {
  const api = useApi();
  const slug = useParams().slug ?? '';
  const tree = useLoad((signal) => api.getBookTree(slug, signal), slug);
  const importReport = useImportReport();

  if (tree.status === 'loading') return <LoadingState>Opening the book…</LoadingState>;
  if (tree.status === 'error') {
    return (
      <ErrorState title="This book could not open" message={tree.message} onRetry={tree.reload} />
    );
  }

  return (
    <BookContext.Provider value={{ slug, tree: tree.data, reload: tree.reload }}>
      <AgentRunnerProvider key={slug} onBookChanged={tree.reload}>
        <div className="book-layout">
          <header className="book-header">
            <Link className="coordinate-label" to="/books">
              ← Books
            </Link>
            {tree.data.book.kind === 'series-bible' ? (
              <p className="coordinate-label">Series bible</p>
            ) : null}
            <h1>{tree.data.book.title}</h1>
          </header>
          {importReport === null ? null : <ImportReport report={importReport} slug={slug} />}
          <BookTabs />
          <div className="book-body">
            <Outlet />
          </div>
        </div>
      </AgentRunnerProvider>
    </BookContext.Provider>
  );
}

/** What an import just did (files kept and skipped, validation), passed in navigation state. */
function useImportReport(): string | null {
  const state: unknown = useLocation().state;
  const report =
    typeof state === 'object' && state !== null && 'importReport' in state
      ? state.importReport
      : null;
  return typeof report === 'string' && report !== '' ? report : null;
}

function ImportReport({ report, slug }: { report: string; slug: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <section className="import-report" role="status" aria-label="Import report">
      <pre className="build-output">{report}</pre>
      <p>
        Next, <Link to={`/books/${encodeURIComponent(slug)}/agent`}>build the bible</Link> with the
        agent: cast and places, each chapter's scenes, and open threads.
      </p>
      <button type="button" className="button-secondary" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </section>
  );
}

/** The tab bar; the Agent tab carries a pulse while a turn runs. */
function BookTabs() {
  const { run } = useAgentRunner();
  const { tree } = useBook();
  // A series bible has no chapters, so nothing to read.
  // An interactive book (an IFID, or chapters with choices) gets a Branches tab.
  const tabs = TABS.filter(
    (tab) =>
      (!('booksOnly' in tab) || tree.book.kind === 'book') &&
      (!('interactiveOnly' in tab) || tree.book.interactive === true),
  );
  return (
    <nav className="book-tabs" aria-label="Book">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={tab.to === 'agent' && run !== null ? 'tab-working' : undefined}
        >
          {tab.label}
          {tab.to === 'agent' && run !== null ? (
            <span className="visually-hidden"> (working)</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
