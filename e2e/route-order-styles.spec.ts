import { expect, test, type Locator } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

const typography = (locator: Locator) => locator.evaluate((element) => {
  const style = getComputedStyle(element);
  return {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textTransform: style.textTransform,
  };
});

test.use({ viewport: { width: 1440, height: 1000 } });

test("visiting Rig Editor does not change Dashboard typography", async ({ page }) => {
  await page.goto("/?page=dashboard");
  await connectBrowserDemo(page);

  const slotLabel = page.locator(".overview-slot strong").first();
  const dashboardEyebrow = page.locator(".overview-heading .eyebrow");
  await expect(slotLabel).toBeVisible();
  await expect(dashboardEyebrow).toBeVisible();
  const beforeEditor = {
    slotLabel: await typography(slotLabel),
    eyebrow: await typography(dashboardEyebrow),
  };

  await page.getByRole("button", { name: /^Rig Editor/ }).click();
  await expect(page.locator(".editor-page")).toBeVisible();
  await page.getByRole("button", { name: /^Overview/ }).click();
  await expect(page.locator(".page-dashboard")).toBeVisible();

  const afterEditor = {
    slotLabel: await typography(page.locator(".overview-slot strong").first()),
    eyebrow: await typography(page.locator(".overview-heading .eyebrow")),
  };
  expect(afterEditor).toEqual(beforeEditor);
});
