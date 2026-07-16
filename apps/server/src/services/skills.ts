import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  type CreateSkillInput,
  type PatchSkill,
  type SkillDetail,
  type SkillMetadata,
  createSkillSchema,
  patchSkillSchema,
  skillDetailSchema,
  skillMetadataSchema,
  skillOriginSchema,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { SkillRow } from '../db/types.js';
import { ConflictError, InvalidStoredDataError, NotFoundError } from '../errors.js';
import { type ReadSkillFile, SkillFileStore } from '../files/skill-files.js';

function mapSkill(row: SkillRow): SkillMetadata {
  try {
    const origin = skillOriginSchema.parse(JSON.parse(row.origin_json));
    return skillMetadataSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      dirPath: row.dir_path,
      origin,
      license: row.license,
      wordCount: row.word_count,
      contentHash: row.content_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    throw new InvalidStoredDataError(`Skill ${row.id} has invalid stored metadata`, {
      cause: error,
    });
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
  );
}

export class SkillService {
  constructor(
    private readonly db: Database.Database,
    private readonly skillFiles: SkillFileStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private getRow(id: string): SkillRow {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      SkillRow | undefined;
    if (!row) throw new NotFoundError(`Skill ${id} was not found`);
    return row;
  }

  list(): SkillMetadata[] {
    const rows = this.db
      .prepare('SELECT * FROM skills ORDER BY name COLLATE NOCASE, id')
      .all() as SkillRow[];
    return rows.map(mapSkill);
  }

  create(input: CreateSkillInput): SkillMetadata {
    const normalized = createSkillSchema.parse(input);
    // The skill's directory is its name, so a duplicate create would overwrite
    // the existing skill's SKILL.md before the unique index could refuse the
    // row. Check first; better-sqlite3 is synchronous, so there is no race.
    // The disk check also protects files that exist without an index row —
    // e.g. a folder the user copied in that has not been reconciled yet.
    const taken = this.db
      .prepare('SELECT 1 FROM skills WHERE name = ? COLLATE NOCASE')
      .get(normalized.name);
    if (taken || this.skillFiles.has(`skills/${normalized.name}`)) {
      throw new ConflictError(
        'skill_name_conflict',
        `A skill named ${normalized.name} already exists`,
      );
    }
    const id = randomUUID();
    const timestamp = this.now();
    let stored: ReturnType<SkillFileStore['write']> | undefined;

    try {
      return this.db.transaction(() => {
        stored = this.skillFiles.write({
          id,
          name: normalized.name,
          description: normalized.description,
          content: normalized.content,
          origin: normalized.origin,
          license: normalized.license,
          createdAt: timestamp,
        });
        this.db
          .prepare(
            'INSERT INTO skills (id, name, description, dir_path, origin_json, license, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            normalized.name,
            normalized.description,
            stored.dirPath,
            JSON.stringify(normalized.origin),
            normalized.license,
            stored.wordCount,
            stored.contentHash,
            stored.createdAt,
            stored.updatedAt,
          );
        return mapSkill(this.getRow(id));
      })();
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError(
          'skill_name_conflict',
          `A skill named ${normalized.name} already exists`,
        );
      }
      if (stored !== undefined) this.skillFiles.remove(stored.dirPath);
      throw error;
    }
  }

  get(id: string): SkillDetail {
    const row = this.getRow(id);
    const file = this.skillFiles.read(row.dir_path);
    this.assertFileIdentity(row, file);

    if (
      file.description !== row.description ||
      file.license !== row.license ||
      file.wordCount !== row.word_count ||
      file.contentHash !== row.content_hash ||
      file.updatedAt !== row.updated_at
    ) {
      this.db
        .prepare(
          'UPDATE skills SET description = ?, license = ?, word_count = ?, content_hash = ?, updated_at = ? WHERE id = ?',
        )
        .run(file.description, file.license, file.wordCount, file.contentHash, file.updatedAt, id);
    }

    try {
      return skillDetailSchema.parse({
        ...mapSkill(this.getRow(id)),
        content: file.content,
      });
    } catch (error) {
      if (error instanceof InvalidStoredDataError) throw error;
      throw new InvalidStoredDataError(`Skill ${id} has invalid stored content`, {
        cause: error,
      });
    }
  }

  /**
   * Edits a skill's name, description, and/or content. Identity (`id`,
   * `createdAt`, `origin`, `license`) is preserved; SKILL.md is the source of
   * truth, so the file is rewritten first and the index row updated to match.
   * A name change moves the whole skill directory (carrying any extra files),
   * then rewrites SKILL.md inside it. Failures roll the file/directory back so
   * disk and index stay consistent.
   */
  patch(id: string, input: PatchSkill): SkillDetail {
    const normalized = patchSkillSchema.parse(input);
    const current = this.get(id);
    const name = normalized.name ?? current.name;
    const description = normalized.description ?? current.description;
    const content = normalized.content ?? current.content;
    const timestamp = this.now();
    const nameChanged = name !== current.name;

    if (nameChanged) {
      const taken = this.db
        .prepare('SELECT 1 FROM skills WHERE name = ? COLLATE NOCASE AND id != ?')
        .get(name, id);
      if (taken || this.skillFiles.has(`skills/${name}`)) {
        throw new ConflictError('skill_name_conflict', `A skill named ${name} already exists`);
      }
      this.skillFiles.move(current.dirPath, `skills/${name}`);
    }
    const restoreFile = (): void => {
      if (nameChanged) this.skillFiles.move(`skills/${name}`, current.dirPath);
      this.skillFiles.write({
        id: current.id,
        name: current.name,
        description: current.description,
        content: current.content,
        origin: current.origin,
        license: current.license,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      });
    };

    let stored: ReturnType<SkillFileStore['write']>;
    try {
      stored = this.skillFiles.write({
        id: current.id,
        name,
        description,
        content,
        origin: current.origin,
        license: current.license,
        createdAt: current.createdAt,
        updatedAt: timestamp,
      });
    } catch (error) {
      restoreFile();
      throw error;
    }

    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'UPDATE skills SET name = ?, description = ?, dir_path = ?, word_count = ?, content_hash = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            name,
            description,
            stored.dirPath,
            stored.wordCount,
            stored.contentHash,
            stored.updatedAt,
            id,
          );
      })();
    } catch (error) {
      restoreFile();
      if (isUniqueConstraint(error)) {
        throw new ConflictError('skill_name_conflict', `A skill named ${name} already exists`);
      }
      throw error;
    }

    return this.get(id);
  }

  private assertFileIdentity(row: SkillRow, file: ReadSkillFile): void {
    let rowOrigin: unknown;
    try {
      rowOrigin = JSON.parse(row.origin_json);
    } catch (error) {
      throw new InvalidStoredDataError(`Skill ${row.id} has invalid stored metadata`, {
        cause: error,
      });
    }
    if (
      file.id !== row.id ||
      file.name !== row.name ||
      !isDeepStrictEqual(file.origin, rowOrigin) ||
      file.createdAt !== row.created_at
    ) {
      throw new InvalidStoredDataError(
        `Skill file ${row.dir_path}/SKILL.md does not match its index row`,
      );
    }
  }

  delete(id: string): void {
    const row = this.getRow(id);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
      this.skillFiles.remove(row.dir_path);
    })();
  }
}
