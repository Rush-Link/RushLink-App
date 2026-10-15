import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";
import { tabletViewports } from "./support/tablet-viewports";

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
});

async function visit(page: Page, id: string) {
  await page.evaluate(async id => {
    // @ts-expect-error Vite test instrumentation.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    useAppStore.getState().setPage(id);
  }, id);
}

const rotationSessions = new WeakMap<Page, CDPSession>();
async function rotate(page: Page, width: number, height: number) {
  let session = rotationSessions.get(page);
  if (!session) { session = await page.context().newCDPSession(page); rotationSessions.set(page, session); }
  // Rotate the emulated display without resizing the host's fullscreen window.
  await session.send("Emulation.setDeviceMetricsOverride", {
    width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false,
    screenOrientation: { type: width > height ? "landscapePrimary" : "portraitPrimary", angle: width > height ? 90 : 0 },
  });
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  await expect(page.locator(".app")).toHaveClass(/app--tablet/);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".statusbar")).toBeHidden();
}

async function checkDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, overflow: element.scrollWidth - element.clientWidth }; });
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width); expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
  await expect(dialog.locator(".dialog__header").getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  for (const button of await dialog.locator(".dialog__footer button").all()) await expect(button).toBeInViewport();
}

async function prepareAudition(page: Page) {
  await page.evaluate(async () => {
    // @ts-expect-error Vite test instrumentation.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const tone = { id: "rotation-tone", title: "Rotation Amp", author: "QA", description: "Tablet rotation fixture", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 4, downloads: 10, source: "Tone3000", imageColor: "#62deea", remoteId: 77, remoteKind: "tone-group" };
    const model = { id: "rotation-model", remoteId: 9, name: "Rotation A2", architecture: "A2", url: "https://models.invalid/rotation.nam" };
    useAppStore.setState({ tones: [tone], selectedToneId: tone.id, toneModels: { [tone.id]: [model] }, selectedToneModelId: model.id,
      toneLoading: false, toneModelLoading: false, auditionBusy: false, auditioningToneId: tone.id,
      liveSubtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: true } } },
      testRigReturn: { id: useAppStore.getState().rigs[0].id, name: "Return rig", auditionSource: "Tone3000", testRigApplied: true,
        audition: { tone, model, captureFile: { path: "/Evil/Engine/Patch/Neural_Amp_Modeler", property: "LoadedClone", value: "Tone 3000 Demo/rotation.nam" } } },
      refreshPage: async () => {}, refreshFull: async () => {},
    });
  });
}

for (const [short, long] of tabletViewports) {
  test(`rotation preserves workspace state ${short}x${long}`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: short, height: long });
    await page.goto("/"); await connectBrowserDemo(page);
    await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toBeVisible();

    await visit(page, "editor");
    await page.getByRole("button", { name: "Show block controls", exact: true }).tap();
    await rotate(page, long, short);
    await expect(page.locator("#rig-editor-controls")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save rig", exact: true })).toBeInViewport();

    await visit(page, "live");
    await page.getByRole("button", { name: "Edit layout", exact: true }).tap();
    await page.locator('[data-live-index="0"]').tap();
    await page.getByLabel("Label", { exact: true }).fill("ROTATION");
    await rotate(page, short, long);
    await expect(page.getByLabel("Label", { exact: true })).toHaveValue("ROTATION");
    await expect(page.locator("#stagehand-controls")).toBeVisible();
    await page.getByRole("button", { name: "Lock layout", exact: true }).tap();
    await page.getByRole("button", { name: "Full screen", exact: true }).tap();
    await expect(page.locator(".stagehand-stage-bar")).toBeHidden();
    await expect(page.locator(".stagehand-rig-strip")).toBeHidden();
    await expect(page.getByRole("heading", { name: "StageHand", exact: true })).toBeHidden();
    await rotate(page, long, short);
    await expect(page.getByRole("button", { name: "Exit full screen", exact: true })).toBeInViewport();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeHidden();
    await expect(page.locator(".live-toolbar button:visible")).toHaveCount(2);
    const toolbar = (await page.locator(".live-toolbar").boundingBox())!;
    // Keep touch controls and the readable maker caption in a compact strip.
    expect(toolbar.height).toBeGreaterThanOrEqual(44);
    expect(toolbar.height).toBeLessThan(48);
    const board = (await page.locator(".live-board").boundingBox())!;
    expect(board.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);
    expect(board.y + board.height).toBeLessThanOrEqual(short + 1);
    expect(board.height).toBeGreaterThan(short - 60);
    const pad = page.locator(".live-pad:not(.live-pad--empty)").first();
    const padBox = (await pad.boundingBox())!;
    const numberBox = (await pad.locator(".live-pad__slot").boundingBox())!;
    expect(padBox.x + padBox.width - numberBox.x - numberBox.width).toBeLessThan(12);
    expect(numberBox.y - padBox.y).toBeLessThan(12);
    await page.getByRole("button", { name: "Unlock layout", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Lock layout", exact: true })).toBeVisible();
    await expect(page.locator(".live-inspector")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("stagehand-minimal-fullscreen.png") });
    await page.getByRole("button", { name: "Exit full screen", exact: true }).tap();

    await visit(page, "tone-cloud");
    await expect(page.getByRole("heading", { name: "ToneMod", exact: true })).toBeVisible();
    await prepareAudition(page);
    await page.getByRole("button", { name: "Show audition controls", exact: true }).tap();
    await page.getByRole("button", { name: "Save to device", exact: true }).tap();
    await page.getByLabel("Model name", { exact: true }).fill("Unsaved rotation model");
    await rotate(page, short, long); await checkDialog(page);
    await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("Unsaved rotation model");
    await rotate(page, long, 400); await checkDialog(page);
    await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("Unsaved rotation model");
    await rotate(page, short, 400); await checkDialog(page);
    await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("Unsaved rotation model");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).tap();
    await rotate(page, long, short);
    await page.getByRole("button", { name: "Save to rigs", exact: true }).tap();
    await page.getByLabel("Rig name", { exact: true }).fill("Unsaved rotation rig");
    await rotate(page, short, long); await checkDialog(page);
    await expect(page.getByLabel("Rig name", { exact: true })).toHaveValue("Unsaved rotation rig");
    await page.screenshot({ path: testInfo.outputPath("portrait-save-rig.png") });
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).tap();

    await page.getByRole("tab", { name: "Test Rig Studio", exact: true }).tap();
    await page.getByRole("button", { name: "Show reference run", exact: true }).tap();
    await rotate(page, long, short);
    await expect(page.locator("#test-rig-reference-run")).toBeVisible();
    await page.getByRole("button", { name: /Full editor/i }).tap();
    await rotate(page, short, long); await checkDialog(page);
    await page.getByRole("dialog").locator(".dialog__header").getByRole("button", { name: "Close", exact: true }).tap();

    await visit(page, "tools");
    await page.getByRole("navigation", { name: "Performance tool", exact: true }).getByRole("button", { name: "Global EQ", exact: true }).tap();
    await page.getByRole("tab", { name: "Amp output", exact: true }).tap();
    await rotate(page, long, short);
    await expect(page.getByRole("tab", { name: "Amp output", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".global-eq-console")).toBeVisible();
    await page.getByRole("button", { name: "Expand navigation", exact: true }).tap();
    await rotate(page, short, long);
    await expect(page.getByRole("button", { name: "Collapse navigation", exact: true })).toHaveAttribute("aria-expanded", "true");
    const chart = page.locator(".global-eq-stage");
    const axis = await chart.locator(".eq-axis").boundingBox();
    const status = await chart.locator(".eq-graph-status").boundingBox();
    expect(axis).not.toBeNull(); expect(status).not.toBeNull();
    expect(status!.y).toBeGreaterThanOrEqual(axis!.y + axis!.height);
    expect(await chart.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("portrait-expanded-navigation.png") });
  });
}

for (const width of [390, 599]) {
  test(`narrow phone navigation remains available at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/"); await connectBrowserDemo(page);
    await expect(page.locator(".app")).not.toHaveClass(/app--tablet/);
    await page.getByRole("button", { name: "Open navigation", exact: true }).tap();
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.getByRole("button", { name: "ToneMod", exact: true }).tap();
    await expect(page.getByRole("heading", { name: "ToneMod", exact: true })).toBeVisible();
  });
}

test.describe("mouse viewport boundaries", () => {
  test.use({ hasTouch: false });
  test("preserves phone, compact and desktop modes at their boundaries", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 1024 });
    await page.goto("/"); await connectBrowserDemo(page);
    await expect(page.locator(".app")).not.toHaveClass(/app--tablet/);
    await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
    await rotate(page, 761, 1024);
    await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toBeVisible();
    await rotate(page, 1280, 900);
    await page.setViewportSize({ width: 1281, height: 900 });
    await expect(page.locator(".app")).not.toHaveClass(/app--tablet/);
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".statusbar")).toBeVisible();
  });
});
