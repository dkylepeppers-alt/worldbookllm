import { Link, NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="wordmark" to="/books">
          worldbookllm
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <NavLink to="/books">Books</NavLink>
          <NavLink to="/agents">Agents</NavLink>
          <NavLink to="/skills">Skills</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
