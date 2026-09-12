import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { tabletViewports } from "./support/tablet-viewports";

const siteRoot = process.env.TABLET_SITE_ROOT || resolve("site");
test.use({ hasTouch: true, reducedMotion: "reduce" });

for (const [short, long] of tabletViewports) {
  test(`website fits and rotates ${short}x${long}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.route("**/*", route => route.request().url().startsWith("file:") ? route.continue() : route.abort());
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const name of ["index.html", "about.html", "privacy.html"]) {
      await page.setViewportSize({ width: short, height: long });
      await page.goto(pathToFileURL(resolve(siteRoot, name)).href);
      for (const [width, height] of [[short, long], [long, short]]) {
        await page.setViewportSize({ width, height });
        await expect(page.locator("h1")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${name} at ${width}x${height}`).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: short, height: long });
      const menu = page.locator("[data-menu-button]");
      if (await menu.isVisible()) {
        await menu.tap();
        await expect(page.locator("body")).toHaveClass(/menu-open/);
        await page.setViewportSize({ width: long, height: short });
        await expect(page.locator("body")).not.toHaveClass(/menu-open/);
        await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
      }
    }
    expect(errors).toEqual([]);
  });
}
