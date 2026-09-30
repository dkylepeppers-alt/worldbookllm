import type { BookEntityKind } from '@worldbookllm/shared';
import { Link, useSearchParams } from 'react-router-dom';

import { AddEntityForm } from './AddEntityForm.js';
import { useBook } from './book-context.js';
import { BIBLE_SECTIONS, fileHref, filesOfKind, KIND_LABELS } from './book-sections.js';

const DIRECTORIES: Readonly<Partial<Record<BookEntityKind, string>>> = {
  character: 'characters',
  location: 'worldbuilding/locations',
  system: 'worldbuilding/systems',
  faction: 'worldbuilding/factions',
  artifact: 'worldbuilding/artifacts',
  arc: 'plot/arcs',
  question: 'continuity/questions',
  promise: 'continuity/promises',
  clue: 'continuity/clues',
  term: 'glossary/terms',
  matter: 'matter',
  research: 'research',
};

/** The story bible, grouped into sections of story-skills entity kinds. */
export function BiblePage() {
  const { slug, tree } = useBook();
  const [params, setParams] = useSearchParams();
  const section =
    BIBLE_SECTIONS.find((entry) => entry.id === params.get('section')) ?? BIBLE_SECTIONS[0];
  if (!section) return null;
  const entries = filesOfKind(tree.files, section.kinds);
  const singletons = section.files
    .map((path) => tree.files.find((file) => file.path === path))
    .filter((file) => file !== undefined);

  return (
    <section className="book-panel" aria-labelledby="bible-heading">
      <p className="coordinate-label">Story bible</p>
      <h2 id="bible-heading">{section.label}</h2>
      <div className="section-switch" role="group" aria-label="Bible sections">
        {BIBLE_SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === section.id}
            onClick={() => setParams({ section: entry.id })}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {singletons.length > 0 ? (
        <ul className="entry-list">
          {singletons.map((file) => (
            <li key={file.path}>
              <Link to={fileHref(slug, file.path)}>{KIND_LABELS[file.kind] ?? file.title}</Link>
              <span className="coordinate-label">{file.path}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {entries.length === 0 ? (
        <p className="empty-map">Nothing here yet.</p>
      ) : (
        <ul className="entry-list" aria-label={section.label}>
          {entries.map((file) => (
            <li key={file.path}>
              <Link to={fileHref(slug, file.path)}>{file.title}</Link>
              <span className="coordinate-label">{KIND_LABELS[file.kind] ?? file.kind}</span>
            </li>
          ))}
        </ul>
      )}
      <AddEntityForm key={section.id} kinds={section.kinds} directories={DIRECTORIES} />
    </section>
  );
}
