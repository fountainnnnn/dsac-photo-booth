/**
 * ComposedPreview — End-to-end flow tests
 *
 * Tests the full camera → capture → upload → compose → composed-preview flow.
 *
 * Pre-requisites: Vite dev server running at http://localhost:5173
 * Run: npx playwright test ComposedPreview.e2e.spec.ts
 */

import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __DSAC_E2E_USE_ORIGINAL_PHOTO__?: boolean;
  }
}

async function selectTemplateBackground(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="bg-picker-root"]', {
    timeout: 15_000,
  });
  await page.setInputFiles(
    '[data-testid="bg-picker-file-input"]',
    'public/dsac-template.png',
  );
  await expect(page.locator('[data-testid="bg-picker-confirm"]')).toBeEnabled();
  await page.locator('[data-testid="bg-picker-confirm"]').click();
}

// ---------------------------------------------------------------------------
// Helper: run through capture → confirm → wait for composed-preview-root
// ---------------------------------------------------------------------------
async function captureAndCompose(page: import('@playwright/test').Page) {
  await page.context().grantPermissions(['camera']);

  // Stub the upload endpoint
  await page.route('/api/photos', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'e2e-test-id',
        url: '/api/photos/e2e-test-id',
        createdAt: new Date().toISOString(),
      }),
    });
  });

  await page.goto('/capture');
  await page.waitForSelector('[data-testid="capture-video-element"]');

  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>(
      '[data-testid="capture-video-element"]',
    );
    if (video) video.dispatchEvent(new Event('canplay'));
  });

  await page.waitForFunction(() => {
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-testid="capture-button"]',
    );
    return btn && !btn.disabled;
  });

  await page.locator('[data-testid="capture-button"]').click();
  await page.waitForSelector('[data-testid="photo-preview-root"]');

  await page.locator('[data-testid="photo-preview-confirm"]').click();
  await selectTemplateBackground(page);

  await page.waitForSelector('[data-testid="composed-preview-root"]', {
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Compose Branded Photo flow (E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera']);
    await context.addInitScript(() => {
      window.__DSAC_E2E_USE_ORIGINAL_PHOTO__ = true;
    });
  });

  test('confirming upload transitions to the PhotoComposer spinner', async ({
    page,
  }) => {
    // Delay upload so we can observe the compose spinner
    await page.route('/api/photos', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'e2e-spinner-id',
          url: '/api/photos/e2e-spinner-id',
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/capture');
    await page.waitForSelector('[data-testid="capture-video-element"]');

    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="capture-video-element"]',
      );
      if (video) video.dispatchEvent(new Event('canplay'));
    });

    await page.waitForFunction(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="capture-button"]',
      );
      return btn && !btn.disabled;
    });

    await page.locator('[data-testid="capture-button"]').click();
    await page.waitForSelector('[data-testid="photo-preview-root"]');
    await page.locator('[data-testid="photo-preview-confirm"]').click();
    await selectTemplateBackground(page);

    // Either the composer or composed preview should eventually appear
    await page.waitForSelector(
      '[data-testid="photo-composer-root"],[data-testid="composed-preview-root"]',
      { timeout: 15_000 },
    );
  });

  test('composed-preview-root is visible after composition completes', async ({
    page,
  }) => {
    await captureAndCompose(page);

    await expect(
      page.locator('[data-testid="composed-preview-root"]'),
    ).toBeVisible();
  });

  test('composed image src starts with data:image/jpeg', async ({ page }) => {
    await captureAndCompose(page);

    const src = await page
      .locator('[data-testid="composed-preview-image"]')
      .getAttribute('src');

    expect(src).toBeTruthy();
    expect(src!.startsWith('data:image/jpeg')).toBe(true);
  });

  test('composed-preview shows Continue and Retake buttons', async ({ page }) => {
    await captureAndCompose(page);

    await expect(
      page.locator('[data-testid="composed-preview-continue"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="composed-preview-retake"]'),
    ).toBeVisible();
  });

  test('"Retake" from composed-preview returns to camera view', async ({
    page,
  }) => {
    await captureAndCompose(page);

    await page.locator('[data-testid="composed-preview-retake"]').click();

    await expect(
      page.locator('[data-testid="capture-camera-root"]'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('"Continue" from composed-preview transitions to QR download', async ({
    page,
  }) => {
    await captureAndCompose(page);

    await page.locator('[data-testid="composed-preview-continue"]').click();

    await expect(
      page.locator('[data-testid="qr-screen-root"]'),
    ).toBeVisible({ timeout: 5_000 });
  });
});
