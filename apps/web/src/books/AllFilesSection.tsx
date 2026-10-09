import type { BookFile } from '@worldbookllm/shared';
import { Link } from 'react-router-dom';

import { useBook } from './book-context.js';
import { fileHref, KIND_LABELS } from './book-sections.js';

interface Folder {
  path: string;
  files: BookFile[];
}

/** Groups files by their folder, book root first, then folders in path order. */
function groupByFolder(files: readonly BookFile[]): Folder[] {
  const folders = new Map<string, BookFile[]>();
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const slash = file.path.lastIndexOf('/');
    const folder = slash === -1 ? '' : file.path.slice(0, slash);
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
  return [...folders.entries()]
    .map(([path, entries]) => ({ path, files: entries }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Every file in the book, by folder: the same set the agent can list, so
 * nothing on disk is reachable only through the agent.
 */
export function AllFilesSection() {
  const { slug, tree } = useBook();
  const folders = groupByFolder(tree.files);
  return (
    <>
      <h3>All files</h3>
      {folders.length === 0 ? (
        <p className="empty-map">This book has no files yet.</p>
      ) : (
        folders.map((folder) => (
          <details key={folder.path} className="file-folder">
            <summary>
              {folder.path === '' ? 'Book folder' : `${folder.path}/`} · {folder.files.length}
            </summary>
            <ul
              className="entry-list"
              aria-label={folder.path === '' ? 'Book folder' : folder.path}
            >
              {folder.files.map((file) => (
                <li key={file.path}>
                  <Link to={fileHref(slug, file.path)}>{file.title}</Link>
                  <span className="coordinate-label">
                    {KIND_LABELS[file.kind] ?? file.kind} · {file.path}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
    </>
  );
}
