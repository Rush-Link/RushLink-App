import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test.use({ hasTouch: true });
for (const width of [320, 390, 430]) {
  test(`phone dropdown and paged scrolling at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 740 });
    await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
    await page.goto("/"); await connectBrowserDemo(page);
    const pager = page.locator(".page-dashboard .phone-pager");
    const track = pager.locator(".phone-pager__track");
    await pager.getByRole("button", { name: "Show Device status", exact: true }).tap();
    await expect(pager.getByRole("button", { name: "Show Device status", exact: true })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => track.evaluate(element => Math.abs(element.scrollLeft - element.clientWidth))).toBeLessThan(2);
    // Native touch scrolling must update the same dots as tapping does.
    const bounds = (await track.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const y = bounds.y + Math.min(65, bounds.height / 2);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: width - 45, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: width - 45 - (width - 90) * step / 8, y }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(pager.getByRole("button", { name: "Show Shortcuts", exact: true })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => track.evaluate(element => Math.abs(element.scrollLeft - 2 * element.clientWidth))).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath("phone-paged-overview.png") });
    await pager.getByRole("button", { name: "Show Current rig", exact: true }).tap();
    const first = pager.locator(".phone-pager__page").first();
    await expect.poll(() => first.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    await first.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
    await expect.poll(() => first.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Open navigation", exact: true }).tap();
    const menu = page.locator(".sidebar");
    await expect(menu).toBeVisible();
    await expect.poll(async () => Math.round((await menu.boundingBox())!.x)).toBe(8);
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(52);
    await page.screenshot({ path: testInfo.outputPath("phone-dropdown.png") });
    await menu.getByRole("button", { name: "Rig Editor", exact: true }).tap();
    await expect(menu).toBeHidden();
    await page.getByRole("button", { name: "Show block controls", exact: true }).tap();
    await expect(page.locator(".chain-panel")).toBeHidden();
    await expect(page.locator("#rig-editor-controls")).toBeVisible();
    await page.locator("#rig-editor-controls").getByRole("button", { name: "Hide block controls", exact: true }).tap();
    await expect(page.locator(".chain-panel")).toBeVisible();
    await page.evaluate(async () => {
      // @ts-expect-error Vite-only test fixture; all external requests are blocked.
      const { useAppStore } = await import("/src/stores/app-store.ts");
      useAppStore.setState({ tones: Array.from({ length: 8 }, (_, index) => ({ id: `paging-${index}`, title: `Paging tone ${index}`, author: "QA", description: "Paging fixture", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 4, downloads: 10, source: "Tone3000", imageColor: "#62deea", metadata: { architecture: "A2" } })), toneLoading: false, refreshPage: async () => {} });
      useAppStore.getState().setPage("tone-cloud");
    });
    const tones = page.locator(".tone-grid .phone-pager");
    await expect(tones.locator(".phone-pager__page")).toHaveCount(8);
    await expect(tones.locator(".phone-pager__navigation button")).toHaveCount(5);
    await tones.getByRole("button", { name: "Show Tones 5", exact: true }).tap();
    await expect(tones.getByRole("button", { name: "Show Tones 5", exact: true })).toHaveAttribute("aria-current", "page");
    await tones.getByRole("button", { name: "Show Tones 7", exact: true }).tap();
    await expect(tones.getByRole("button", { name: "Show Tones 7", exact: true })).toHaveAttribute("aria-current", "page");
    await tones.getByRole("button", { name: "Show Tones 8", exact: true }).tap();
    await expect(tones.getByRole("button", { name: "Show Tones 8", exact: true })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => tones.locator(".phone-pager__track").evaluate(element => Math.abs(element.scrollLeft - 7 * element.clientWidth))).toBeLessThan(2);
    expect(await tones.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("phone-tone-pagination.png") });
  });
}
