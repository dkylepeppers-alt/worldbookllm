import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  STUB_BEAT_CHOICES,
  STUB_MODEL_ID,
  STUB_STORY,
  STUB_VARIABLE,
} from '../stub-provider/stub-provider.js';

// Discovering an interactive book by playing it (ADR 0033), on a phone: set
// the story up with a premise and a proposed variable, let lead mode write
// the opening and the beats after it, play into one, add the reader's own
// action as a real choice, and step back along the path.
test.use({ viewport: { width: 390, height: 844 } });

let previousProvider: unknown = null;

test.beforeAll(async ({ request }) => {
  const settings = await request.get('/api/app-settings');
  previousProvider = ((await settings.json()) as { providerConfig: unknown }).providerConfig;
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/app-settings', { data: { providerConfig: previousProvider } });
});

test('discover an interactive book by playing it', async ({ page, request }) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  const stubUrl = process.env.E2E_STUB_URL;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();
  const bookDir = join(dataDir ?? '', 'projects', 'the-keepers-letter');
  const chapter = (id: string) => readFile(join(bookDir, `chapters/${id}.md`), 'utf8');

  await test.step('set up a provider and an empty interactive book', async () => {
    await request.patch('/api/app-settings', {
      data: { providerConfig: { source: 'custom', model: STUB_MODEL_ID, baseUrl: stubUrl } },
    });
    await page.goto('/books');
    await page.getByLabel('New book or series title').fill("The Keeper's Letter");
    await page.getByRole('button', { name: 'Create book' }).click();
    await expect(page).toHaveURL(/\/books\/the-keepers-letter\/write$/);
    // A book with no chapters yet is made interactive from the Branches tab.
    await page.goto('/books/the-keepers-letter/branches');
    await page.getByRole('button', { name: 'Review the changes' }).click();
    await page.getByRole('button', { name: 'Convert to ink chapters' }).click();
    await expect(page.getByRole('heading', { name: 'Discover it by playing' })).toBeVisible();
  });

  await test.step('set the story up, with a variable the beat writer proposes', async () => {
    await page.getByRole('link', { name: 'Set up discovery' }).click();
    // The beat writer drafts the premise, shape, and endings; the writer edits them.
    await expect(page.getByLabel(/^Premise/u)).toHaveValue(STUB_STORY.kernel);
    await expect(page.getByLabel('Endings')).toHaveValue(STUB_STORY.endings);
    await page
      .getByLabel(/^Premise/u)
      .fill('A lighthouse keeper receives a letter she cannot read.');
    await page.getByRole('button', { name: 'Propose from the premise and bible' }).click();
    await expect(page.getByText(STUB_VARIABLE.meaning)).toBeVisible();
    await page.getByRole('button', { name: 'Add it' }).click();
    const variables = page.getByRole('list', { name: 'Variables' });
    await expect(variables.getByLabel('Name')).toHaveValue(STUB_VARIABLE.name);
    // Lead mode, one step ahead, three choices, and the beat writer writes the opening.
    await page.getByRole('button', { name: 'Save and start playing' }).click();
    await expect(page).toHaveURL(/\/branches\/play$/);
    await expect
      .poll(() => readFile(join(bookDir, 'ink/variables.md'), 'utf8'))
      .toContain(`// ${STUB_VARIABLE.meaning}\nVAR ${STUB_VARIABLE.name} = 0`);
  });

  await test.step('lead mode writes the opening and the beat after every choice', async () => {
    await expect(page.getByRole('heading', { name: 'The Rock' })).toBeVisible({ timeout: 20_000 });
    const choices = page.getByRole('list', { name: 'Choices' });
    for (const text of STUB_BEAT_CHOICES) {
      await expect(choices.getByRole('button', { name: text })).toBeVisible();
    }
    await expect(choices.getByRole('button', { name: 'Something else…' })).toBeVisible();
    // One step ahead: each choice's beat is written before it is chosen.
    for (const id of ['chapter-02', 'chapter-03', 'chapter-04']) {
      await expect.poll(() => chapter(id), { timeout: 20_000 }).toContain('discover: "written"');
    }
    await expect.poll(() => chapter('chapter-05')).toContain('discover: "seed"');
  });

  await test.step('play into a beat that is already written', async () => {
    await page.getByRole('button', { name: STUB_BEAT_CHOICES[0] }).click();
    await expect(page.getByRole('heading', { name: STUB_BEAT_CHOICES[0] })).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Story' }).getByText(/The fog thins\./u),
    ).toBeVisible();
    const trail = page.getByRole('navigation', { name: 'Your path' });
    await expect(trail.getByText(STUB_BEAT_CHOICES[0]!)).toHaveAttribute('aria-current', 'step');
  });

  await test.step('do something else, and play on into it', async () => {
    await page.getByRole('button', { name: 'Something else…' }).click();
    await page.getByLabel('What do you do?').fill('ring the storm bell');
    await page.getByRole('button', { name: 'Try it' }).click();
    await expect(page.getByRole('heading', { name: 'Ring the storm bell' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('article', { name: 'Story' }).getByText(/You ring the storm bell\./u),
    ).toBeVisible();
    // It is a real choice in the book now, on the beat it was typed at.
    await expect.poll(() => chapter('chapter-02')).toContain('* [Ring the storm bell] ->');
  });

  await test.step('step back along the path', async () => {
    await page
      .getByRole('navigation', { name: 'Your path' })
      .getByRole('button', { name: 'Start' })
      .click();
    await expect(page.getByRole('heading', { name: 'The Rock' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Your path' })).toHaveCount(0);
  });
});
