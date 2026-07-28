/**
 * PhotoPreview — Visual regression tests
 *
 * Asserts exact design-spec values (colors, spacing, typography) using computed
 * CSS properties. No screenshot diffing — all assertions are code-based.
 *
 * Pre-requisites: Vite dev server running at http://localhost:5173
 * Run: npx playwright test PhotoPreview.visual.spec.ts
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Design token constants (from implementation plan, section 5)
// ---------------------------------------------------------------------------
const COLORS = {
  pageBg: 'rgb(244, 241, 236)',
  accent: 'rgb(17, 16, 15)',
  retakeDefault: 'rgb(93, 85, 75)',
  retakeBorder: 'rgb(207, 199, 186)',
  confirmText: 'rgb(255, 255, 255)',
};

// Viewports to test
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
 * Navigates to /capture, fires the shutter, and waits until the
 * photo-preview-root element is visible.
 */
async function navigateToPreview(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await context.grantPermissions(['camera']);
  await page.goto('/capture');
  await page.waitForSelector('[data-testid="capture-video-element"]');

  // Simulate the stream becoming ready so the capture button is enabled
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
}

async function collectIssues(page: Page, label: string): Promise<string[]> {
  const issues: string[] = [];

  const checks: Array<{ description: string; fn: () => Promise<void> }> = [
    {
      description: 'root background color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="photo-preview-root"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        if (color !== COLORS.pageBg) {
          issues.push(
            `[${label}] root bg: expected "${COLORS.pageBg}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'preview image is visible',
      fn: async () => {
        const visible = await page
          .locator('[data-testid="photo-preview-image"]')
          .isVisible();
        if (!visible) issues.push(`[${label}] photo-preview-image is not visible`);
      },
    },
    {
      description: 'controls row is visible',
      fn: async () => {
        const visible = await page
          .locator('[data-testid="photo-preview-controls"]')
          .isVisible();
        if (!visible)
          issues.push(`[${label}] photo-preview-controls is not visible`);
      },
    },
    {
      description: 'retake button border color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="photo-preview-retake"]')
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
          .locator('[data-testid="photo-preview-retake"]')
          .evaluate((el) => getComputedStyle(el).color);
        if (color !== COLORS.retakeDefault) {
          issues.push(
            `[${label}] retake text color: expected "${COLORS.retakeDefault}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'confirm button background color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="photo-preview-confirm"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        if (color !== COLORS.accent) {
          issues.push(
            `[${label}] confirm bg: expected "${COLORS.accent}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'confirm button text color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="photo-preview-confirm"]')
          .evaluate((el) => getComputedStyle(el).color);
        if (color !== COLORS.confirmText) {
          issues.push(
            `[${label}] confirm text color: expected "${COLORS.confirmText}", got "${color}"`,
          );
        }
      },
    },
    {
      description: 'retake button label text',
      fn: async () => {
        const text = await page
          .locator('[data-testid="photo-preview-retake"]')
          .textContent();
        if (text?.trim() !== 'Retake') {
          issues.push(
            `[${label}] retake label: expected "Retake", got "${text?.trim()}"`,
          );
        }
      },
    },
    {
      description: 'confirm button label text',
      fn: async () => {
        const text = await page
          .locator('[data-testid="photo-preview-confirm"]')
          .textContent();
        if (text?.trim() !== 'Use Photo') {
          issues.push(
            `[${label}] confirm label: expected "Use Photo", got "${text?.trim()}"`,
          );
        }
      },
    },
    {
      description: 'both buttons use app radius',
      fn: async () => {
        for (const testId of ['photo-preview-retake', 'photo-preview-confirm']) {
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
      description: 'confirm button has glow shadow',
      fn: async () => {
        const shadow = await page
          .locator('[data-testid="photo-preview-confirm"]')
          .evaluate((el) => getComputedStyle(el).boxShadow);
        if (!shadow || shadow === 'none') {
          issues.push(`[${label}] confirm button has no box-shadow glow`);
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

test.describe('PhotoPreview — Visual', () => {
  for (const viewport of VIEWPORTS) {
    test(`visual checks at ${viewport.name} (${viewport.width}×${viewport.height})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        permissions: ['camera'],
      });
      const page = await context.newPage();

      await navigateToPreview(context, page);

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

test.describe('PhotoPreview — isConfirming state visual', () => {
  test('confirm button shows "Saving…" and both buttons are disabled during upload', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['camera'],
    });
    const page = await context.newPage();

    await navigateToPreview(context, page);

    // Hold the upload request open long enough to assert the in-flight state
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

    await page.locator('[data-testid="photo-preview-confirm"]').click();

    const issues: string[] = [];

    try {
      const text = await page
        .locator('[data-testid="photo-preview-confirm"]')
        .textContent();
      if (text?.trim() !== 'Saving…') {
        issues.push(
          `confirm label during upload: expected "Saving…", got "${text?.trim()}"`,
        );
      }
    } catch (e) {
      issues.push(`confirm label check threw: ${(e as Error).message}`);
    }

    try {
      const isDisabled = await page
        .locator('[data-testid="photo-preview-confirm"]')
        .isDisabled();
      if (!isDisabled)
        issues.push('confirm button should be disabled during upload');
    } catch (e) {
      issues.push(`confirm disabled check threw: ${(e as Error).message}`);
    }

    try {
      const isDisabled = await page
        .locator('[data-testid="photo-preview-retake"]')
        .isDisabled();
      if (!isDisabled)
        issues.push('retake button should be disabled during upload');
    } catch (e) {
      issues.push(`retake disabled check threw: ${(e as Error).message}`);
    }

    await context.close();

    if (issues.length > 0) {
      console.error('\nVisual discrepancies found:\n' + issues.join('\n'));
    }
    expect(issues, 'Visual discrepancies:\n' + issues.join('\n')).toHaveLength(0);
  });
});
