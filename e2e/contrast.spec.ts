import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";
import { expectReadableText } from "./support/text-contrast";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
});

for (const mode of ["dark", "light"] as const) {
  test(`${mode} enabled text, bypassed effects and portal menus stay readable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (mode === "light") await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("light");
    await connectBrowserDemo(page);
    await expectReadableText(page.locator(".live-metrics > .card span").first());
    await expectReadableText(page.locator(".overview-slot > span").first());
    await expectReadableText(page.locator(".overview-slot.bypassed strong").first());
    await expectReadableText(page.locator(".overview-slot.bypassed small").first());
    await page.getByRole("button", { name: "Rig Editor", exact: true }).click();
    await expectReadableText(page.locator(".block-node--empty > span").first());
    await expectReadableText(page.locator(".block-node:not(.block-node--empty) small").first());
    await expectReadableText(page.locator(".editor-workspace-tabs button.active").first());
    await page.locator(".block-node:not(.block-node--empty)").first().click({ button: "right" });
    const menu = page.getByRole("menu");
    await expectReadableText(menu.locator("header strong"));
    await expectReadableText(menu.locator("button:not(:disabled) strong").first());
    await expectReadableText(menu.locator("footer kbd").first());
    await menu.locator("button:not(:disabled)").first().hover();
    await expectReadableText(menu.locator("button:not(:disabled) strong").first());
    await page.screenshot({ path: testInfo.outputPath(`${mode}-context-menu.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expectReadableText(page.locator(".settings-nav button.active > span"));
    await expectReadableText(page.locator(".setting-row strong").first());
    await expectReadableText(page.locator(".setting-row > div > span").first());
    await page.screenshot({ path: testInfo.outputPath(`${mode}-settings-contrast.png`) });
    await page.getByRole("button", { name: "StageHand", exact: true }).click();
    const activeCaptions = page.locator(".live-pad.active > small");
    await expect(activeCaptions.first()).toBeVisible();
    for (const caption of await activeCaptions.all()) await expectReadableText(caption);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-stagehand-contrast.png`) });
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  });
}
