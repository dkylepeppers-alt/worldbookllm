import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { makeZip } from '../../server/src/story/test-zip.js';

const BOOK_TITLE = 'The Salt Road';

// M7 phase 2a (spec: docs/superpowers/specs/2026-09-30-story-workspace-design.md):
// a story-skills book driven entirely at phone width, with the real story CLI
// behind every structural action.
test.use({ viewport: { width: 390, height: 844 } });

test('M7 story workspace on a phone', async ({ page }) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();
  const bookDir = join(dataDir ?? '', 'projects', 'the-salt-road');
  const tabs = page.getByRole('navigation', { name: 'Book' });

  await test.step('create a book', async () => {
    await page.goto('/books');
    await page.getByLabel('New book or series title').fill(BOOK_TITLE);
    await page.getByRole('button', { name: 'Create book' }).click();
    await expect(page).toHaveURL(/\/books\/the-salt-road\/write$/);
    await expect(page.getByRole('heading', { name: BOOK_TITLE, level: 1 })).toBeVisible();
    // The tab bar sits at the bottom of a phone screen.
    const box = await tabs.boundingBox();
    expect(box && box.y + box.height).toBeGreaterThan(800);
  });

  await test.step('add a chapter with story add', async () => {
    await page.getByLabel('New chapter').fill('Arrival');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page).toHaveURL(/\/files\/chapters\/chapter-01\.md$/);
    await expect(page.getByRole('heading', { name: 'Arrival', level: 2 })).toBeVisible();
    await expect(readFile(join(bookDir, 'chapters/chapter-01.md'), 'utf8')).resolves.toContain(
      'title: Arrival',
    );
  });

  await test.step('add a character and edit it', async () => {
    await tabs.getByRole('link', { name: 'Bible' }).click();
    await page.getByLabel('New character').fill('Mara Quill');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('heading', { name: 'Mara Quill', level: 2 })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByLabel('Markdown, including frontmatter');
    const content = await editor.inputValue();
    await editor.fill(content.replace('## Appearance', '## Appearance\n\nSalt-grey eyes.'));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Salt-grey eyes.')).toBeVisible();
    // The page can show the edit before the save's write lands; poll the disk.
    await expect
      .poll(() => readFile(join(bookDir, 'characters/mara-quill.md'), 'utf8'))
      .toContain('Salt-grey eyes.');
  });

  await test.step('see the story checks', async () => {
    await tabs.getByRole('link', { name: 'Health' }).click();
    const checks = page.getByRole('list', { name: 'Checks' });
    await expect(checks.getByText('validate')).toBeVisible();
    await expect(checks.getByText('links')).toBeVisible();
  });

  await test.step('undo the edit from history', async () => {
    await tabs.getByRole('link', { name: 'Project' }).click();
    const history = page.getByRole('list', { name: 'History' });
    await expect(history.getByText('Edit characters/mara-quill.md')).toBeVisible();
    await history.getByRole('button', { name: 'Undo' }).click();
    await expect(history.getByText(/undone/u)).toBeVisible();
    await expect(
      readFile(join(bookDir, 'characters/mara-quill.md'), 'utf8'),
    ).resolves.not.toContain('Salt-grey eyes.');
  });

  await test.step('build an EPUB and download it', async () => {
    await page.getByLabel('Format').selectOption('epub');
    await page.getByRole('button', { name: 'Build' }).click();
    await expect(page.getByRole('status', { name: 'Build output' })).toContainText(
      'as epub to ./dist/the-salt-road.epub',
    );
    const builds = page.getByRole('list', { name: 'Built files' });
    const downloading = page.waitForEvent('download');
    await builds.getByRole('link', { name: 'the-salt-road.epub' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('the-salt-road.epub');
    const bytes = await readFile((await download.path()) ?? '');
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    // Builds are not book content: nothing about them enters the history.
    await expect(page.getByRole('list', { name: 'History' })).not.toContainText('dist/');
  });

  await test.step('import the book back from a project zip', async () => {
    const entries = [];
    for (const path of await readdir(bookDir, { recursive: true, withFileTypes: true })) {
      if (!path.isFile()) continue;
      const full = join(path.parentPath, path.name);
      entries.push({
        name: `salt-road/${full.slice(bookDir.length + 1).replaceAll('\\', '/')}`,
        data: await readFile(full),
      });
    }
    await page.goto('/books');
    await page.getByLabel(/Import a manuscript or project/u).setInputFiles({
      name: 'salt-road-backup.zip',
      mimeType: 'application/zip',
      buffer: makeZip(entries),
    });
    await expect(page).toHaveURL(/\/books\/the-salt-road-2\/write$/);
    const report = page.getByRole('status', { name: 'Import report' });
    await expect(report).toContainText('from salt-road-backup.zip');
    await expect(report).toContainText('salt-road/dist/the-salt-road.epub (build output)');
    await expect(page.getByRole('link', { name: /Arrival/u })).toBeVisible();
  });
});
