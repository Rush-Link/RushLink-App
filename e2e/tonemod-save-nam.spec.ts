import { expect, test, type Page } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

const destinationFolder = "Neural Amp Modeler/Tone 3000";

interface NamSaveProbe {
  downloads: Array<{ toneId: number; modelId: number; name: string }>;
  listings: Array<{ folder: string; kind: string }>;
  verified: boolean;
}

declare global {
  interface Window {
    __namSaveProbe: NamSaveProbe;
    __releaseNamVerification: () => void;
  }
}

async function prepareNamSave(page: Page) {
  await page.goto("/?page=tone-cloud");
  await connectBrowserDemo(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { deviceApi } = await import("/src/services/device-api.ts");
    const tone = { id: "nam-save-tone", title: "Studio Lead", author: "QA", description: "NAM save journey", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 4, downloads: 10, source: "Tone3000", imageColor: "#62deea", remoteId: 77, remoteKind: "tone-group" };
    const model = { id: "nam-save-model", remoteId: 9, name: "Studio Lead A2", architecture: "A2", url: "https://models.test/studio.nam" };
    const probe: NamSaveProbe = { downloads: [], listings: [], verified: false };
    window.__namSaveProbe = probe;
    const verification = new Promise<void>((resolve) => { window.__releaseNamVerification = resolve; });
    let savedFilename = "";
    deviceApi.isNative = () => true;
    deviceApi.listDeviceFiles = async (folder: string, kind: string) => {
      probe.listings.push({ folder, kind });
      if (!savedFilename) return [];
      // Keep verification pending so the journey proves success is not shown
      // merely because the downloader acknowledged the request.
      await verification;
      probe.verified = true;
      return [savedFilename];
    };
    deviceApi.downloadTone = async (selectedTone: { remoteId: number }, selectedModel: { remoteId: number }, name: string) => {
      probe.downloads.push({ toneId: selectedTone.remoteId, modelId: selectedModel.remoteId, name });
      savedFilename = name + ".nam";
    };
    useAppStore.setState({
      tones: [tone], selectedToneId: tone.id, toneModels: { [tone.id]: [model] }, selectedToneModelId: model.id,
      toneLoading: false, toneModelLoading: false, auditionBusy: false, auditioningToneId: null, testRigReturn: null,
      liveSubtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: true } } },
      toneUpdatedAtBySource: { tone3000: Date.now(), headRushCloud: Date.now() },
      // Retain the real App/shell lifecycle while stopping demo polling from
      // replacing the controlled provider fixture or recovering a disconnect.
      refreshPage: async () => undefined,
      refreshFull: async () => undefined,
    });
  });
  const showControls = page.getByRole("button", { name: "Show audition controls", exact: true });
  if (await showControls.isVisible()) await showControls.click();
}

for (const width of [1440, 390]) {
  test("saves NAM over Wi-Fi to the verified device location at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await prepareNamSave(page);
    await page.getByRole("button", { name: "Save to device", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Save NAM to device" });
    const name = dialog.getByRole("textbox", { name: "Model name", exact: true });
    await expect(name).toHaveValue("Studio Lead A2");
    await expect(dialog.getByLabel("Save location", { exact: true })).toHaveText(destinationFolder + "/Studio Lead A2.nam");
    await name.fill("  My Lead?.nam  ");
    await expect(dialog.getByLabel("Save location", { exact: true })).toHaveText(destinationFolder + "/My Lead.nam");
    await expect(dialog.getByText("Saved over Wi-Fi to the Tone 3000 folder on your HeadRush.")).toBeVisible();
    await expect(dialog.getByText(/does not offer a default volume setting/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Choose.*folder/i })).toHaveCount(0);

    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Save NAM", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => window.__namSaveProbe.downloads)).toEqual([]);
    expect(await page.evaluate(() => window.__namSaveProbe.listings)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("nam-save-wifi-" + width + ".png") });

    await dialog.getByRole("button", { name: "Save NAM", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Downloading and checking" })).toHaveText("Downloading and checking the NAM file on HeadRush…");
    await expect(dialog.getByRole("button", { name: "Save NAM", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.__namSaveProbe.downloads)).toEqual([{ toneId: 77, modelId: 9, name: "My Lead" }]);
    expect(await page.evaluate(() => window.__namSaveProbe.verified)).toBe(false);
    await expect(page.locator(".tp-save-nam-result")).toHaveCount(0);

    await page.evaluate(() => window.__releaseNamVerification());
    await expect(dialog).not.toBeVisible();
    const completion = page.locator(".tp-save-nam-result");
    await expect(completion).toHaveAttribute("role", "status");
    await expect(completion.getByText("Saved “My Lead” to the NAM library", { exact: true })).toBeVisible();
    await expect(completion.getByText(destinationFolder + "/My Lead.nam", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__namSaveProbe)).toEqual({
      downloads: [{ toneId: 77, modelId: 9, name: "My Lead" }],
      listings: [{ folder: destinationFolder, kind: "nam" }, { folder: destinationFolder, kind: "nam" }],
      verified: true,
    });
    expect(await page.evaluate(async () => {
      // @ts-expect-error Vite serves source modules to the development browser test.
      const { useAppStore } = await import("/src/stores/app-store.ts");
      return useAppStore.getState().tones.find((tone: { id: string }) => tone.id === "nam-save-tone").downloaded;
    })).toBe(true);
    await completion.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("nam-saved-wifi-" + width + ".png") });
  });
}

test("a disconnected HeadRush shows the normal connection gate and prevents NAM saves", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await prepareNamSave(page);
  await page.getByRole("button", { name: "Save to device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save NAM to device" });
  await expect(dialog.getByRole("button", { name: "Save NAM", exact: true })).toBeEnabled();

  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const device = useAppStore.getState().device;
    useAppStore.setState({ device: { ...device, status: "error" }, connectionError: "HeadRush disconnected from Wi-Fi" });
  });

  await expect(page.locator(".device-connect-gate")).toBeVisible();
  await expect(page.locator(".app-workspace")).toHaveAttribute("inert", "");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await expect(dialog.getByRole("button", { name: "Save NAM", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__namSaveProbe.downloads)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "Connect to your device" })).toBeVisible();
  await expect(page.getByText("HeadRush disconnected from Wi-Fi", { exact: true })).toBeVisible();
  await expect(page.locator(".tp-save-nam-result")).toHaveCount(0);
  expect(await page.evaluate(() => window.__namSaveProbe.listings)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("nam-wifi-disconnected-390.png") });
});
