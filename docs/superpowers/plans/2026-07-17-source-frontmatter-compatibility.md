# Source Frontmatter Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve user-authored Markdown frontmatter during source creation and make legacy files with merged extra fields readable again.

**Architecture:** `SourceFileStore` remains the serialization boundary. New writes give `gray-matter` an explicit content object so reviewed Markdown is wrapped rather than parsed; reads split managed keys from legacy unknown keys, strictly validate the managed record, and reconstruct unknown keys as visible body frontmatter.

**Tech Stack:** TypeScript, Node.js 20.19+, gray-matter 4, Zod 4, Vitest, Fastify injection, Playwright, pnpm 9

## Global Constraints

- Source Markdown remains user-visible and authoritative on disk.
- Preserve reviewed Markdown frontmatter without merging it into application metadata.
- Continue strict validation of WorldbookLLM identity, provenance, timestamps, category, and tags.
- Do not change API schemas, SQLite schemas, file paths, or the category/tag contract.
- Recover existing files lazily; do not rewrite them at startup.
- Relative ESM imports retain `.js` extensions.

---

### Task 1: Pin the storage and browser regressions

**Files:**
- Modify: `apps/server/src/files/source-files.test.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `apps/e2e/tests/organization.spec.ts`

**Interfaces:**
- Consumes: existing `SourceFileStore`, source create/detail routes, and organization browser journey.
- Produces: failing coverage for exact-content writes, legacy recovery, immediate API retrieval, and browser navigation after import.

- [ ] **Step 1: Add a failing new-write test**

Add to `apps/server/src/files/source-files.test.ts`:

```ts
it('keeps reviewed frontmatter in the Markdown body instead of merging it', () => {
  const { dataDir, store } = makeStore();
  const content = '---\nname: imported-skill\ndescription: User metadata\n---\n# Body\n';
  const stored = store.write({
    id: SOURCE_ID,
    notebookId: NOTEBOOK_ID,
    title: 'Imported body',
    content,
    origin: { type: 'paste' },
    conversionNotes: [],
    category: null,
    tags: [],
    createdAt: CREATED_AT,
  });
  const outer = matter(readFileSync(join(dataDir, stored.filePath), 'utf8'));
  expect(outer.data).not.toHaveProperty('name');
  expect(outer.data).not.toHaveProperty('description');
  expect(outer.content).toBe(content);
  expect(store.read(stored.filePath).content).toBe(content);
});
```

- [ ] **Step 2: Add a failing legacy-read test**

Write a managed file, use `matter.stringify(parsed.content, {...parsed.data, name: 'imported-skill', description: 'User metadata'})` to simulate the legacy merged shape, then assert:

```ts
const recovered = store.read(stored.filePath);
expect(recovered).toMatchObject({ category: 'lore', tags: ['managed-tag'] });
expect(matter(recovered.content)).toMatchObject({
  data: { name: 'imported-skill', description: 'User metadata' },
  content: '# Body\n',
});
```

The fixture must retain valid `id`, `notebookId`, `title`, `origin`, `conversionNotes`, `createdAt`, and `updatedAt` fields so failure is caused only by the unknown keys.

- [ ] **Step 3: Add a failing immediate-read API test**

Add to `apps/server/src/app.test.ts`:

```ts
it('creates and immediately reads reviewed Markdown with frontmatter', async () => {
  const notebook = await createNotebook();
  const content = '---\nsubtitle: Imported notes\nstatus: Draft\n---\n# Body\n\nVisible.\n';
  const created = await app.inject({
    method: 'POST',
    url: `/api/notebooks/${notebook.id}/sources`,
    payload: { title: 'Imported body', content },
  });
  expect(created.statusCode).toBe(201);
  const detail = await app.inject({
    method: 'GET',
    url: `/api/sources/${created.json<{ id: string }>().id}`,
  });
  expect(detail.statusCode).toBe(200);
  expect(detail.json()).toMatchObject({ title: 'Imported body', content });
});
```

- [ ] **Step 4: Extend Playwright with the reproduced import**

Add this step to `apps/e2e/tests/organization.spec.ts` after provider setup:

```ts
await test.step('save and open Markdown carrying user frontmatter', async () => {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'frontmattered-source.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\nname: imported-skill\ndescription: User metadata\n---\n# Imported body\n\nVisible content.\n',
    ),
  });
  await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
  await page.getByRole('button', { name: 'Save 1 source' }).click();
  const reader = page.getByRole('region', { name: 'Reader' });
  await expect(reader).toContainText('Visible content.');
  await expect(page.getByText('Could not open source')).toHaveCount(0);
});
```

- [ ] **Step 5: Verify RED**

Run:

```bash
pnpm --filter @worldbookllm/server test -- src/files/source-files.test.ts src/app.test.ts
WORLDBOOKLLM_E2E_CHROMIUM=/opt/google/chrome/chrome pnpm --filter @worldbookllm/e2e test:e2e -- organization.spec.ts
```

Expected: storage/API tests fail because reviewed frontmatter is merged; Playwright reaches “Could not open source.”

- [ ] **Step 6: Commit the regression tests**

```bash
git add apps/server/src/files/source-files.test.ts apps/server/src/app.test.ts apps/e2e/tests/organization.spec.ts
git commit -m "test: reproduce source frontmatter collision"
```

---

### Task 2: Separate managed and user frontmatter

**Files:**
- Modify: `apps/server/src/files/source-files.ts`

**Interfaces:**
- Consumes: `frontmatterSchema`, `SourceFileInput`, and `ReadSourceFile`.
- Produces: corrected write/read behavior without public signature changes.

- [ ] **Step 1: Define and partition managed keys**

After `frontmatterSchema`, add:

```ts
const managedFrontmatterKeys = new Set<string>(frontmatterSchema.keyof().options);

function partitionFrontmatter(data: Record<string, unknown>) {
  const managed: Record<string, unknown> = {};
  const user: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    (managedFrontmatterKeys.has(key) ? managed : user)[key] = value;
  }
  return { managed, user };
}
```

- [ ] **Step 2: Make writes wrap reviewed content**

Replace the string input to `matter.stringify` with an explicit content object while retaining the current managed data object:

```ts
const rendered = matter.stringify(
  { content: input.content, data: {} },
  {
    id: input.id,
    notebookId: input.notebookId,
    title: input.title,
    origin: input.origin,
    conversionNotes: input.conversionNotes,
    ...(input.category === null ? {} : { category: input.category }),
    ...(input.tags.length === 0 ? {} : { tags: input.tags }),
    createdAt: input.createdAt,
    updatedAt,
  },
);
```

Keep the current final-newline rule unchanged.

- [ ] **Step 3: Recover unknown keys on read**

Partition `parsed.data`, validate only `managed`, and derive metadata from reconstructed content:

```ts
const { managed, user } = partitionFrontmatter(parsed.data);
const frontmatter = frontmatterSchema.parse(managed);
const content =
  Object.keys(user).length === 0
    ? parsed.content
    : matter.stringify({ content: parsed.content, data: {} }, user);
return {
  ...frontmatter,
  content,
  ...deriveContentMetadata(content),
};
```

Managed `tags` and `category` remain outside the recovered body.

- [ ] **Step 4: Verify GREEN**

Run the two commands from Task 1 Step 5. Expected: all focused server and Playwright tests pass, and the reader renders `Visible content.`.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/server/src/files/source-files.ts
git commit -m "fix: preserve source content frontmatter"
```

---

### Task 3: Verify repository and live compatibility

**Files:**
- Verify only; no planned changes.

**Interfaces:**
- Consumes: Tasks 1–2 and the local source corpus.
- Produces: repository checks, four recovered live sources, and healthy restarted services.

- [ ] **Step 1: Run repository checks**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm format:check
```

Expected: every command exits 0.

- [ ] **Step 2: Restart only the exact existing development process tree**

Start `pnpm dev` from `/home/dev/worldbookllm` and keep the successful session running.

- [ ] **Step 3: Verify service health**

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:5173/
```

Expected: `{"status":"ok"}` and `200`.

- [ ] **Step 4: Verify live legacy recovery**

Require HTTP 200 from `/api/sources/:id` for:

```text
3922bb61-1a8c-4ee5-91bb-d5f2fd49105d
0e4d21a5-edc1-41ff-8b1c-cca93dd4309a
4e195ffc-1455-4c55-9825-1103101c0fbd
76410df6-b5b3-4291-b1b7-dc3c217f529a
```

Use Playwright with `/opt/google/chrome/chrome` to open one recovered source and assert that its Reader is visible and “Could not open source” is absent. Do not edit live data.

- [ ] **Step 5: Record final state**

```bash
git status -sb
git log --oneline -3
```

Expected: only intentional commits are present; no diagnostic notebooks or screenshot artifacts remain.
