import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="route-message" aria-labelledby="not-found-title">
      <p className="coordinate-label">Uncharted route</p>
      <h1 id="not-found-title">Page not found</h1>
      <p>This address is outside the current notebook map.</p>
      <Link to="/">Return to notebooks</Link>
    </section>
  );
}
