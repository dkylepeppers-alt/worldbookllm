import type Database from 'better-sqlite3';

/**
 * Adds swipeable response variants to assistant messages. Each turn's assistant
 * message keeps a JSON array of every regenerated response plus a pointer to the
 * active one; the existing content/reasoning/status/context columns continue to
 * mirror the active variant so the prompt assembler and all readers are unchanged.
 *
 * `variants_json` is nullable: a null value means "one implicit variant" derived
 * from the mirror columns, so pre-existing messages need no backfill.
 */
export function migrateToVersion4(db: Database.Database): void {
  db.exec(`
    ALTER TABLE messages ADD COLUMN variants_json TEXT;
    ALTER TABLE messages ADD COLUMN active_variant INTEGER NOT NULL DEFAULT 0;
  `);
}
