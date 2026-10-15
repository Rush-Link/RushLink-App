import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";
import { expectReadableText } from "./support/text-contrast";

async function surface(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate(async element => {
    await Promise.allSettled(element.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished));
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return {
      alpha: context.getImageData(0, 0, 1, 1).data[3],
      image: style.backgroundImage,
      shadow: style.boxShadow,
      border: parseFloat(style.borderTopWidth),
      outline: parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
    };
  });
}

async function expectUnfilled(locator: Locator) {
  const actual = await surface(locator);
  expect(actual.alpha).toBe(0);
  expect(actual.image).toBe("none");
  expect(actual.shadow).toBe("none");
}

async function expectDefinedSurface(locator: Locator) {
  const actual = await surface(locator);
  expect(actual.alpha > 0 || actual.image !== "none").toBe(true);
  expect(actual.border).toBeGreaterThan(0);
}

async function openNavigation(page: Page, phone: boolean) {
  if (phone) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
}

async function navigate(page: Page, label: string, phone: boolean) {
  await openNavigation(page, phone);
  await page.locator(".sidebar__nav").getByRole("button", { name: label, exact: true }).click();
}

for (const width of [1440, 320]) {
  test(`light surfaces stay quiet and controls remain clear at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const phone = width === 320;
    await page.setViewportSize({ width, height: phone ? 720 : 1000 });
    await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
    await page.goto("/");
    await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("light");
    await connectBrowserDemo(page);

    await openNavigation(page, phone);
    const navigation = page.locator(".sidebar__nav");
    const editorLink = navigation.getByRole("button", { name: "Rig Editor", exact: true });
    await page.mouse.move(width - 2, 2);
    await expectUnfilled(editorLink);
    await expectReadableText(editorLink);
    if (!phone) {
      await expectUnfilled(page.locator(".nav-section").first());
      await expectUnfilled(page.locator(".device-session"));
    }
    await editorLink.hover();
    expect((await surface(editorLink)).alpha).toBeGreaterThan(0);
    await expectReadableText(editorLink);
    await page.mouse.move(width - 2, 2);
    await expectUnfilled(editorLink);
    await page.keyboard.press("Tab");
    await editorLink.focus();
    await expect(editorLink).toBeFocused();
    const focused = await surface(editorLink);
    expect(focused.outlineStyle).not.toBe("none");
    expect(focused.outline).toBeGreaterThan(0);
    await editorLink.click();
    if (!phone) {
      await page.mouse.move(width - 2, 2);
      expect((await surface(editorLink)).alpha).toBeGreaterThan(0);
    }
    await expectDefinedSurface(page.locator(".block-node:not(.block-node--empty)").first());
    await expectReadableText(page.locator(".rig-selector strong"));
    await expectReadableText(page.locator(".block-node:not(.block-node--empty) small").first());
    await page.screenshot({ path: testInfo.outputPath("light-surfaces-editor.png") });

    await navigate(page, "Rigs & Setlists", phone);
    const ghost = page.locator(".rig-edit-action").first();
    await ghost.scrollIntoViewIfNeeded();
    await page.mouse.move(width - 2, 2);
    await expectUnfilled(ghost);
    await expectReadableText(ghost.locator("span"));
    const favorite = page.locator(".rig-favorite").first();
    await favorite.scrollIntoViewIfNeeded();
    await expectUnfilled(favorite);
    const search = page.locator(".library-search");
    await search.scrollIntoViewIfNeeded();
    await expectDefinedSurface(search);
    await expectDefinedSurface(page.locator(".library-sort select"));
    await search.locator("input").fill("Neon");
    await expectReadableText(search.locator("input"));
    await page.screenshot({ path: testInfo.outputPath("light-surfaces-rigs.png") });

    await navigate(page, "Settings", phone);
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.mouse.move(width - 2, 2);
    await expectUnfilled(page.locator(".settings-nav button > svg:first-child").first());
    await expectUnfilled(page.locator(".settings-section__head").first());
    await expectDefinedSurface(page.getByRole("combobox", { name: "Color mode", exact: true }));
    await expectReadableText(page.locator(".setting-row strong").first());
    await page.screenshot({ path: testInfo.outputPath("light-surfaces-settings.png") });

    await navigate(page, "StageHand", phone);
    const pad = page.locator(".live-pad:not(.live-pad--empty)").first();
    await pad.scrollIntoViewIfNeeded();
    await expectDefinedSurface(pad);
    await expectReadableText(pad.locator("strong"));
    await page.screenshot({ path: testInfo.outputPath("light-surfaces-stagehand.png") });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
}
