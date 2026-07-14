import { expect, test } from '@playwright/test';

import { SLOW_MARKER } from '../stub-provider/stub-provider.js';

const CUSTOM_PROVIDER_LABEL = 'Custom (OpenAI-compatible)';

// Step 6 of the M1 journey: interrupt a generation mid-stream. The stub
// provider drips deltas for ~30s when the message contains the [slow]
// marker, leaving plenty of room to hit Stop; the abort must persist the
// partial assistant message as `interrupted` — including across a reload.
test('stopping a slow generation persists an interrupted message', async ({ page }) => {
  const stubUrl = process.env.E2E_STUB_URL;
  expect(stubUrl, 'global-setup must publish the stub provider URL').toBeTruthy();

  await test.step('create a notebook wired to the stub provider', async () => {
    await page.goto('/');
    await page.getByLabel('Notebook name').fill('Interrupted Harbor');
    await page.getByRole('button', { name: 'Create notebook' }).click();
    await expect(page).toHaveURL(/\/notebooks\/[0-9a-f-]+$/);
    await page.getByRole('button', { name: 'Configure provider' }).click();
    await page.locator('#provider-source').selectOption({ label: CUSTOM_PROVIDER_LABEL });
    await page.getByLabel('Base URL').fill(stubUrl ?? '');
    await page.locator('#provider-model').fill('stub-model');
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(page.getByRole('complementary', { name: 'Chat' })).toContainText('stub-model');
  });

  const chatDetail = page.getByRole('region', { name: 'Selected chat' });

  await test.step('stop a slow stream mid-flight', async () => {
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(chatDetail).toBeVisible();
    await page.getByLabel('Message').fill(`${SLOW_MARKER} narrate the tide tables at length`);
    await chatDetail.getByRole('button', { name: 'Send' }).click();
    await expect(chatDetail).toContainText('tick 1');
    await chatDetail.getByRole('button', { name: 'Stop' }).click();
    await expect(chatDetail.getByText('Interrupted')).toBeVisible();
  });

  await test.step('the interrupted message survives a reload', async () => {
    await page.reload();
    await page
      .locator('.chat-list')
      .getByRole('button', { name: /New chat/ })
      .click();
    await expect(chatDetail.getByText('Interrupted')).toBeVisible();
    await expect(chatDetail).toContainText('tick 0');
  });
});
