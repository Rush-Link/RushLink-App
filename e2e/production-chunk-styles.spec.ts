import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test.use({ viewport: { width: 1440, height: 900 } });

test("optimized output loads Global EQ component styles without visiting Rig Editor", async ({ page }) => {
  await page.goto("/?page=tools");
  await connectBrowserDemo(page);

  const graph = page.locator(".global-eq-stage .graphic-eq");
  await expect(graph).toBeVisible();
  await expect(graph).toHaveCSS("isolation", "isolate");
  await expect(graph).toHaveCSS("overflow", "hidden");
  await expect(graph.locator(".eq-graph-status")).toHaveCSS("position", "absolute");

  const bands = page.locator(".eq-band-grid > section");
  await expect(bands).toHaveCount(4);
  await expect(bands.first()).toBeVisible();
  await expect(page.locator(".global-eq-controls")).toHaveCSS("display", "grid");

  await page.setViewportSize({ width: 500, height: 900 });
  await page.getByRole("navigation", { name: "Performance tool", exact: true }).getByRole("button", { name: "Global EQ", exact: true }).click();
  await expect(page.locator(".global-eq-head")).toHaveCSS("flex-direction", "column");
  const bandColumns = await page.locator(".eq-band-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(bandColumns).toBe(2);
  const eqFitsViewport = await page.locator(".global-eq-console").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth + 1);
  expect(eqFitsViewport).toBe(true);
});

test("optimized output loads the complete ToneMod IR browser styling", async ({ page }) => {
  await page.goto("/?page=tone-cloud");
  await connectBrowserDemo(page);
  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await page.getByRole("button", { name: /Full editor/i }).click();

  const editor = page.getByRole("dialog", { name: /Edit .*Clean/i });
  await editor.locator(".tp-editor-slot").filter({ hasText: "IR Loader" }).click();
  const control = editor.locator(".device-file-control");
  await expect(control).toHaveCSS("display", "grid");
  await expect(control).toHaveCSS("overflow", "hidden");

  await control.locator(".device-file-control__browse").click();
  const pickerDialog = page.getByRole("dialog", { name: "Choose IR file" });
  const browser = pickerDialog.locator(".device-asset-browser");
  await expect(browser).toHaveCSS("display", "grid");
  await expect(browser.locator(".device-asset-browser__toolbar")).toHaveCSS("display", "grid");
  await expect(browser.locator(".device-asset-browser__list")).toHaveCSS("display", "grid");

  await page.setViewportSize({ width: 600, height: 900 });
  const fileColumns = await browser.locator(".device-asset-browser__list").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(fileColumns).toBe(1);
  const dialogFitsViewport = await pickerDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
  });
  expect(dialogFitsViewport).toBe(true);
  await expect(browser.locator(".device-asset-browser__search .ui-input")).toBeVisible();
});

test("optimized output loads the Drummer preset dialog layout", async ({ page }) => {
  await page.goto("/?page=tools");
  await connectBrowserDemo(page);

  await page.getByRole("button", { name: /^Presets/i }).click();
  const dialog = page.getByRole("dialog", { name: "Drummer presets" });
  const browser = dialog.locator(".drum-preset-browser");
  const create = dialog.locator(".drum-preset-create");
  await expect(dialog).toBeVisible();
  await expect(browser).toHaveCSS("display", "grid");
  await expect(create).toHaveCSS("display", "flex");
  await expect(create).toHaveCSS("flex-direction", "column");
  await expect(create.locator(".drum-preset-create__form")).toHaveCSS("display", "grid");

  await page.setViewportSize({ width: 600, height: 900 });
  const browserColumns = await browser.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(browserColumns).toBe(1);
  const createButton = create.getByRole("button", { name: /Create preset/i });
  await expect(createButton).toBeVisible();
  const createButtonFillsRow = await createButton.evaluate((element) => {
    const form = element.closest<HTMLElement>(".drum-preset-create__form");
    return Boolean(form) && Math.abs(element.getBoundingClientRect().width - form.getBoundingClientRect().width) <= 1;
  });
  expect(createButtonFillsRow).toBe(true);
});
