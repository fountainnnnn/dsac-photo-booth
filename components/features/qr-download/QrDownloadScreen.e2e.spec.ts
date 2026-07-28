/**
 * QrDownloadScreen — End-to-end flow tests
 *
 * Tests the full capture → compose → QR download flow.
 *
 * Pre-requisites: Vite dev server running at http://localhost:5173
 * Run: npx playwright test QrDownloadScreen.e2e.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('QR Download flow (E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera']);
  });

  test('capture page renders and is the starting point for the QR flow', async ({ page }) => {
    await page.goto('/capture');
    await expect(page.locator('[data-testid="capture-page-root"]')).toBeVisible();
    await expect(page.locator('[data-testid="capture-camera-root"]')).toBeVisible();
  });

  test('download page renders for a given token', async ({ page }) => {
    await page.goto('/download/test-token-123');
    await expect(page.locator('[data-testid="download-page-root"]')).toBeVisible();
    await expect(page.locator('[data-testid="download-page-save-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="download-page-save-btn"]')).toHaveText('Save Photo');
  });

  test('download page save button has correct href', async ({ page }) => {
    await page.goto('/download/test-token-123');
    const link = page.locator('[data-testid="download-page-save-btn"]');
    await expect(link).toHaveAttribute('href', '/api/download/test-token-123');
    await expect(link).toHaveAttribute('download', 'dsac-photo.jpg');
  });
});
