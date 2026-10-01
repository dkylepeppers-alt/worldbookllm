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
  pending: number;
  /** 1 when the change also moved folders, which undo cannot reverse. */
  structural: number;
}

/** A structural checkpoint moved a book's folder, so undo refuses it. */
export interface CheckpointOptions {
  structural?: boolean;
}

interface CheckpointFileRow {
  checkpoint_id: string;
  path: string;
  before_content: Buffer | null;
  after_content: Buffer | null;
  before_hash: string | null;
  after_hash: string | null;
}

function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
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
  ) {
    // A process exit can strand a completed file write before the agent turn
    // finalizes. Keep that history usable instead of hiding it forever.
    this.db.prepare('UPDATE book_checkpoints SET pending = 0 WHERE pending = 1').run();
  }

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
    options: CheckpointOptions = {},
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
    const checkpoint = this.store(
      book,
      failed ? `${label} (failed)` : label,
      actor,
      before,
      after,
      options,
    );
    if (failed) throw failure;
    return { result: result as T, checkpoint };
  }

  /** Stores a before/after pair as one checkpoint; files absent from a map did not exist. */
  store(
    book: string,
    label: string,
    actor: CheckpointActor,
    before: Map<string, Buffer>,
    after: Map<string, Buffer>,
    options: CheckpointOptions = {},
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
      pending: 0,
      structural: options.structural === true ? 1 : 0,
    };
    const insertFile = this.db.prepare(
      `INSERT INTO book_checkpoint_files
         (checkpoint_id, path, before_content, after_content, before_hash, after_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO book_checkpoints (id, book, label, actor, created_at, undone_at, pending, structural) VALUES (@id, @book, @label, @actor, @created_at, @undone_at, @pending, @structural)',
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

  /** Starts a checkpoint that gathers several separately locked changes into one entry. */
  storeGroup(
    label: string,
    actor: CheckpointActor,
    snapshots: Array<{ book: string; before: Map<string, Buffer>; after: Map<string, Buffer> }>,
    options: CheckpointOptions = {},
  ): Checkpoint[] {
    return this.db.transaction(() =>
      snapshots.flatMap(({ book, before, after }) => {
        const checkpoint = this.store(book, label, actor, before, after, options);
        return checkpoint === null ? [] : [checkpoint];
      }),
    )();
  }

  /** Starts a checkpoint that gathers several separately locked changes into one entry. */
  session(book: string, label: string, actor: CheckpointActor): CheckpointSession {
    return new CheckpointSession(this, book, label, actor);
  }

  /** Current bytes of the files in `scope`, for a session's before/after images. */
  snapshotScope(book: string, scope: CheckpointScope): Map<string, Buffer> {
    return this.capture(book, scope);
  }

  /** Refuses a session write after another checkpoint has taken its place. */
  assertSessionCurrent(book: string, checkpointId: string | null): void {
    if (checkpointId === null) {
      const pending = this.db
        .prepare('SELECT id FROM book_checkpoints WHERE book = ? AND pending = 1 LIMIT 1')
        .pluck()
        .get(book) as string | undefined;
      if (pending) {
        throw new ConflictError(
          'checkpoint_in_progress',
          'Another agent change is already in progress for this book.',
        );
      }
      return;
    }

    const latest = this.db
      .prepare(
        'SELECT id FROM book_checkpoints WHERE book = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .pluck()
      .get(book) as string | undefined;
    if (latest !== checkpointId) {
      throw new ConflictError(
        'checkpoint_interleaved',
        'This book changed after the agent started writing. Start a new turn before writing again.',
      );
    }
  }

  /** Creates or refreshes the hidden checkpoint that reserves a session's history position. */
  savePending(
    checkpointId: string | null,
    book: string,
    label: string,
    actor: CheckpointActor,
    before: Map<string, Buffer | null>,
    after: Map<string, Buffer | null>,
  ): string | null {
    const paths = [...new Set([...before.keys(), ...after.keys()])]
      .filter((path) => !sameBytes(before.get(path) ?? null, after.get(path) ?? null))
      .sort();
    if (paths.length === 0) {
      if (checkpointId !== null) {
        this.db
          .prepare('DELETE FROM book_checkpoints WHERE id = ? AND book = ? AND pending = 1')
          .run(checkpointId, book);
      }
      return null;
    }

    const id = checkpointId ?? randomUUID();
    const insertFile = this.db.prepare(
      `INSERT INTO book_checkpoint_files
         (checkpoint_id, path, before_content, after_content, before_hash, after_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      if (checkpointId === null) {
        this.db
          .prepare(
            `INSERT INTO book_checkpoints
               (id, book, label, actor, created_at, undone_at, pending)
             VALUES (?, ?, ?, ?, ?, NULL, 1)`,
          )
          .run(id, book, label, actor, new Date().toISOString());
      } else {
        const pending = this.db
          .prepare('SELECT 1 FROM book_checkpoints WHERE id = ? AND book = ? AND pending = 1')
          .get(id, book);
        if (!pending) {
          throw new ConflictError(
            'checkpoint_interleaved',
            'The agent checkpoint is no longer available.',
          );
        }
        this.db.prepare('DELETE FROM book_checkpoint_files WHERE checkpoint_id = ?').run(id);
      }
      for (const path of paths) {
        const previous = before.get(path) ?? null;
        const next = after.get(path) ?? null;
        insertFile.run(
          id,
          path,
          previous,
          next,
          previous && sha256(previous),
          next && sha256(next),
        );
      }
    })();
    return id;
  }

  /** Makes a session checkpoint visible without changing its original order. */
  finishPending(book: string, checkpointId: string | null): Checkpoint | null {
    if (checkpointId === null) return null;
    const result = this.db
      .prepare('UPDATE book_checkpoints SET pending = 0 WHERE id = ? AND book = ? AND pending = 1')
      .run(checkpointId, book);
    if (result.changes !== 1) {
      throw new ConflictError(
        'checkpoint_interleaved',
        'The agent checkpoint is no longer available.',
      );
    }
    return this.get(book, checkpointId);
  }

  list(book: string, limit = 50): Checkpoint[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM book_checkpoints WHERE book = ? AND pending = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?',
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
    if (row.structural === 1) {
      throw new ConflictError(
        'checkpoint_structural',
        'This change moved a book into or out of a series, which undo cannot reverse. Move the book back from its Project tab instead.',
      );
    }
    const pending = this.db
      .prepare('SELECT 1 FROM book_checkpoints WHERE book = ? AND pending = 1 LIMIT 1')
      .get(book);
    if (pending) {
      throw new ConflictError(
        'checkpoint_in_progress',
        'Wait for the active agent change to finish before undoing this book.',
      );
    }
    const latest = this.db
      .prepare(
        'SELECT id FROM book_checkpoints WHERE book = ? AND undone_at IS NULL AND pending = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1',
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

/**
 * One checkpoint assembled from several changes, each captured separately
 * (typically each under the book lock): an agent turn that writes files
 * and runs story commands becomes a single undoable entry, without holding
 * the book lock for the whole turn. The first write creates a hidden pending
 * checkpoint immediately, preserving its position before any later user
 * checkpoint. If another checkpoint interleaves, subsequent agent writes are
 * refused so neither writer's history can be folded into the other's.
 */
export class CheckpointSession {
  private readonly before = new Map<string, Buffer | null>();
  private readonly after = new Map<string, Buffer | null>();
  private checkpointId: string | null = null;
  private closed = false;

  constructor(
    private readonly checkpoints: CheckpointService,
    readonly book: string,
    readonly label: string,
    readonly actor: CheckpointActor,
  ) {}

  async capture<T>(scope: CheckpointScope, change: () => Promise<T> | T): Promise<T> {
    if (this.closed) {
      throw new ConflictError('checkpoint_closed', 'This checkpoint session has already finished.');
    }
    this.checkpoints.assertSessionCurrent(this.book, this.checkpointId);
    if (this.after.size > 0) {
      const current = this.checkpoints.snapshotScope(this.book, {
        paths: [...this.after.keys()],
      });
      const drifted = [...this.after].some(
        ([path, expected]) => !sameBytes(current.get(path) ?? null, expected),
      );
      if (drifted) {
        throw new ConflictError(
          'checkpoint_interleaved',
          'This book changed after the agent started writing. Start a new turn before writing again.',
        );
      }
    }
    const before = this.checkpoints.snapshotScope(this.book, scope);
    try {
      return await change();
    } finally {
      const after = this.checkpoints.snapshotScope(this.book, scope);
      for (const path of new Set([...before.keys(), ...after.keys()])) {
        const previous = before.get(path) ?? null;
        const next = after.get(path) ?? null;
        if (sameBytes(previous, next)) continue;
        if (!this.before.has(path)) this.before.set(path, previous);
        this.after.set(path, next);
      }
      this.checkpointId = this.checkpoints.savePending(
        this.checkpointId,
        this.book,
        this.label,
        this.actor,
        this.before,
        this.after,
      );
    }
  }

  /** The hidden checkpoint holding the changes so far, or null before the first change. */
  get pendingId(): string | null {
    return this.checkpointId;
  }

  get changedPaths(): string[] {
    return [...this.after.keys()]
      .filter((path) => !sameBytes(this.before.get(path) ?? null, this.after.get(path) ?? null))
      .sort();
  }

  /** Finalizes the gathered checkpoint; null when nothing changed overall. */
  commit(): Checkpoint | null {
    if (this.closed) {
      throw new ConflictError('checkpoint_closed', 'This checkpoint session has already finished.');
    }
    this.closed = true;
    return this.checkpoints.finishPending(this.book, this.checkpointId);
  }
}
