import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { Checkpoint, CheckpointDetail } from '@worldbookllm/shared';

import { ConflictError, NotFoundError } from '../errors.js';
import type { BookFileStore } from './book-files.js';
import { sha256 } from './book-files.js';

export type CheckpointActor = 'user' | 'agent';

/** Which files a change may touch: named paths, or every Markdown file in the book. */
export type CheckpointScope = { paths: readonly string[] } | 'book';

interface CheckpointRow {
  id: string;
  book: string;
  label: string;
  actor: CheckpointActor;
  created_at: string;
  undone_at: string | null;
}

interface CheckpointFileRow {
  checkpoint_id: string;
  path: string;
  before_content: Buffer | null;
  after_content: Buffer | null;
  before_hash: string | null;
  after_hash: string | null;
}

function changeOf(file: Pick<CheckpointFileRow, 'before_hash' | 'after_hash'>) {
  if (file.before_hash === null) return 'created' as const;
  if (file.after_hash === null) return 'deleted' as const;
  return 'modified' as const;
}

/**
 * Records every change to a book as a checkpoint holding the before and
 * after bytes of each file it touched (ADR 0015 decision 5). Changes made by
 * the story CLI are captured the same way as direct edits: the scope is
 * snapshotted before the change runs and compared after it, so whatever the
 * CLI rewrote (registries, references, renamed files) is covered.
 *
 * Undo is strictly last-in-first-out per book, and refuses when any file has
 * changed since the checkpoint was recorded, so an undo never silently
 * discards a later edit.
 */
export class CheckpointService {
  constructor(
    private readonly db: Database.Database,
    private readonly files: BookFileStore,
  ) {}

  private capture(book: string, scope: CheckpointScope): Map<string, Buffer> {
    if (scope === 'book') return this.files.snapshot(book);
    const captured = new Map<string, Buffer>();
    for (const path of scope.paths) {
      const bytes = this.files.readBytes(book, path);
      if (bytes !== null) captured.set(path, bytes);
    }
    return captured;
  }

  /**
   * Runs `change` and records what it did to the files in `scope`. Changes
   * are recorded even when `change` throws, so a command that failed halfway
   * can still be undone; the error is rethrown afterwards. Returns null for
   * the checkpoint when nothing changed.
   */
  async record<T>(
    book: string,
    label: string,
    actor: CheckpointActor,
    scope: CheckpointScope,
    change: () => Promise<T> | T,
  ): Promise<{ result: T; checkpoint: Checkpoint | null }> {
    const before = this.capture(book, scope);
    let result: T | undefined;
    let failure: unknown;
    let failed = false;
    try {
      result = await change();
    } catch (error) {
      failed = true;
      failure = error;
    }
    const after = this.capture(book, scope);
    const checkpoint = this.store(book, failed ? `${label} (failed)` : label, actor, before, after);
    if (failed) throw failure;
    return { result: result as T, checkpoint };
  }

  private store(
    book: string,
    label: string,
    actor: CheckpointActor,
    before: Map<string, Buffer>,
    after: Map<string, Buffer>,
  ): Checkpoint | null {
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    const changed = paths.filter((path) => {
      const previous = before.get(path);
      const next = after.get(path);
      if (!previous || !next) return previous !== next;
      return !previous.equals(next);
    });
    if (changed.length === 0) return null;

    const row: CheckpointRow = {
      id: randomUUID(),
      book,
      label,
      actor,
      created_at: new Date().toISOString(),
      undone_at: null,
    };
    const insertFile = this.db.prepare(
      `INSERT INTO book_checkpoint_files
         (checkpoint_id, path, before_content, after_content, before_hash, after_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO book_checkpoints (id, book, label, actor, created_at, undone_at) VALUES (@id, @book, @label, @actor, @created_at, @undone_at)',
        )
        .run(row);
      for (const path of changed) {
        const previous = before.get(path) ?? null;
        const next = after.get(path) ?? null;
        insertFile.run(
          row.id,
          path,
          previous,
          next,
          previous && sha256(previous),
          next && sha256(next),
        );
      }
    })();
    return this.get(book, row.id);
  }

  list(book: string, limit = 50): Checkpoint[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM book_checkpoints WHERE book = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      )
      .all(book, limit) as CheckpointRow[];
    return rows.map((row) => this.summarize(row));
  }

  get(book: string, id: string): Checkpoint {
    return this.summarize(this.row(book, id));
  }

  detail(book: string, id: string): CheckpointDetail {
    const row = this.row(book, id);
    return {
      ...this.summarize(row),
      files: this.fileRows(id).map((file) => ({
        path: file.path,
        change: changeOf(file),
        before: file.before_content?.toString('utf8') ?? null,
        after: file.after_content?.toString('utf8') ?? null,
      })),
    };
  }

  /** Restores the files of the book's most recent live checkpoint. */
  undo(book: string, id: string): Checkpoint {
    const row = this.row(book, id);
    if (row.undone_at !== null) {
      throw new ConflictError('checkpoint_already_undone', 'This change was already undone.');
    }
    const latest = this.db
      .prepare(
        'SELECT id FROM book_checkpoints WHERE book = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .pluck()
      .get(book) as string | undefined;
    if (latest !== id) {
      throw new ConflictError(
        'checkpoint_not_latest',
        'Undo the more recent changes to this book first.',
      );
    }

    const files = this.fileRows(id);
    const drifted = files.filter((file) => {
      const current = this.files.readBytes(book, file.path);
      return (current === null ? null : sha256(current)) !== file.after_hash;
    });
    if (drifted.length > 0) {
      throw new ConflictError(
        'checkpoint_conflict',
        `These files changed after this change was made: ${drifted.map((file) => file.path).join(', ')}`,
      );
    }

    for (const file of files) {
      if (file.before_content === null) this.files.remove(book, file.path);
      else this.files.write(book, file.path, file.before_content);
    }
    this.db
      .prepare('UPDATE book_checkpoints SET undone_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return this.get(book, id);
  }

  removeBook(book: string): void {
    this.db.prepare('DELETE FROM book_checkpoints WHERE book = ?').run(book);
  }

  private row(book: string, id: string): CheckpointRow {
    const row = this.db
      .prepare('SELECT * FROM book_checkpoints WHERE book = ? AND id = ?')
      .get(book, id) as CheckpointRow | undefined;
    if (!row) throw new NotFoundError(`Checkpoint ${id} was not found`);
    return row;
  }

  private fileRows(id: string): CheckpointFileRow[] {
    return this.db
      .prepare('SELECT * FROM book_checkpoint_files WHERE checkpoint_id = ? ORDER BY path')
      .all(id) as CheckpointFileRow[];
  }

  private summarize(row: CheckpointRow): Checkpoint {
    return {
      id: row.id,
      book: row.book,
      label: row.label,
      actor: row.actor,
      createdAt: row.created_at,
      undoneAt: row.undone_at,
      files: (
        this.db
          .prepare(
            'SELECT path, before_hash, after_hash FROM book_checkpoint_files WHERE checkpoint_id = ? ORDER BY path',
          )
          .all(row.id) as Array<Pick<CheckpointFileRow, 'path' | 'before_hash' | 'after_hash'>>
      ).map((file) => ({ path: file.path, change: changeOf(file) })),
    };
  }
}
