import { Link } from 'react-router-dom';

import { AddEntityForm } from './AddEntityForm.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';

/** The manuscript: chapters in reading order, each with its scenes. */
export function WritePage() {
  const { slug, tree } = useBook();
  const chapters = tree.files
    .filter((file) => file.kind === 'chapter' && file.entityId !== null)
    .sort((left, right) => (left.entityId ?? '').localeCompare(right.entityId ?? ''));
  const scenes = tree.files.filter((file) => file.kind === 'scene' && file.entityId !== null);

  return (
    <section className="book-panel" aria-labelledby="write-heading">
      <p className="coordinate-label">Manuscript</p>
      <h2 id="write-heading">Chapters</h2>
      {chapters.length === 0 ? (
        <p className="empty-map">No chapters yet. Add the first one below.</p>
      ) : (
        <ol className="entry-list">
          {chapters.map((chapter) => {
            const count = scenes.filter((scene) =>
              scene.entityId?.startsWith(`${chapter.entityId ?? ''}-scene-`),
            ).length;
            return (
              <li key={chapter.path}>
                <Link to={fileHref(slug, chapter.path)}>{chapter.title}</Link>
                <span className="coordinate-label">
                  {chapter.entityId} · {count} {count === 1 ? 'scene' : 'scenes'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <AddEntityForm kinds={['chapter']} directories={{ chapter: 'chapters' }} />
    </section>
  );
}
