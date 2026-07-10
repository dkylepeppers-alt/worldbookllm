# Phase 5 Server Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable notebook, Markdown source, and masked rotating-secret storage to the Fastify server, exposed through validated REST APIs.

**Architecture:** Storage primitives own SQLite, source files, and the secrets file; small services coordinate cross-store work; Fastify routes validate shared Zod schemas and map domain errors to HTTP. `buildApp({dataDir})` constructs and closes all dependencies so integration tests remain isolated.

**Tech Stack:** TypeScript 5.9, Fastify 5, Zod 4, better-sqlite3, gray-matter, Vitest 3, Node 20 filesystem/crypto APIs

## Global Constraints

- Source Markdown files are the source of truth; source content never enters SQLite.
- SQLite uses WAL, foreign keys, and ordered transactional `PRAGMA user_version` migrations.
- Source detail reads the file every time and reconciles externally edited metadata.
- Secret API/public state always masks raw values; only an internal execution method can return a raw active secret.
- NodeNext server imports use `.js` extensions.
- Strict TypeScript and `noUncheckedIndexedAccess` stay enabled.
- No FTS, upload ingestion, source editing, chat routes, or provider execution in this phase.
- Run test/typecheck/build processes sequentially and checkpoint each subsystem to remote `main`.

---

## File Map

```text
packages/shared/src/
  provider-config.ts       provider settings schema and type
  notebooks.ts             notebook request/response schemas
  sources.ts               source request/response schemas
  secrets.ts               masked secret request/response schemas
  data-schemas.test.ts     schema boundary tests
  index.ts                 public exports

apps/server/src/
  env.ts                   deterministic data-directory resolution
  errors.ts                typed domain/storage errors
  db/database.ts           database opening and migration runner
  db/types.ts              SQLite row interfaces
  db/migrations/001-init.ts schema v1
  db/database.test.ts      pragma, schema, and migration tests
  files/source-files.ts    safe atomic Markdown file operations
  files/source-files.test.ts file layout and external-edit tests
  secrets/secret-store.ts  atomic multi-key secret persistence
  secrets/secret-store.test.ts masking and rotation tests
  services/notebooks.ts    notebook SQL and cascade coordination
  services/sources.ts      source SQL/file coordination
  routes/helpers.ts        Zod parsing and domain-error response mapping
  routes/notebooks.ts      notebook endpoints
  routes/sources.ts        source endpoints
  routes/secrets.ts        secret endpoints
  app.ts                   dependency construction and route registration
  app.test.ts              health plus full API integration tests
```

### Task 1: Shared API Schemas

**Files:**

- Create: `packages/shared/src/provider-config.ts`
- Create: `packages/shared/src/notebooks.ts`
- Create: `packages/shared/src/sources.ts`
- Create: `packages/shared/src/secrets.ts`
- Create: `packages/shared/src/data-schemas.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces `providerConfigSchema`, `notebookSchema`, `createNotebookSchema`, `patchNotebookSchema`, `sourceMetadataSchema`, `sourceDetailSchema`, `createSourceSchema`, `secretStateSchema`, and `createSecretSchema` plus their inferred types.
- Provider settings use `{source, model, baseUrl?, extra?}`; notebook settings are `ProviderConfig | null`.

- [ ] **Step 1: Add Zod and write failing schema tests**

```ts
expect(createNotebookSchema.parse({ name: ' Atlas ' })).toEqual({ name: 'Atlas' });
expect(() => createNotebookSchema.parse({ name: '' })).toThrow();
expect(() => patchNotebookSchema.parse({})).toThrow();
expect(createSourceSchema.parse({ title: 'Lore', content: '# Lore' })).toEqual({
  title: 'Lore',
  content: '# Lore',
});
expect(createSecretSchema.parse({ key: 'api_key_openai', value: 'secret' }).label).toBe(
  'Unlabeled',
);
```

Run: `pnpm --filter @worldbookllm/shared test -- data-schemas.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 2: Implement strict shared schemas and barrel exports**

```ts
export const providerSourceSchema = z.enum([
  'openai',
  'claude',
  'openrouter',
  'ai21',
  'makersuite',
  'vertexai',
  'mistralai',
  'custom',
  'cohere',
  'perplexity',
  'groq',
  'chutes',
  'electronhub',
  'nanogpt',
  'deepseek',
  'aimlapi',
  'xai',
  'pollinations',
  'moonshot',
  'fireworks',
  'cometapi',
  'azure_openai',
  'zai',
  'siliconflow',
  'minimax',
  'workers_ai',
]);

export const providerConfigSchema = z.strictObject({
  source: providerSourceSchema,
  model: z.string().trim().min(1).max(256),
  baseUrl: z.url().max(2048).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
```

Use strict objects, trimmed names/titles/labels, UUID IDs, ISO datetime strings, a maximum pasted-source size of 10 MiB, and `.refine()` on patch notebooks so `{}` is invalid. Export all schemas and types from `index.ts`.

- [ ] **Step 3: Run shared verification**

Run sequentially:

```bash
pnpm --filter @worldbookllm/shared test -- data-schemas.test.ts
pnpm --filter @worldbookllm/shared typecheck
```

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 4: Commit and push**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add data-layer API schemas"
git push origin main
```

### Task 2: Environment, SQLite, and Schema v1

**Files:**

- Create: `apps/server/src/env.ts`
- Create: `apps/server/src/db/types.ts`
- Create: `apps/server/src/db/database.ts`
- Create: `apps/server/src/db/migrations/001-init.ts`
- Create: `apps/server/src/db/database.test.ts`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces `resolveDataDir(explicit?: string): string` and `openDatabase(dataDir: string): Database.Database`.
- Produces row interfaces `NotebookRow`, `SourceRow`, `ChatRow`, and `MessageRow` with snake-case database fields.

- [ ] **Step 1: Install pinned storage dependencies**

Run:

```bash
pnpm --filter @worldbookllm/server add better-sqlite3@11.10.0 gray-matter@4.0.3 @worldbookllm/shared@workspace:*
pnpm --filter @worldbookllm/server add -D @types/better-sqlite3@7.6.13
```

Expected: dependencies appear only in the server manifest and lockfile.

- [ ] **Step 2: Write failing database tests**

```ts
const db = openDatabase(tempDir);
expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
expect(db.pragma('user_version', { simple: true })).toBe(1);
expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual(
  expect.arrayContaining([{ name: 'notebooks' }, { name: 'sources' }]),
);
db.close();
expect(() => openDatabase(tempDir)).not.toThrow();
```

Also create a database with `user_version = 2` and assert `openDatabase()` throws without modifying it.

Run: `pnpm --filter @worldbookllm/server test -- src/db/database.test.ts`

Expected: FAIL because `openDatabase` does not exist.

- [ ] **Step 3: Implement environment resolution and migration runner**

```ts
export interface Migration {
  version: number;
  up(db: Database.Database): void;
}

for (const migration of MIGRATIONS) {
  if (migration.version <= currentVersion) continue;
  db.transaction(() => {
    migration.up(db);
    db.pragma(`user_version = ${migration.version}`);
  })();
}
```

Open `<dataDir>/worldbookllm.db`, create `dataDir`, apply WAL and foreign keys, reject future versions, and close the database before rethrowing startup failures.

- [ ] **Step 4: Implement migration 001 exactly**

```sql
CREATE TABLE notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL CHECK(origin IN ('paste')),
  word_count INTEGER NOT NULL CHECK(word_count >= 0),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add the approved `chats` and `messages` tables, role/status checks, unique `(chat_id, seq)`, and foreign-key indexes.

- [ ] **Step 5: Run database verification**

Run sequentially:

```bash
pnpm --filter @worldbookllm/server test -- src/db/database.test.ts
pnpm --filter @worldbookllm/server typecheck
```

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit and push**

```bash
git add apps/server/package.json apps/server/src/env.ts apps/server/src/db pnpm-lock.yaml
git commit -m "feat(server): add SQLite schema and migrations"
git push origin main
```

### Task 3: Atomic Markdown Source Storage

**Files:**

- Create: `apps/server/src/errors.ts`
- Create: `apps/server/src/files/source-files.ts`
- Create: `apps/server/src/files/source-files.test.ts`

**Interfaces:**

- Produces `SourceFileStore`, `SourceFileInput`, `StoredSourceFile`, and `ReadSourceFile`.
- `write(input)` returns relative path, slug, word count, hash, and timestamps; `read(path)` returns validated frontmatter plus fresh body metadata; `remove(path)` and `removeNotebook(id)` are missing-file tolerant.

- [ ] **Step 1: Write failing source-file tests**

```ts
const stored = store.write({
  id,
  notebookId,
  title: 'The Amber Court',
  content: '# Court\n\nAmber rules here.',
  origin: 'paste',
  createdAt: now,
});
expect(stored.filePath).toBe(`notebooks/${notebookId}/sources/${id}-the-amber-court.md`);
expect(readFileSync(join(dataDir, stored.filePath), 'utf8')).toContain(`id: ${id}`);
expect(store.read(stored.filePath).content).toContain('Amber rules here.');
```

Modify the file body outside the store and assert `read()` returns its new hash/count/content. Assert `read('../secrets.json')` throws `UnsafePathError` and no `.tmp` artifact remains after a successful write.

Run: `pnpm --filter @worldbookllm/server test -- src/files/source-files.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 2: Implement slug/hash/count helpers and safe path resolution**

```ts
const absolute = resolve(this.dataDir, relativePath);
const rootPrefix = `${this.dataDir}${sep}`;
if (!absolute.startsWith(rootPrefix)) throw new UnsafePathError(relativePath);

const contentHash = createHash('sha256').update(content).digest('hex');
const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/u).length;
```

Normalize stored path separators to `/`, validate frontmatter IDs/timestamps/origin, and use the title fallback `source` for an empty ASCII slug.

- [ ] **Step 3: Implement atomic file writes and removals**

Serialize frontmatter with `gray-matter.stringify()`. Write a unique same-directory temporary file with mode `0600`, fsync and close it, rename it to the final path, and clean the temporary file on failure. Removal accepts only resolved paths within `dataDir`.

- [ ] **Step 4: Run source-file verification**

Run sequentially:

```bash
pnpm --filter @worldbookllm/server test -- src/files/source-files.test.ts
pnpm --filter @worldbookllm/server typecheck
```

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit and push**

```bash
git add apps/server/src/errors.ts apps/server/src/files
git commit -m "feat(server): add Markdown source file store"
git push origin main
```

### Task 4: Atomic Masked Secret Storage

**Files:**

- Create: `apps/server/src/secrets/secret-store.ts`
- Create: `apps/server/src/secrets/secret-store.test.ts`

**Interfaces:**

- Produces `SecretStore.getState()`, `add(key,value,label)`, `activate(key,id)`, `delete(key,id)`, and server-internal `readActive(key,id?)`.
- Public `MaskedSecret` values contain exactly `{id, value, label, active}` and never raw values.

- [ ] **Step 1: Write failing secret-store tests**

```ts
const first = store.add('api_key_openrouter', 'sk-first-123456', 'First');
const second = store.add('api_key_openrouter', 'sk-second-987654', 'Second');
expect(store.readActive('api_key_openrouter')).toBe('sk-second-987654');
expect(store.getState().api_key_openrouter).toEqual([
  { id: first.id, value: '*******456', label: 'First', active: false },
  { id: second.id, value: '*******654', label: 'Second', active: true },
]);
expect(JSON.stringify(store.getState())).not.toContain('sk-second');
```

Test activating the first entry, deleting active/non-active entries, fallback activation, mode `0600`, short-value masking, unknown IDs, and corrupt JSON failing without replacement.

Run: `pnpm --filter @worldbookllm/server test -- src/secrets/secret-store.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 2: Implement validated reads and atomic writes**

```ts
const secretValueSchema = z.strictObject({
  id: z.uuid(),
  value: z.string(),
  label: z.string(),
  active: z.boolean(),
});
const secretFileSchema = z.record(z.string(), z.array(secretValueSchema));
```

Ensure the data directory and initial `{}` file exist. Atomic writes use a same-directory temporary file, `0600`, fsync, rename, and cleanup. Validate that each key has at most one active entry; reject malformed state instead of rewriting it.

- [ ] **Step 3: Implement SillyTavern-compatible rotation and mandatory masking**

```ts
function mask(value: string): string {
  if (value.length <= 10) return '*'.repeat(10);
  return `${'*'.repeat(7)}${value.slice(-3)}`;
}
```

Adding deactivates all existing entries. Activating an unknown ID and deleting an unknown key/ID throw `NotFoundError`. Deleting an active entry activates the first remaining entry.

- [ ] **Step 4: Run secret-store verification**

Run sequentially:

```bash
pnpm --filter @worldbookllm/server test -- src/secrets/secret-store.test.ts
pnpm --filter @worldbookllm/server typecheck
```

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit and push**

```bash
git add apps/server/src/secrets
git commit -m "feat(server): add masked rotating secret store"
git push origin main
```

### Task 5: Services, Fastify Routes, and Integration

**Files:**

- Create: `apps/server/src/services/notebooks.ts`
- Create: `apps/server/src/services/sources.ts`
- Create: `apps/server/src/routes/helpers.ts`
- Create: `apps/server/src/routes/notebooks.ts`
- Create: `apps/server/src/routes/sources.ts`
- Create: `apps/server/src/routes/secrets.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

**Interfaces:**

- `buildApp(options?: {dataDir?: string; logger?: boolean})` owns a database and closes it through Fastify.
- Services throw `NotFoundError`, `InvalidStoredDataError`, or filesystem/database errors; route helpers map only known client/domain errors.

- [ ] **Step 1: Replace the health-only test with a failing isolated API harness**

```ts
async function makeApp() {
  const dataDir = await mkdtemp(join(tmpdir(), 'worldbookllm-app-'));
  const app = buildApp({ dataDir, logger: false });
  return { app, dataDir };
}

const created = await app.inject({
  method: 'POST',
  url: '/api/notebooks',
  payload: { name: 'Atlas' },
});
expect(created.statusCode).toBe(201);
```

Run: `pnpm --filter @worldbookllm/server test -- src/app.test.ts`

Expected: FAIL with route not found.

- [ ] **Step 2: Implement notebook service and routes**

Prepare explicit SQL statements for list/get/create/update/delete. Parse `settings_json` with `providerConfigSchema.nullable()` before returning it. Update `updated_at` on patches. Wrap notebook deletion and `SourceFileStore.removeNotebook()` in a synchronous database transaction so a filesystem error rolls back cascades.

Register routes with shared request schemas and return `201`, `204`, `400`, and `404` exactly as specified.

- [ ] **Step 3: Implement source service and routes**

On create, verify the notebook, write Markdown, insert metadata, and remove the new file if insertion fails. On detail read, parse the file fresh and update SQLite when title, slug-independent metadata, word count, hash, or updated timestamp changed. On delete, wrap row deletion plus file removal in a database transaction.

Return source list rows without content and detail rows with current `content`. Preserve `filePath` as a relative path in the API because visible-on-disk storage is a product property.

- [ ] **Step 4: Implement secret routes and common error mapping**

Use `createSecretSchema` for POST and bounded key/UUID schemas for path parameters. Route handlers return `store.getState()`, the single masked entry from `add`, `204` for activate/delete, and never call `readActive()`.

Zod failures return:

```json
{ "error": "validation_error", "message": "Invalid request", "issues": [] }
```

Missing resources return `{ "error": "not_found", "message": "..." }` without leaking filesystem paths or secret values.

- [ ] **Step 5: Expand integration coverage**

Test in one temporary app per test group:

- notebook create/list/get/patch/delete and invalid/unknown requests;
- source paste writes frontmatter and a row, list omits content, detail reads current disk content, and delete removes both;
- external title/body edits reconcile the source response and SQLite metadata;
- notebook deletion cascades sources/chats and removes its directory;
- secret add/list/activate/delete returns only masked values;
- app close and reopen against the same directory preserves data and migration version.

Run: `pnpm --filter @worldbookllm/server test -- src/app.test.ts`

Expected: all integration tests PASS.

- [ ] **Step 6: Run server checkpoint verification**

Run sequentially:

```bash
pnpm --filter @worldbookllm/server test
pnpm --filter @worldbookllm/server typecheck
pnpm --filter @worldbookllm/server build
```

Expected: all tests PASS; TypeScript and build exit 0.

- [ ] **Step 7: Commit and push**

```bash
git add apps/server/src
git commit -m "feat(server): add notebook source and secret APIs"
git push origin main
```

### Task 6: Final Review and Repository Verification

**Files:**

- Modify only files required by review findings.
- Update: `/home/dev/.claude/tasks/3d065225-2722-4186-b181-578eb9721459/5.json` after all verification (outside the repository).

**Interfaces:**

- Produces a clean, pushed Phase 5 commit with all repository gates green.

- [ ] **Step 1: Review the complete Phase 5 diff**

Run:

```bash
git diff e60944b..HEAD --stat
git diff e60944b..HEAD --check
git status --short
```

Inspect for source content in SQL, raw secrets in responses/errors, unsafe paths, open database handles, migration non-idempotency, missing compensation, and response/schema mismatch. Fix findings with focused regression tests first.

- [ ] **Step 2: Run final gates sequentially**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0. Do not run commands concurrently.

- [ ] **Step 3: Inspect human-readable persistence**

Use an isolated temporary app/test fixture and confirm the persisted source is frontmattered Markdown, `secrets.json` has mode `0600`, source content is absent from SQLite, and reopening keeps data available. Never print raw secret file contents.

- [ ] **Step 4: Commit review fixes and push**

```bash
git add <reviewed-files>
git commit -m "fix(server): harden Phase 5 data layer"
git push origin main
git status --short --branch
```

Expected: `main...origin/main` with no worktree changes.

- [ ] **Step 5: Mark Phase 5 complete**

Set the external task JSON status to `completed` only after the final push and clean remote comparison. Record final commit hashes and verification counts in the user handoff.
