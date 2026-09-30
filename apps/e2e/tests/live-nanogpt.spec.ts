import { expect, test } from '@playwright/test';

// Live agent journey against real NanoGPT. Runs in CI when the
// SMOKE_NANOGPT_KEY repository secret is set; skipped otherwise. Phase 9
// sign-off requires this spec to actually run (a skip is not verification,
// per the M1 contracts spec's Verification Contract):
//
//   SMOKE_NANOGPT_KEY=… pnpm --filter @worldbookllm/e2e test:e2e
const apiKey = process.env.SMOKE_NANOGPT_KEY;
const model = process.env.SMOKE_NANOGPT_MODEL ?? 'gpt-4o-mini';

// CI wires this from a repository secret via `env:`, which sets the variable
// to an empty string rather than omitting it when the secret isn't
// configured — an equality check against `undefined` would run for real
// with no key instead of skipping.
test.skip(!apiKey, 'SMOKE_NANOGPT_KEY not set — live NanoGPT e2e skipped');

test('agent journey against live NanoGPT', async ({ page }) => {
  test.slow(); // live provider latency: triple the default timeout
  let bookUrl = '';
  await test.step('create a book', async () => {
    const created = await page.request.post('/api/books', { data: { title: 'Live Smoke Atlas' } });
    expect(created.ok()).toBe(true);
    bookUrl = `/books/${((await created.json()) as { slug: string }).slug}/agent`;
  });

  await test.step('store the NanoGPT key', async () => {
    await page.goto('/settings');
    const card = page
      .locator('section.provider-settings-card')
      .filter({ has: page.getByRole('heading', { name: 'NanoGPT', exact: true }) });
    await card.getByRole('button', { name: 'Add key' }).click();
    await page.getByLabel('Key value').fill(apiKey ?? '');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(card.getByText('Active')).toBeVisible();
  });

  await test.step('configure NanoGPT globally and verify the connection', async () => {
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: 'NanoGPT' });
    await page.locator('#provider-model').fill(model);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByRole('status')).toContainText(/reachable/i, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(page.getByText(`NanoGPT · ${model}`)).toBeVisible();
  });

  await test.step('stream an agent reply and persist it', async () => {
    await page.goto(bookUrl);
    // The reply-word contract: the message names the required word and the
    // streamed answer must contain it.
    await page
      .getByLabel('New chat')
      .fill('Without using any tools, reply with exactly this single word: brass');
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page).toHaveURL(/\/agent\/[0-9a-f-]+$/u);
    const messages = page.getByRole('list', { name: 'Messages' });
    await expect(messages).toContainText(/brass/i, { timeout: 60_000 });
    await expect(messages.getByText('Error', { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText(/brass/i);
  });
});
