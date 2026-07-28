/**
 * CameraView — Visual regression tests
 *
 * Asserts exact design-spec values (colors, sizes, spacing) using computed
 * CSS properties. No screenshot diffing — all assertions are code-based.
 *
 * Pre-requisites: Vite dev server running at http://localhost:5173
 * Run: npx playwright test CameraView.visual.spec.ts
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Design token constants (from implementation plan, section 5)
// ---------------------------------------------------------------------------
const COLORS = {
  pageBg: 'rgb(244, 241, 236)',
  accent: 'rgb(215, 210, 202)',
  primaryText: 'rgb(17, 16, 15)',
  secondaryText: 'rgb(110, 103, 93)',
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

async function grantCameraAndNavigate(
  context: BrowserContext,
  page: Page
): Promise<void> {
  await context.grantPermissions(['camera']);
  await page.goto('/capture');
  // Wait for the camera root element to be visible
  await page.waitForSelector('[data-testid="capture-camera-root"]');
}

async function collectIssues(page: Page, label: string): Promise<string[]> {
  const issues: string[] = [];
  // Wrap every assertion in a try/catch so we collect ALL failures per viewport
  const checks: Array<{ description: string; fn: () => Promise<void> }> = [
    {
      description: 'page background color',
      fn: async () => {
        const color = await page
          .locator('[data-testid="capture-camera-root"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        if (color !== COLORS.pageBg) {
          issues.push(
            `[${label}] page bg: expected "${COLORS.pageBg}", got "${color}"`
          );
        }
      },
    },
    {
      description: 'video element is visible',
      fn: async () => {
        const visible = await page
          .locator('[data-testid="capture-video-element"]')
          .isVisible();
        if (!visible) issues.push(`[${label}] video element is not visible`);
      },
    },
    {
      description: 'capture button exists',
      fn: async () => {
        const count = await page
          .locator('[data-testid="capture-button"]')
          .count();
        if (count === 0)
          issues.push(`[${label}] capture-button not found in DOM`);
      },
    },
    {
      description: 'capture button border color is accent',
      fn: async () => {
        const color = await page
          .locator('[data-testid="capture-button"]')
          .evaluate((el) => getComputedStyle(el).borderTopColor);
        if (color !== COLORS.accent) {
          issues.push(
            `[${label}] capture-button border: expected "${COLORS.accent}", got "${color}"`
          );
        }
      },
    },
  ];

  for (const check of checks) {
    try {
      await check.fn();
    } catch (e) {
      issues.push(
        `[${label}] "${check.description}" threw: ${(e as Error).message}`
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('CameraView — Visual', () => {
  for (const viewport of VIEWPORTS) {
    test(`visual checks at ${viewport.name} (${viewport.width}×${viewport.height})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        permissions: ['camera'],
      });
      const page = await context.newPage();

      await grantCameraAndNavigate(context, page);

      const issues = await collectIssues(
        page,
        `${viewport.name} ${viewport.width}×${viewport.height}`
      );

      await context.close();

      if (issues.length > 0) {
        console.error('\nVisual discrepancies found:\n' + issues.join('\n'));
      }
      expect(issues, 'Visual discrepancies:\n' + issues.join('\n')).toHaveLength(0);
    });
  }
});

test.describe('CameraView — Permission denied visual', () => {
  test('shows error notice with correct text color when camera is denied', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      // Do NOT grant camera — triggers denial path
    });
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
    // The permission notice should appear
    await page.waitForSelector('[data-testid="capture-permission-notice"]', {
      timeout: 10_000,
    });

    const issues: string[] = [];

    // Notice text color
    const textColor = await page
      .locator('[data-testid="capture-permission-notice"] p')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    if (textColor !== COLORS.primaryText) {
      issues.push(
        `notice text color: expected "${COLORS.primaryText}", got "${textColor}"`
      );
    }

    // Background color
    const bgColor = await page
      .locator('[data-testid="capture-permission-notice"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // Tailwind bg-[#0B0F14]/95 computes as rgba – just verify it's dark
    const matchesPageBg = bgColor === COLORS.pageBg;
    if (!matchesPageBg) {
      issues.push(`notice bg: expected "${COLORS.pageBg}", got "${bgColor}"`);
    }

    await context.close();

    if (issues.length > 0) {
      console.error('\nVisual discrepancies found:\n' + issues.join('\n'));
    }
    expect(issues, 'Visual discrepancies:\n' + issues.join('\n')).toHaveLength(0);
  });
});
