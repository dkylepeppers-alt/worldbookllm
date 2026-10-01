import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('series canon journey on a phone', async ({ page }, testInfo) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir).toBeTruthy();
  await page.goto('/books');
  await page.getByLabel('New book or series title').fill('Series Harbor');
  await page.getByRole('button', { name: 'Create book', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/series-harbor\/write$/u);
  const tabs = page.getByRole('navigation', { name: 'Book', exact: true });
  await tabs.getByRole('link', { name: 'Bible', exact: true }).click();
  await page.getByLabel('New character').fill('Mira Series');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/series-harbor\/files\/characters\/mira-series\.md$/u);

  await tabs.getByRole('link', { name: 'Project', exact: true }).click();
  await page.getByLabel('New series title').fill('Series Tides');
  await page.getByRole('button', { name: 'Make this a series', exact: true }).click();
  await page.getByRole('button', { name: 'Seed bible from this book' }).click();
  await expect
    .poll(async () =>
      (await page.request.get('/api/books/series-tides/files/characters/mira-series.md')).status(),
    )
    .toBe(200);

  await page.getByLabel('Add a book to this series').fill('Series High Water');
  await page.getByRole('button', { name: 'Add book', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/series-high-water\/write$/u);
  await tabs.getByRole('link', { name: 'Project', exact: true }).click();
  await page.getByRole('link', { name: 'Series overview', exact: true }).click();
  await page.getByLabel('Bible entity').selectOption('character:mira-series');
  await page.getByLabel('Carry into book').selectOption('series-high-water');
  await page.getByRole('button', { name: 'Carry entity' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Series sync recorded' })).toBeVisible();

  await page.getByRole('link', { name: 'Series bible', exact: true }).click();
  await tabs.getByRole('link', { name: 'Bible', exact: true }).click();
  await page.getByRole('link', { name: 'Mira Series', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByLabel('Markdown, including frontmatter');
  await editor.fill((await editor.inputValue()).replace('aliases: []', 'aliases: [Captain]'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() =>
      readFile(
        join(dataDir ?? '', 'series/series-tides/series-bible/characters/mira-series.md'),
        'utf8',
      ),
    )
    .toContain('Captain');

  await tabs.getByRole('link', { name: 'Project', exact: true }).click();
  await page.getByRole('link', { name: 'Series overview', exact: true }).click();
  await page
    .getByRole('button', { name: 'Push mira-series to series-high-water', exact: true })
    .click();
  await expect
    .poll(() =>
      readFile(
        join(dataDir ?? '', 'series/series-tides/series-high-water/characters/mira-series.md'),
        'utf8',
      ),
    )
    .toContain('Captain');
  await expect(
    page.getByRole('button', { name: 'Push mira-series to series-high-water', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Push mira-series to series-harbor', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('series-phone.png'), fullPage: true });
});
