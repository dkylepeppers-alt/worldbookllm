import type Database from 'better-sqlite3';

import type { SourceRow } from '../db/types.js';

/**
 * Converts arbitrary user input into a safe FTS5 MATCH expression: every
 * whitespace-separated token becomes a quoted prefix phrase (`"token"*`),
 * with embedded double quotes doubled. Quoting disarms all FTS5 query
 * syntax (`NEAR`, `-`, parentheses, unbalanced quotes), and the trailing
 * `*` gives find-as-you-type behavior. Tokens are joined with implicit AND.
 * NUL characters split tokens like whitespace — FTS5 rejects them even
 * inside a quoted string. Returns '' when the input contains no tokens;
 * callers treat that as no results rather than passing it to MATCH.
 */
export function toFtsMatchQuery(input: string): string {
  return input
    .split(/[\s\0]+/u)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' ');
}

/** Matches sourceSearchResultSchema's excerpt cap in @worldbookllm/shared. */
const EXCERPT_MAX = 1000;

export interface SourceSearchEntry {
  sourceId: string;
  notebookId: string;
  title: string;
  content: string;
}

/**
 * The standalone FTS5 index over source titles and content (ADR 0012).
 * Source content lives in Markdown files, not SQLite, so this table stores
 * its own searchable copy and services keep it in sync explicitly inside
 * their write transactions; like the rest of the database it is a
 * rebuildable index over the files on disk.
 */
export class SourceSearchIndex {
  constructor(private readonly db: Database.Database) {}

  /** Inserts or replaces the index entry for one source. */
  index(entry: SourceSearchEntry): void {
    this.db.prepare('DELETE FROM source_search WHERE source_id = ?').run(entry.sourceId);
    this.db
      .prepare(
        'INSERT INTO source_search (title, content, source_id, notebook_id) VALUES (?, ?, ?, ?)',
      )
      .run(entry.title, entry.content, entry.sourceId, entry.notebookId);
  }

  remove(sourceId: string): void {
    this.db.prepare('DELETE FROM source_search WHERE source_id = ?').run(sourceId);
  }

  removeNotebook(notebookId: string): void {
    this.db.prepare('DELETE FROM source_search WHERE notebook_id = ?').run(notebookId);
  }

  /** Source ids currently present in the index. */
  indexedSourceIds(): string[] {
    return this.db.prepare('SELECT source_id FROM source_search').pluck().all() as string[];
  }

  has(sourceId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM source_search WHERE source_id = ?').get(sourceId) !== undefined
    );
  }

  /**
   * Ranked full-text hits for one notebook: the matching source rows plus a
   * plain-text excerpt around the first content match. Titles weigh five
   * times as much as content in the bm25 ranking.
   */
  search(notebookId: string, query: string): Array<{ row: SourceRow; excerpt: string }> {
    const match = toFtsMatchQuery(query);
    if (match === '') return [];
    const rows = this.db
      .prepare(
        `SELECT sources.*, snippet(source_search, 1, '', '', '…', 12) AS excerpt
         FROM source_search
         JOIN sources ON sources.id = source_search.source_id
         WHERE source_search.notebook_id = ? AND source_search MATCH ?
         ORDER BY bm25(source_search, 5.0, 1.0), sources.id`,
      )
      .all(notebookId, match) as Array<SourceRow & { excerpt: string }>;
    // snippet() limits tokens, not characters — one giant unbroken token
    // (a long URL, say) could exceed the response schema's excerpt cap.
    return rows.map(({ excerpt, ...row }) => ({ row, excerpt: excerpt.slice(0, EXCERPT_MAX) }));
  }
}
