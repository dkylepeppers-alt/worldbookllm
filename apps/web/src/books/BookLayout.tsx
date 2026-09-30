import { Link, NavLink, Outlet, useParams } from 'react-router-dom';

import { AgentRunnerProvider } from '../agent/agent-runner.js';
import { useAgentRunner } from '../agent/agent-runner-context.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { BookContext } from './book-context.js';
import { useLoad } from './useLoad.js';

const TABS = [
  { to: 'write', label: 'Write' },
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
            <h1>{tree.data.book.title}</h1>
          </header>
          <BookTabs />
          <div className="book-body">
            <Outlet />
          </div>
        </div>
      </AgentRunnerProvider>
    </BookContext.Provider>
  );
}

/** The tab bar; the Agent tab carries a pulse while a turn runs. */
function BookTabs() {
  const { run } = useAgentRunner();
  return (
    <nav className="book-tabs" aria-label="Book">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={tab.to === 'agent' && run !== null ? 'tab-working' : undefined}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
