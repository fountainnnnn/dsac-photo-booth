/**
 * ComposedPreview — Visual regression tests
 *
 * Asserts design-spec colors, typography, and element visibility using
 * computed CSS properties. No screenshot diffing — all assertions are code-based.
 *
 * Pre-requisites: Vite dev server running at http://localhost:5173
 * Run: npx playwright test ComposedPreview.visual.spec.ts
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

declare global {
  interface Window {
    __DSAC_E2E_USE_ORIGINAL_PHOTO__?: boolean;
  }
}

// ---------------------------------------------------------------------------
// Design token constants
// ---------------------------------------------------------------------------
const COLORS = {
  pageBg: 'rgb(244, 241, 236)',
  accent: 'rgb(17, 16, 15)',
  retakeDefault: 'rgb(93, 85, 75)',
  retakeBorder: 'rgb(207, 199, 186)',
  continueText: 'rgb(255, 255, 255)',
};

const VIEWPORTS = [
  { name: 'mobile',  width: 375,  height: 667  },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 800  },
  { name: 'large',   width: 1920, height: 1080 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates through the full capture → upload → compose flow and waits for
 * the composed-preview-root element to appear.
 */
async function navigateToComposedPreview(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await context.grantPermissions(['camera']);
  await context.addInitScript(() => {
    window.__DSAC_E2E_USE_ORIGINAL_PHOTO__ = true;
  });

  // Stub the upload endpoint to resolve immediately
  await page.route('/api/photos', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'visual-test-id',
        url: '/api/photos/visual-test-id',
        createdAt: new Date().toISOString(),
      }),
    });
  });

  // Stub image loads so usePhotoComposer can finish in jsdom-less browser env
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
  await page.waitForSelector('[data-testid="bg-picker-root"]', {
    timeout: 30_000,
  });
  await page.setInputFiles(
    '[data-testid="bg-picker-file-input"]',
    'public/dsac-template.png',
  );
  await page.locator('[data-testid="bg-picker-confirm"]').click();

  // Wait for composition to complete (PhotoComposer renders spinner then transitions)
  await page.waitForSelector('[data-testid="composed-preview-root"]', {
    timeout: 30_000,
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
}

async function collectIssues(page: Page, label: string): Promise<string[]> {
  const issues: string[] = [];

  const checks: Array<{ description: string; fn: () => Promise<void> }> = [
    {
      description: 'root background color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="composed-preview-root"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        if (color !== COLORS.pageBg) {
          issues.push(
            `[${label}] root bg: expected "${COLORS.pageBg}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'composed image is visible',
      fn: async () => {
        const visible = await page
          .locator('[data-testid="composed-preview-image"]')
          .isVisible();
        if (!visible)
          issues.push(`[${label}] composed-preview-image is not visible`);
      },
    },
    {
      description: 'composed image src starts with data:image/jpeg',
      fn: async () => {
        const src = await page
          .locator('[data-testid="composed-preview-image"]')
          .getAttribute('src');
        if (!src?.startsWith('data:image/jpeg')) {
          issues.push(
            `[${label}] composed-preview-image src: expected data:image/jpeg prefix, got "${src?.slice(0, 40)}"`,
          );
        }
      },
    },
    {
      description: 'controls row is visible',
      fn: async () => {
        const visible = await page
          .locator('[data-testid="composed-preview-controls"]')
          .isVisible();
        if (!visible)
          issues.push(`[${label}] composed-preview-controls is not visible`);
      },
    },
    {
      description: 'retake button border color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="composed-preview-retake"]')
          .evaluate((el) => getComputedStyle(el).borderTopColor);
        if (color !== COLORS.retakeBorder) {
          issues.push(
            `[${label}] retake border: expected "${COLORS.retakeBorder}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'retake button text color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="composed-preview-retake"]')
          .evaluate((el) => getComputedStyle(el).color);
        if (color !== COLORS.retakeDefault) {
          issues.push(
            `[${label}] retake text color: expected "${COLORS.retakeDefault}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'continue button background color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="composed-preview-continue"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        if (color !== COLORS.accent) {
          issues.push(
            `[${label}] continue bg: expected "${COLORS.accent}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'continue button text color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="composed-preview-continue"]')
          .evaluate((el) => getComputedStyle(el).color);
        if (color !== COLORS.continueText) {
          issues.push(
            `[${label}] continue text color: expected "${COLORS.continueText}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'retake button label text',
      fn: async () => {
        const text = await page
          .locator('[data-testid="composed-preview-retake"]')
          .textContent();
        if (text?.trim() !== 'Retake') {
          issues.push(
            `[${label}] retake label: expected "Retake", got "${text?.trim()}"`,
          );
        }
      },
    },
    {
      description: 'continue button label text',
      fn: async () => {
        const text = await page
          .locator('[data-testid="composed-preview-continue"]')
          .textContent();
        if (text?.trim() !== 'Continue') {
          issues.push(
            `[${label}] continue label: expected "Continue", got "${text?.trim()}"`,
          );
        }
      },
    },
    {
      description: 'both buttons use app radius',
      fn: async () => {
        for (const testId of ['composed-preview-retake', 'composed-preview-continue']) {
          const radius = await page
            .locator(`[data-testid="${testId}"]`)
            .evaluate((el) =>
              parseFloat(getComputedStyle(el).borderTopLeftRadius),
            );
          if (radius < 6) {
            issues.push(
              `[${label}] ${testId} border-radius: expected at least 6px, got ${radius}px`,
            );
          }
        }
      },
    },
    {
      description: 'continue button has glow shadow',
      fn: async () => {
        const shadow = await page
          .locator('[data-testid="composed-preview-continue"]')
          .evaluate((el) => getComputedStyle(el).boxShadow);
        if (!shadow || shadow === 'none') {
          issues.push(`[${label}] continue button has no box-shadow glow`);
        }
      },
    },
  ];

  for (const check of checks) {
    try {
      await check.fn();
    } catch (e) {
      issues.push(
        `[${label}] "${check.description}" threw: ${(e as Error).message}`,
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('ComposedPreview — Visual', () => {
  test.setTimeout(60_000);

  for (const viewport of VIEWPORTS) {
    test(`visual checks at ${viewport.name} (${viewport.width}×${viewport.height})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        permissions: ['camera'],
      });
      const page = await context.newPage();

      await navigateToComposedPreview(context, page);

      const issues = await collectIssues(
        page,
        `${viewport.name} ${viewport.width}×${viewport.height}`,
      );

      await context.close();

      if (issues.length > 0) {
        console.error('\nVisual discrepancies found:\n' + issues.join('\n'));
      }
      expect(issues, 'Visual discrepancies:\n' + issues.join('\n')).toHaveLength(0);
    });
  }
});
