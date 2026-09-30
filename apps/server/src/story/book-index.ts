import type Database from 'better-sqlite3';
import matter from 'gray-matter';

import type { BookFile, BookFileKind, BookSearchResult } from '@worldbookllm/shared';

import { toFtsMatchQuery } from '../services/source-search.js';
import type { BookFileStore } from './book-files.js';
import { sha256 } from './book-files.js';
import { classifyBookPath } from './book-paths.js';

interface BookFileRow {
  book: string;
  path: string;
  kind: string;
  entity_id: string | null;
  title: string;
  hash: string;
  size: number;
  mtime_ms: number;
  frontmatter_json: string | null;
}

/** Matches bookSearchResultSchema's excerpt cap in @worldbookllm/shared. */
const EXCERPT_MAX = 1000;

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  try {
    const parsed = matter(content);
    const data = parsed.data as Record<string, unknown>;
    return {
      frontmatter: Object.keys(data).length === 0 ? null : data,
      body: parsed.content,
    };
  } catch {
    return { frontmatter: null, body: content };
  }
}

function titleFor(
  frontmatter: Record<string, unknown> | null,
  entityId: string | null,
  path: string,
): string {
  for (const key of ['title', 'name', 'term']) {
    const value = frontmatter?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return entityId ?? path;
}

function toBookFile(row: BookFileRow): BookFile {
  return {
    path: row.path,
    kind: row.kind as BookFileKind,
    entityId: row.entity_id,
    title: row.title,
    hash: row.hash,
    size: row.size,
    updatedAt: new Date(row.mtime_ms).toISOString(),
  };
}

/**
 * The SQLite index over one or more books' Markdown files (ADR 0014
 * decision 2). The disk is the source of truth: `reconcile` rescans a book,
 * re-reading only files whose size or mtime changed, and drops rows for
 * files that are gone, so edits made outside the app show up on next access.
 * Each book carries a revision number that moves whenever reconciliation
 * finds a change; callers key caches on it.
 */
export class BookIndex {
  private readonly revisions = new Map<string, number>();

  constructor(
    private readonly db: Database.Database,
    private readonly files: BookFileStore,
  ) {}

  revision(book: string): number {
    return this.revisions.get(book) ?? 0;
  }

  /** Brings the index for one book in line with the disk; returns whether anything changed. */
  reconcile(book: string): boolean {
    const onDisk = this.files.listFiles(book);
    const rows = new Map(
      (this.db.prepare('SELECT * FROM book_files WHERE book = ?').all(book) as BookFileRow[]).map(
        (row) => [row.path, row],
      ),
    );
    const upsert = this.db.prepare(
      `INSERT INTO book_files (book, path, kind, entity_id, title, hash, size, mtime_ms, frontmatter_json)
       VALUES (@book, @path, @kind, @entity_id, @title, @hash, @size, @mtime_ms, @frontmatter_json)
       ON CONFLICT (book, path) DO UPDATE SET kind = excluded.kind, entity_id = excluded.entity_id,
         title = excluded.title, hash = excluded.hash, size = excluded.size,
         mtime_ms = excluded.mtime_ms, frontmatter_json = excluded.frontmatter_json`,
    );
    const deleteRow = this.db.prepare('DELETE FROM book_files WHERE book = ? AND path = ?');
    const deleteSearch = this.db.prepare('DELETE FROM book_search WHERE book = ? AND path = ?');
    const insertSearch = this.db.prepare(
      'INSERT INTO book_search (title, content, book, path) VALUES (?, ?, ?, ?)',
    );

    let changed = false;
    const seen = new Set<string>();
    const pending: Array<() => void> = [];
    for (const stat of onDisk) {
      seen.add(stat.path);
      const row = rows.get(stat.path);
      if (row && row.size === stat.size && row.mtime_ms === stat.mtimeMs) continue;
      const bytes = this.files.readBytes(book, stat.path);
      if (bytes === null) continue;
      const hash = sha256(bytes);
      if (row && row.hash === hash) {
        // Touched but unchanged: refresh the stat only.
        pending.push(() =>
          upsert.run({ ...row, size: stat.size, mtime_ms: stat.mtimeMs } satisfies BookFileRow),
        );
        continue;
      }
      const content = bytes.toString('utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      const { kind, entityId } = classifyBookPath(stat.path);
      const title = titleFor(frontmatter, entityId, stat.path);
      changed = true;
      pending.push(() => {
        upsert.run({
          book,
          path: stat.path,
          kind,
          entity_id: entityId,
          title,
          hash,
          size: stat.size,
          mtime_ms: stat.mtimeMs,
          frontmatter_json: frontmatter === null ? null : JSON.stringify(frontmatter),
        } satisfies BookFileRow);
        deleteSearch.run(book, stat.path);
        // Registries are generated tables of other files; searching them only duplicates hits.
        if (kind !== 'registry') insertSearch.run(title, body, book, stat.path);
      });
    }
    for (const path of rows.keys()) {
      if (seen.has(path)) continue;
      changed = true;
      pending.push(() => {
        deleteRow.run(book, path);
        deleteSearch.run(book, path);
      });
    }
    if (pending.length > 0) {
      this.db.transaction(() => {
        for (const apply of pending) apply();
      })();
    }
    if (changed) this.revisions.set(book, this.revision(book) + 1);
    return changed;
  }

  list(book: string): BookFile[] {
    return (
      this.db
        .prepare('SELECT * FROM book_files WHERE book = ? ORDER BY path')
        .all(book) as BookFileRow[]
    ).map(toBookFile);
  }

  get(book: string, path: string): BookFile | null {
    const row = this.db
      .prepare('SELECT * FROM book_files WHERE book = ? AND path = ?')
      .get(book, path) as BookFileRow | undefined;
    return row ? toBookFile(row) : null;
  }

  frontmatter(book: string, path: string): Record<string, unknown> | null {
    const value = this.db
      .prepare('SELECT frontmatter_json FROM book_files WHERE book = ? AND path = ?')
      .pluck()
      .get(book, path) as string | null | undefined;
    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  }

  counts(book: string): Record<string, number> {
    const rows = this.db
      .prepare(
        'SELECT kind, COUNT(*) AS count FROM book_files WHERE book = ? AND entity_id IS NOT NULL GROUP BY kind',
      )
      .all(book) as Array<{ kind: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.kind, row.count]));
  }

  latestMtime(book: string): number | null {
    return this.db
      .prepare('SELECT MAX(mtime_ms) FROM book_files WHERE book = ?')
      .pluck()
      .get(book) as number | null;
  }

  search(book: string, query: string, limit = 50): BookSearchResult[] {
    const match = toFtsMatchQuery(query);
    if (match === '') return [];
    const rows = this.db
      .prepare(
        `SELECT book_files.path, book_files.kind, book_files.title,
                snippet(book_search, 1, '', '', '…', 12) AS excerpt
         FROM book_search
         JOIN book_files ON book_files.book = book_search.book AND book_files.path = book_search.path
         WHERE book_search.book = ? AND book_search MATCH ?
         ORDER BY bm25(book_search, 5.0, 1.0), book_files.path
         LIMIT ?`,
      )
      .all(book, match, limit) as Array<{
      path: string;
      kind: string;
      title: string;
      excerpt: string;
    }>;
    return rows.map((row) => ({
      path: row.path,
      kind: row.kind as BookFileKind,
      title: row.title,
      excerpt: row.excerpt.slice(0, EXCERPT_MAX),
    }));
  }

  removeBook(book: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM book_files WHERE book = ?').run(book);
      this.db.prepare('DELETE FROM book_search WHERE book = ?').run(book);
    })();
    this.revisions.delete(book);
  }
}
