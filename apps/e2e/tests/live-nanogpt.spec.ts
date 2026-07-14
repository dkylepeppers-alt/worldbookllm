import { expect, test } from '@playwright/test';

// Live walking skeleton against real NanoGPT. Never runs in CI — it needs the
// operator's key. Phase 9 sign-off requires this spec to actually run (a skip
// is not verification, per the M1 contracts spec's Verification Contract):
//
//   SMOKE_NANOGPT_KEY=… pnpm --filter @worldbookllm/e2e test:e2e
const apiKey = process.env.SMOKE_NANOGPT_KEY;
const model = process.env.SMOKE_NANOGPT_MODEL ?? 'gpt-4o-mini';

test.skip(apiKey === undefined, 'SMOKE_NANOGPT_KEY not set — live NanoGPT e2e skipped');

test('M1 walking skeleton against live NanoGPT (through phase 8)', async ({ page }) => {
  await test.step('create a notebook with a source', async () => {
    await page.goto('/');
    await page.getByLabel('Notebook name').fill('Live Smoke Atlas');
    await page.getByRole('button', { name: 'Create notebook' }).click();
    // Creation navigates straight into the new notebook's workspace.
    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Live Smoke Atlas' })).toBeVisible();
    await page.getByRole('button', { name: 'Paste source' }).click();
    await page.getByLabel('Source title').fill('Smoke notes');
    await page.getByLabel('Markdown content').fill('The required reply word is brass.');
    await page.getByRole('button', { name: 'Save source' }).click();
    await expect(page.getByRole('link', { name: 'Smoke notes' })).toBeVisible();
  });

  await test.step('store the NanoGPT key', async () => {
    const notebookUrl = page.url();
    await page.goto('/settings');
    const card = page
      .locator('section.provider-settings-card')
      .filter({ has: page.getByRole('heading', { name: 'NanoGPT', exact: true }) });
    await card.getByRole('button', { name: 'Add key' }).click();
    await page.getByLabel('Key value').fill(apiKey ?? '');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(card.getByText('Active')).toBeVisible();
    await page.goto(notebookUrl);
  });

  await test.step('configure NanoGPT and verify the connection', async () => {
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: 'NanoGPT' });
    await page.locator('#provider-model').fill(model);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByRole('status')).toContainText(/reachable/i, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(page.getByRole('complementary', { name: 'Chat' })).toContainText(model);
  });

  await test.step('create a chat against the live provider', async () => {
    await page.getByRole('button', { name: 'New chat' }).click();
    const chatDetail = page.getByRole('region', { name: 'Selected chat' });
    await expect(chatDetail).toBeVisible();
    // PHASE 9: send "Reply with exactly: brass" and assert the grounded,
    // streamed answer arrives and persists (mirrors the server smoke test).
    await expect(chatDetail).toContainText('Messages and streaming arrive in Phase 9.');
  });
});
