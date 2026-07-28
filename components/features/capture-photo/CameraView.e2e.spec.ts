/**
 * CameraView — End-to-end flow tests
 *
 * Tests the full camera → preview user flow using Playwright.
 * Camera permission is granted via browser context.
 *
 * Pre-requisites: Vite dev server running at http://localhost:5173
 * Run: npx playwright test CameraView.e2e.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Capture Photo flow (E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera']);
  });

  test('landing page has "Start Camera" link to /capture', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: /start camera/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/capture');
  });

  test('navigating to /capture shows the camera view', async ({ page }) => {
    await page.goto('/capture');
    await expect(page.locator('[data-testid="capture-page-root"]')).toBeVisible();
    await expect(page.locator('[data-testid="capture-camera-root"]')).toBeVisible();
    await expect(page.locator('[data-testid="capture-video-element"]')).toBeVisible();
  });

  test('capture button is present on the camera view', async ({ page }) => {
    await page.goto('/capture');
    // Wait for controls bar
    await page.waitForSelector('[data-testid="capture-controls"]');
    await expect(page.locator('[data-testid="capture-button"]')).toBeVisible();
  });

  test('pressing shutter transitions to the photo preview', async ({ page }) => {
    await page.goto('/capture');

    // Wait until the video element is present (stream may have started)
    await page.waitForSelector('[data-testid="capture-video-element"]');

    // Trigger canPlay event so isStreaming = true, button becomes enabled
    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="capture-video-element"]'
      );
      if (video) video.dispatchEvent(new Event('canplay'));
    });

    // Wait for capture button to be enabled
    await page.waitForFunction(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="capture-button"]'
      );
      return btn && !btn.disabled;
    });

    await page.locator('[data-testid="capture-button"]').click();

    // Should now show the preview
    await expect(
      page.locator('[data-testid="photo-preview-root"]')
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.locator('[data-testid="photo-preview-image"]')
    ).toBeVisible();
  });

  test('Retake from preview returns to camera view', async ({ page }) => {
    await page.goto('/capture');
    await page.waitForSelector('[data-testid="capture-video-element"]');

    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '[data-testid="capture-video-element"]'
      );
      if (video) video.dispatchEvent(new Event('canplay'));
    });

    await page.waitForFunction(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="capture-button"]'
      );
      return btn && !btn.disabled;
    });

    await page.locator('[data-testid="capture-button"]').click();
    await page.locator('[data-testid="photo-preview-root"]').waitFor();

    // Click Retake
    await page.locator('[data-testid="photo-preview-retake"]').click();

    await expect(
      page.locator('[data-testid="capture-camera-root"]')
    ).toBeVisible({ timeout: 5_000 });
  });

  test('error notice appears when camera permission is denied', async ({
    browser,
  }) => {
    // Create a context WITHOUT granting camera
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(
              Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
            ),
        },
      });
    });

    await page.goto('/capture');

    await expect(
      page.locator('[data-testid="capture-permission-notice"]')
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.locator('[data-testid="capture-permission-notice"]')
    ).toBeVisible();

    await context.close();
  });

  test('"Use Photo" shows loading state while upload is in-flight', async ({
    page,
  }) => {
    // Intercept the photos API with a long delay to observe the uploading state
    await page.route('/api/photos', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-id',
          url: '/api/photos/test-id',
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
    await page.locator('[data-testid="photo-preview-root"]').waitFor();

    // Trigger confirm — begins upload
    await page.locator('[data-testid="photo-preview-confirm"]').click();

    // Confirm button should immediately show "Saving…" and be disabled
    await expect(page.locator('[data-testid="photo-preview-confirm"]')).toHaveText(
      'Saving…',
    );
    await expect(
      page.locator('[data-testid="photo-preview-confirm"]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-testid="photo-preview-retake"]'),
    ).toBeDisabled();
  });
});
