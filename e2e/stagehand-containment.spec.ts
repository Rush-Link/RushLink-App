import { expect, test } from '@playwright/test';
import { connectBrowserDemo } from './support/connect-browser-demo';

test.use({ hasTouch: true });
for (const [width, height] of [[320, 568], [568, 320], [393, 851], [851, 393], [600, 960], [960, 600], [800, 1280], [1280, 800]]) {
  test(`StageHand board stays contained at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await connectBrowserDemo(page);
    await page.evaluate(async () => {
      // @ts-expect-error Vite test instrumentation.
      const { useAppStore } = await import('/src/stores/app-store.ts');
      useAppStore.getState().setPage('live');
      useAppStore.getState().setLiveDimensions(4, 8, 8);
    });
    const board = page.locator('.live-board.stagehand-grid');
    async function check(fullscreen: boolean) {
      await expect(board).toBeVisible();
      const bounds = await board.evaluate(element => {
        const r = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom, parentRight: parent.right, width: innerWidth, height: innerHeight };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(Math.min(bounds.width, bounds.parentRight) + 1);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
      // The final control must remain reachable inside the board, not be clipped
      // by the page or reduced below a usable touch target in fullscreen.
      const lastPad = board.locator('.live-pad').last();
      await lastPad.scrollIntoViewIfNeeded();
      const pad = (await lastPad.boundingBox())!;
      const frame = (await board.boundingBox())!;
      expect(pad.x).toBeGreaterThanOrEqual(frame.x - 1);
      expect(pad.x + pad.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
      expect(pad.width).toBeGreaterThanOrEqual(44);
      if (fullscreen) expect(pad.y + pad.height).toBeLessThanOrEqual(bounds.height + 1);
    }
    await check(false);
    await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await check(false);
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await check(true);
    await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeInViewport();
  });
}
