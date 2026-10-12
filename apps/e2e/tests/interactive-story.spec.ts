import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

// Interactive books written in ink (ADR 0030), on a phone: convert a book,
// give a chapter choices, see a compile error at its line, play it, find a
// dead end by playing every path, and export a web page that plays on its own.
test.use({ viewport: { width: 390, height: 844 } });

test('an interactive story in ink on a phone', async ({ page }) => {
  const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;
  expect(dataDir, 'playwright.config must publish the data dir').toBeTruthy();
  const bookDir = join(dataDir ?? '', 'projects', 'the-gull-rock-light');
  const tabs = page.getByRole('navigation', { name: 'Book' });
  const chapter = (number: number) => join(bookDir, `chapters/chapter-0${number}.md`);

  await test.step('create a book with two chapters of prose', async () => {
    await page.goto('/books');
    await page.getByLabel('New book or series title').fill('The Gull Rock Light');
    await page.getByRole('button', { name: 'Create book' }).click();
    await expect(page).toHaveURL(/\/books\/the-gull-rock-light\/write$/);
    for (const title of ['Harbor Wall', 'The Lamp Room']) {
      await tabs.getByRole('link', { name: 'Write' }).click();
      await page.getByLabel('New chapter').fill(title);
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
    }
    for (const [number, prose] of [
      [1, 'The lamp is *dark*.'],
      [2, 'Glass crunches underfoot.'],
    ] as const) {
      await writeFile(chapter(number), `${await readFile(chapter(number), 'utf8')}\n${prose}\n`);
    }
    await expect(tabs.getByRole('link', { name: 'Branches' })).toHaveCount(0);
  });

  await test.step('review the conversion, then convert to ink chapters', async () => {
    await tabs.getByRole('link', { name: 'Write' }).click();
    await page.getByRole('link', { name: 'Make it interactive' }).click();
    await page.getByRole('button', { name: 'Review the changes' }).click();
    const files = page.getByRole('list', { name: 'Files the conversion changes' });
    await files.getByRole('button', { name: 'chapters/chapter-01.md' }).click();
    await expect(page.getByRole('dialog')).toContainText('-> chapter_02');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Convert to ink chapters' }).click();
    await expect(page.getByText('2 chapters · 0 choices · 1 ending · 0 variables')).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Branches' })).toBeVisible();
    await expect(readFile(chapter(1), 'utf8')).resolves.toMatch(
      /## Chapter Text\n\nThe lamp is \*dark\*\.\n\n-> chapter_02\n$/u,
    );
  });

  await test.step('give the first chapter choices', async () => {
    await page.getByRole('link', { name: 'Edit choices' }).click();
    const card = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'Harbor Wall' }),
    });
    await card.getByRole('button', { name: 'Add a choice' }).click();
    await card.getByLabel('Choice 1', { exact: true }).fill('Light the lamp');
    await card.getByLabel('Leads to').selectOption('chapter_02');
    await card.getByLabel('When picked').fill('lamp_lit = true');
    await card.getByRole('button', { name: 'Add a choice' }).click();
    await card.getByLabel('Choice 2', { exact: true }).fill('Leave it dark');
    await card.getByLabel('Leads to').nth(1).selectOption('END');
    await card.getByRole('button', { name: 'Save choices' }).click();
    await expect
      .poll(() => readFile(chapter(1), 'utf8'))
      .toContain(
        '+ [Light the lamp]\n    ~ lamp_lit = true\n    -> chapter_02\n+ [Leave it dark] -> END\n',
      );
    // The save writes the chapter, then declares the variable; wait for both.
    await expect
      .poll(() => readFile(join(bookDir, 'ink/variables.md'), 'utf8'))
      .toContain('VAR lamp_lit = false');
  });

  await test.step('see an error in the ink editor as it is typed', async () => {
    await page.goto('/books/the-gull-rock-light/files/chapters/chapter-02.md');
    await expect(page.getByLabel('Ink')).toContainText('Glass crunches underfoot.');
    await page.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('textbox', { name: 'chapters/chapter-02.md, ink' });
    await expect(editor).toContainText('Glass crunches underfoot.');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nSee https://example.org now.\nThe lamp {oops');
    const problems = page.getByRole('list', { name: 'Problems in this file' });
    await expect(problems).toContainText('error');
    await expect(problems.getByRole('button', { name: /^Line \d+$/u }).first()).toBeVisible();
    // The web address's // is flagged as a comment trap on its line.
    await expect(page.locator('.cm-lintRange-warning')).toHaveCount(1);
    await page.getByRole('button', { name: 'Discard edits' }).click();
    await expect(page.getByLabel('Ink')).not.toContainText('oops');
  });

  await test.step('see a compile error at its line, then fix it', async () => {
    const text = await readFile(chapter(2), 'utf8');
    await writeFile(
      chapter(2),
      text.replace('Glass crunches underfoot.', 'Glass {crunches underfoot.'),
    );
    await tabs.getByRole('link', { name: 'Health' }).click();
    const findings = page.getByRole('list', { name: 'Ink findings' });
    // Health runs story report and story next first, which take a while on a busy machine.
    await expect(findings).toContainText('chapters/chapter-02.md, line', { timeout: 30_000 });
    await writeFile(
      chapter(2),
      text.replace(
        'Glass crunches underfoot.',
        'Glass crunches underfoot. {lamp_lit: The light catches it.}',
      ),
    );
    await tabs.getByRole('link', { name: 'Branches' }).click();
    await expect(page.getByText('2 chapters · 2 choices · 2 endings · 1 variable')).toBeVisible();
  });

  await test.step('play it', async () => {
    await page.getByRole('link', { name: 'Play from the start' }).click();
    const story = page.getByRole('article', { name: 'Story' });
    await expect(story.getByRole('heading', { name: 'Harbor Wall' })).toBeVisible();
    await expect(story.locator('em', { hasText: 'dark' })).toBeVisible();
    await story.getByRole('button', { name: 'Light the lamp' }).click();
    await expect(story).toContainText('The light catches it.');
    await expect(page.getByRole('region', { name: 'Story state' })).toContainText('lamp_lit true');
    await expect(story).toContainText('The end.');
  });

  await test.step('play every path on Health, and reproduce a dead end in Play', async () => {
    const text = await readFile(chapter(2), 'utf8');
    expect(text).toContain('-> END');
    await writeFile(chapter(2), text.replace('-> END', ''));
    await tabs.getByRole('link', { name: 'Health' }).click();
    const errors = page.getByRole('list', { name: 'Errors while playing' });
    await expect(errors).toContainText('ran out of content', { timeout: 30_000 });
    await expect(page.getByText(/^Played every path: \d+ distinct states\./u)).toBeVisible();
    await errors.getByRole('link', { name: 'Reproduce in Play (1 choice)' }).click();
    await expect(page.getByText('The ink story stopped with an error')).toBeVisible();
    await writeFile(chapter(2), text);
  });

  await test.step('export a web page that plays on its own', async () => {
    await tabs.getByRole('link', { name: 'Project' }).click();
    await expect(page.getByLabel('Format')).toHaveValue('web');
    await page.getByRole('button', { name: 'Build' }).click();
    const builds = page.getByRole('list', { name: 'Built files' });
    const downloading = page.waitForEvent('download');
    await builds.getByRole('link', { name: 'the-gull-rock-light.html' }).click();
    const download = await downloading;
    // Saved under its own name: a page opens as HTML only with its extension.
    const path = join(
      await mkdtemp(join(tmpdir(), 'worldbookllm-web-player-')),
      download.suggestedFilename(),
    );
    await download.saveAs(path);
    await page.goto(pathToFileURL(path).href);
    await expect(
      page.getByRole('heading', { name: 'The Gull Rock Light', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Harbor Wall' })).toBeVisible();
    await page.getByRole('button', { name: 'Light the lamp' }).click();
    await expect(page.getByText('The light catches it.')).toBeVisible();
    await expect(page.getByText('The end.')).toBeVisible();
  });
});
