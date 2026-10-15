import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

const brand = "RushLink by Cygma Audio";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 320, height: 568 }]) {
  test(`endorsed identity stays legible at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page).toHaveTitle(brand);
    const connectionBrand = page.locator(".device-connect-brand");
    await expect(connectionBrand).toHaveAccessibleName(brand);
    await expect(connectionBrand).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("cygma-connection.png") });
    await connectBrowserDemo(page);

    const visibleBrand = viewport.width <= 760 ? page.locator(".mobile-menu .rushlink-brand") : page.locator(".brand .rushlink-brand");
    await expect(visibleBrand).toBeVisible();
    await expect(visibleBrand).toHaveAccessibleName(brand);
    if (viewport.width > 1280) {
      await expect(visibleBrand.locator("img")).toHaveAttribute("src", "/rushlink-mark.svg");
      await page.screenshot({ path: testInfo.outputPath("cygma-expanded.png") });
      await page.getByRole("button", { name: "Collapse", exact: true }).click();
    } else if (viewport.width > 760) {
      await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
      await expect(visibleBrand.locator("img")).toHaveAttribute("src", "/rushlink-mark.svg");
      await page.screenshot({ path: testInfo.outputPath("cygma-expanded.png") });
      await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    }
    const endorsement = visibleBrand.locator(".rushlink-brand__name small");
    await expect(endorsement).toBeVisible();
    expect(await endorsement.innerText()).toMatch(/by\s+Cygma\s+Audio/);
    expect(await endorsement.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    const bounds = await visibleBrand.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("cygma-brand.png") });
  });
}

test("StageHand retains its product endorsement in full screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await connectBrowserDemo(page);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "StageHand", exact: true }).click();
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect(page.locator(".stagehand--fullscreen .stagehand-brand")).toBeVisible();
  await expect(page.locator(".stagehand-brand .rushlink-brand")).toHaveAccessibleName(brand);
  const logo = await page.locator(".stagehand-brand").boundingBox();
  const lock = await page.getByRole("button", { name: /^(Unl|L)ock layout$/ }).boundingBox();
  expect(logo!.x + logo!.width).toBeLessThanOrEqual(lock!.x);
  await page.screenshot({ path: testInfo.outputPath("cygma-stagehand.png") });
  await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
  await expect(page.locator(".mobile-menu .rushlink-brand")).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 320, height: 568 }]) {
  test(`light mode covers workspaces and persists at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".device-connect-brand img")).toHaveAttribute("src", "/rushlink-lockup-light.svg");
    await page.screenshot({ path: testInfo.outputPath("light-connection.png") });
    await connectBrowserDemo(page);
    for (const [label, ready] of [["Overview", ".page-dashboard"], ["Rig Editor", ".editor-page"], ["ToneMod", ".tone-page"], ["StageHand", ".stagehand-v2"], ["Settings", ".settings-page"]]) {
      if (viewport.width <= 760) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator(ready)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      if (label === "Rig Editor") {
        const contrast = await page.locator(".slot-index").first().evaluate(node => {
          const rgb = (color: string) => color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
          const luminance = (values: number[]) => values.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
          let ancestor: HTMLElement | null = node as HTMLElement;
          while (ancestor && getComputedStyle(ancestor).backgroundColor === "rgba(0, 0, 0, 0)") ancestor = ancestor.parentElement;
          const foreground = luminance(rgb(getComputedStyle(node).color));
          const background = luminance(rgb(ancestor ? getComputedStyle(ancestor).backgroundColor : "rgb(255, 255, 255)"));
          return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
      await page.screenshot({ path: testInfo.outputPath(`light-${label.toLowerCase().replaceAll(" ", "-")}.png`) });
      if (label === "ToneMod" && viewport.width === 1440) {
        await page.getByRole("tab", { name: "Test Rig Studio", exact: true }).click();
        await page.screenshot({ path: testInfo.outputPath("light-test-rig-studio.png") });
        await page.getByRole("button", { name: "Full editor", exact: true }).click();
        const editor = page.getByRole("dialog");
        await expect(editor).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("light-test-rig-dialog.png") });
        await editor.getByRole("button", { name: "Done", exact: true }).click();
      }
    }
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Color mode", exact: true })).toHaveValue("light");
    await page.screenshot({ path: testInfo.outputPath("light-settings-appearance.png") });
    await page.reload();
    await connectBrowserDemo(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    if (viewport.width <= 760) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("button", { name: "StageHand", exact: true }).click();
    await page.getByRole("button", { name: "Full screen", exact: true }).click();
    await expect(page.locator(".stagehand--fullscreen")).toBeVisible();
    await expect(page.locator(".stagehand-brand img")).toHaveAttribute("src", "/rushlink-mark-light.svg");
    await page.screenshot({ path: testInfo.outputPath("light-stagehand-fullscreen.png") });
  });
}

test("System mode follows OS changes while explicit modes stay selected", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const mode = page.getByRole("combobox", { name: "Color mode", exact: true });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await mode.selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await mode.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("combobox", { name: "Color mode", exact: true })).toHaveValue("light");
});
