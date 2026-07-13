import { Link, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="wordmark" to="/">
          worldbookllm
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link to="/">Notebooks</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
