import { expect, test, type Page } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";
import { tabletViewports } from "./support/tablet-viewports";

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
});

async function prepareEq(page: Page) {
  await page.evaluate(async () => {
    // @ts-expect-error Local Vite browser fixture; no device requests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Local Vite browser fixture; record writes without sending them.
    const { deviceApi } = await import("/src/services/device-api.ts");
    const records: Array<Record<string, unknown>> = [];
    Object.assign(window, { tabletEqWrites: records });
    deviceApi.setProperties = async (_path: string, properties: Record<string, unknown>) => {
      records.push(properties); return { status: 200, body: {} };
    };
    const numeric = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
    useAppStore.setState({ liveSubtree: { "/Evil/Engine/GlobalEQMain": {
      value: { On: true, MasterGain: 0, Freq1: 1000, Gain1: 0, Q1: 1 },
      meta: { properties: { On: { type: "boolean" }, MasterGain: numeric(-12, 12), Freq1: numeric(20, 20000), Gain1: numeric(-18, 18), Q1: numeric(1, 10) } },
    } }, refreshPage: async () => {} });
  });
}

for (const [short, long] of tabletViewports) {
  test(`tablet touch navigation, ordering and EQ ${short}x${long}`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: short, height: long });
    await page.goto("/"); await connectBrowserDemo(page);
    const nav = page.locator(".sidebar__nav");
    for (const label of ["Home", "Editor", "Rigs", "StageHand", "ToneMod", "Tools", "Library", "Settings", "Logs"]) {
      await expect(nav.locator("button > span").filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    await expect(nav.locator(".sidebar__support-label")).toHaveText("Support");
    await nav.getByRole("button", { name: "Rigs & Setlists", exact: true }).tap();
    await page.getByRole("button", { name: /^Setlists/ }).tap();
    const rows = page.locator(".setlist-run-row");
    await expect(rows.first()).toBeVisible();
    const names = await rows.locator(".setlist-run-row__rig strong").allTextContents();
    expect(names.length).toBeGreaterThan(1);
    await rows.first().getByRole("button", { name: /^Move .* down$/ }).tap();
    await expect(rows.nth(1).locator(".setlist-run-row__rig strong")).toHaveText(names[0]);
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
    await page.setViewportSize({ width: long, height: short });
    await rows.nth(1).getByRole("button", { name: /^Move .* up$/ }).tap();
    await expect(rows.first().locator(".setlist-run-row__rig strong")).toHaveText(names[0]);
    await page.setViewportSize({ width: short, height: long });
    await rows.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("tablet-setlist-order.png") });

    await nav.getByRole("button", { name: "Performance Tools", exact: true }).tap();
    await prepareEq(page);
    await page.getByRole("navigation", { name: "Performance tool", exact: true }).getByRole("button", { name: "Global EQ", exact: true }).tap();
    await page.getByRole("button", { name: "Expand navigation", exact: true }).tap();
    const chart = page.locator(".global-eq-stage");
    const svg = chart.locator("svg[aria-label='Interactive block equalizer']");
    const hit = chart.locator(".eq-band-hit");
    const session = await page.context().newCDPSession(page);
    for (const [width, height] of [[short, long], [long, short]]) {
      await page.setViewportSize({ width, height });
      await hit.scrollIntoViewIfNeeded();
      // Chromium includes the transparent 1px stroke in the hit-area bounds.
      await expect.poll(async () => (await hit.boundingBox())!.width).toBeGreaterThanOrEqual(48);
      expect((await hit.boundingBox())!.width).toBeLessThanOrEqual(50);
      expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      expect((await hit.boundingBox())!.height).toBeLessThanOrEqual(50);
      const dbLabel = chart.locator(".eq-db-label").first();
      expect((await dbLabel.boundingBox())!.width).toBeGreaterThan(18);
      const axisLabel = (await chart.locator(".eq-axis").getByText("1k", { exact: true }).boundingBox())!;
      const tick = await svg.locator("line.eq-grid-major").evaluateAll(lines => {
        const vertical = lines.filter(line => line.getAttribute("x1") === line.getAttribute("x2"));
        return vertical[2].getBoundingClientRect().x;
      });
      expect(Math.abs(axisLabel.x + axisLabel.width / 2 - tick)).toBeLessThan(1);
      await expect(svg).toHaveCSS("touch-action", "pan-y pinch-zoom");
      const bounds = (await svg.boundingBox())!;
      const handle = (await hit.boundingBox())!;
      const x = handle.x + handle.width / 2 + 10;
      const y = handle.y + handle.height / 2 + 6;
      const targetX = bounds.x + 46 + Math.log10(2000 / 20) / 3 * (bounds.width - 66) + 10;
      const targetY = bounds.y + 24 + (1 - 6 / 18) / 2 * (bounds.height - 54) + 6;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: targetX, y: targetY }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => page.evaluate(() => {
        const writes = (window as unknown as { tabletEqWrites: Array<Record<string, unknown>> }).tabletEqWrites;
        return Object.assign({}, ...writes);
      })).toMatchObject({ Freq1: 2000, Gain1: 6 });
      await page.evaluate(() => { (window as unknown as { tabletEqWrites: unknown[] }).tabletEqWrites.length = 0; });
    }
    await page.setViewportSize({ width: short, height: long });
    await chart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("tablet-eq-touch.png") });
  });
}
