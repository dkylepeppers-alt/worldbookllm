import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  AgentChangeset,
  AgentChangesetDetail,
  AgentChangesetResolution,
} from '@worldbookllm/shared';

import { NotFoundError, ValidationError } from '../errors.js';
import type { BookService } from '../services/books.js';
import { KeyedMutex } from '../story/keyed-mutex.js';
import type { StagedChange } from '../story/staging.js';

interface ChangesetRow {
  id: string;
  chat_id: string;
  message_id: string;
  book: string;
  created_at: string;
  reported: 0 | 1;
}

interface ChangesetFileRow {
  changeset_id: string;
  path: string;
  before_content: Buffer | null;
  after_content: Buffer | null;
  status: 'pending' | 'applied' | 'skipped';
}

function changeOf(file: Pick<ChangesetFileRow, 'before_content' | 'after_content'>) {
  if (file.before_content === null) return 'created' as const;
  if (file.after_content === null) return 'deleted' as const;
  return 'modified' as const;
}

function listPaths(paths: readonly string[]): string {
  return paths.join(', ');
}

/**
 * Review mode's proposed changes (ADR 0016): the files a staged agent turn
 * changed, held until the writer applies or skips each one. Applying writes
 * the files into the book as one checkpoint, so it can be undone like any
 * other change. How the writer resolved a changeset is told to the model at
 * the start of the chat's next turn.
 */
export class AgentChangesetService {
  /** One decision per changeset at a time, so an apply and a skip cannot both win. */
  private readonly decisions = new KeyedMutex();

  constructor(
    private readonly db: Database.Database,
    private readonly books: BookService,
  ) {}

  /** Stores a turn's proposed changes; null when the turn changed nothing. */
  create(
    chatId: string,
    messageId: string,
    book: string,
    changes: readonly StagedChange[],
  ): AgentChangeset | null {
    if (changes.length === 0) return null;
    const id = randomUUID();
    const insertFile = this.db.prepare(
      `INSERT INTO agent_changeset_files (changeset_id, path, before_content, after_content, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    );
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO agent_changesets (id, chat_id, message_id, book, created_at, reported) VALUES (?, ?, ?, ?, ?, 0)',
        )
        .run(id, chatId, messageId, book, new Date().toISOString());
      for (const change of changes) insertFile.run(id, change.path, change.before, change.after);
    })();
    return this.get(id);
  }

  get(id: string): AgentChangeset {
    const row = this.row(id);
    return {
      id: row.id,
      chatId: row.chat_id,
      messageId: row.message_id,
      book: row.book,
      createdAt: row.created_at,
      files: this.files(id).map((file) => ({
        path: file.path,
        change: changeOf(file),
        status: file.status,
      })),
    };
  }

  detail(id: string): AgentChangesetDetail {
    const summary = this.get(id);
    const files = this.files(id);
    return {
      ...summary,
      files: files.map((file) => ({
        path: file.path,
        change: changeOf(file),
        status: file.status,
        before: file.before_content?.toString('utf8') ?? null,
        after: file.after_content?.toString('utf8') ?? null,
      })),
    };
  }

  listForChat(chatId: string): AgentChangeset[] {
    const ids = this.db
      .prepare('SELECT id FROM agent_changesets WHERE chat_id = ? ORDER BY created_at, id')
      .pluck()
      .all(chatId) as string[];
    return ids.map((id) => this.get(id));
  }

  /** Applies the named pending files (all pending files when none are named) as one checkpoint. */
  apply(id: string, paths?: readonly string[]): Promise<AgentChangesetResolution> {
    return this.decisions.run(id, () => this.applyNow(id, paths));
  }

  private async applyNow(id: string, paths?: readonly string[]): Promise<AgentChangesetResolution> {
    const row = this.row(id);
    const files = this.pendingFiles(id, paths);
    const label =
      files.length === 1
        ? `Agent change applied: ${files[0]?.path ?? ''}`
        : `Agent changes applied: ${files.length} files`;
    const checkpoint = await this.books.applyStaged(
      row.book,
      label,
      files.map((file) => ({
        path: file.path,
        before: file.before_content,
        after: file.after_content,
      })),
    );
    this.mark(id, files, 'applied');
    return { changeset: this.get(id), checkpoint };
  }

  /** Discards the named pending files (all pending files when none are named). */
  skip(id: string, paths?: readonly string[]): Promise<AgentChangesetResolution> {
    return this.decisions.run(id, () => {
      this.row(id);
      this.mark(id, this.pendingFiles(id, paths), 'skipped');
      return { changeset: this.get(id), checkpoint: null };
    });
  }

  /**
   * What the model should hear at the start of the next turn about its
   * earlier proposals. Fully resolved changesets are reported once; pending
   * ones are mentioned every turn until the writer decides.
   */
  outcomeNote(chatId: string): string | null {
    const rows = this.db
      .prepare(
        'SELECT * FROM agent_changesets WHERE chat_id = ? AND reported = 0 ORDER BY created_at, id',
      )
      .all(chatId) as ChangesetRow[];
    const lines: string[] = [];
    const reported: string[] = [];
    for (const row of rows) {
      const files = this.files(row.id);
      const byStatus = (status: ChangesetFileRow['status']) =>
        files.filter((file) => file.status === status).map((file) => file.path);
      const applied = byStatus('applied');
      const skipped = byStatus('skipped');
      const pending = byStatus('pending');
      if (applied.length > 0) lines.push(`Applied: ${listPaths(applied)}.`);
      if (skipped.length > 0) lines.push(`Skipped (not applied): ${listPaths(skipped)}.`);
      if (pending.length > 0) {
        lines.push(`Still awaiting the writer's review, not in the book: ${listPaths(pending)}.`);
      } else {
        reported.push(row.id);
      }
    }
    if (reported.length > 0) {
      const mark = this.db.prepare('UPDATE agent_changesets SET reported = 1 WHERE id = ?');
      this.db.transaction(() => {
        for (const id of reported) mark.run(id);
      })();
    }
    if (lines.length === 0) return null;
    return ["[The writer's review of your earlier proposed changes]", ...lines].join('\n');
  }

  private row(id: string): ChangesetRow {
    const row = this.db.prepare('SELECT * FROM agent_changesets WHERE id = ?').get(id) as
      ChangesetRow | undefined;
    if (!row) throw new NotFoundError(`Changeset ${id} was not found`);
    return row;
  }

  private files(id: string): ChangesetFileRow[] {
    return this.db
      .prepare('SELECT * FROM agent_changeset_files WHERE changeset_id = ? ORDER BY path')
      .all(id) as ChangesetFileRow[];
  }

  private pendingFiles(id: string, paths?: readonly string[]): ChangesetFileRow[] {
    const pending = this.files(id).filter((file) => file.status === 'pending');
    if (paths === undefined) {
      if (pending.length === 0)
        throw new ValidationError('No proposed changes are left to review.');
      return pending;
    }
    const byPath = new Map(pending.map((file) => [file.path, file]));
    const missing = paths.filter((path) => !byPath.has(path));
    if (missing.length > 0) {
      throw new ValidationError(`Not pending in this changeset: ${listPaths(missing)}`);
    }
    return [...new Set(paths)].map((path) => byPath.get(path) as ChangesetFileRow);
  }

  private mark(
    id: string,
    files: readonly ChangesetFileRow[],
    status: 'applied' | 'skipped',
  ): void {
    const update = this.db.prepare(
      "UPDATE agent_changeset_files SET status = ? WHERE changeset_id = ? AND path = ? AND status = 'pending'",
    );
    this.db.transaction(() => {
      for (const file of files) update.run(status, id, file.path);
    })();
  }
}
