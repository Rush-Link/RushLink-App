import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test("StageHand owns its shared MIDI bridge styles on a cold start", async ({ page }) => {
  await page.goto("/?page=live");
  await connectBrowserDemo(page);

  await page.getByRole("button", { name: /Edit layout/i }).click();
  await page.locator(".live-pad").first().click();

  const bridge = page.locator(".stagehand-midi-bridge--shared");
  const action = bridge.locator(":scope > .ui-button");
  await expect(bridge).toBeVisible();
  await expect(bridge.locator(".stagehand-midi-help")).toHaveCSS("margin", "0px");
  await expect(action).toHaveCSS("justify-content", "center");

  const fillsContentWidth = await bridge.evaluate((element) => {
    const button = element.querySelector<HTMLElement>(":scope > .ui-button");
    if (!button) return false;
    const style = getComputedStyle(element);
    const contentWidth = element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    return Math.abs(button.getBoundingClientRect().width - contentWidth) <= 1;
  });
  expect(fillsContentWidth).toBe(true);
});
