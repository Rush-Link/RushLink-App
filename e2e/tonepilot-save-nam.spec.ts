import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test("NAM save stays usable through USB Wi-Fi loss and retains eject/Sync guidance", async ({ page }, testInfo) => {
  await page.goto("/?page=tone-cloud");
  await connectBrowserDemo(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { deviceApi } = await import("/src/services/device-api.ts");
    const tone = { id: "nam-save-tone", title: "Studio Lead", author: "QA", description: "NAM save journey", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 4, downloads: 10, source: "Tone3000", imageColor: "#62deea", remoteId: 77, remoteKind: "tone-group" };
    const model = { id: "nam-save-model", remoteId: 9, name: "Studio Lead A2", architecture: "A2", url: "https://models.test/studio.nam" };
    let savedFilename = "";
    deviceApi.isNative = () => true;
    deviceApi.listDeviceFiles = async (folder: string, kind: string) => kind === "folders" ? (folder === "Neural Amp Modeler/User" ? ["Lead"] : []) : folder === "Neural Amp Modeler/Tone 3000" && savedFilename ? [savedFilename] : [];
    deviceApi.downloadTone = async (_tone: unknown, _model: unknown, name: string) => { savedFilename = `${name}.nam`; };
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
      invoke: async (command: string, args: { destinationPath: string }) => {
        if (command === "plugin:dialog|open") return "E:/Neural Amp Modeler";
        if (command === "transfer_nam_file") return { name: "My Lead", path: args.destinationPath };
        throw new Error(`Unexpected native command: ${command}`);
      },
    } });
    useAppStore.setState({
      tones: [tone], selectedToneId: tone.id, toneModels: { [tone.id]: [model] }, selectedToneModelId: model.id,
      toneLoading: false, toneModelLoading: false, auditionBusy: false, auditioningToneId: null, testRigReturn: null,
      liveSubtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: true } } },
      toneUpdatedAtBySource: { tone3000: Date.now(), headRushCloud: Date.now() },
    });
  });

  await page.getByRole("button", { name: "Save to device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save NAM to device" });
  const name = dialog.getByRole("textbox", { name: "Model name", exact: true });
  await expect(name).toHaveValue("Studio Lead A2");
  await name.fill("My Lead.nam");
  await expect(dialog.getByLabel("Save location", { exact: true })).toHaveText("Neural Amp Modeler/User/My Lead.nam");
  await dialog.getByRole("button", { name: "Choose folder", exact: true }).click();
  await dialog.getByRole("button", { name: "Open NAM folder Lead", exact: true }).click();
  await dialog.getByRole("button", { name: "Use this folder", exact: true }).click();
  await expect(dialog.getByLabel("Save location", { exact: true })).toHaveText("Neural Amp Modeler/User/Lead/My Lead.nam");
  await expect(dialog.getByText(/does not offer a default volume setting/)).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Save NAM", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`nam-save-${width}.png`) });
  }

  await dialog.getByRole("button", { name: "Save NAM", exact: true }).click();
  const transfer = dialog.getByRole("button", { name: "Choose HeadRush NAM folder", exact: true });
  await expect(transfer).toBeInViewport();
  await expect(dialog.getByRole("region", { name: "Finish NAM save with USB Transfer" })).toBeVisible();
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Vite serves source modules to the development browser test.
    const { deviceApi } = await import("/src/services/device-api.ts");
    // USB Transfer removes the Wi-Fi API; prevent browser demo polling from
    // immediately changing the simulated disconnected device back to ready.
    deviceApi.properties = async () => { throw new Error("Wi-Fi is unavailable during USB Transfer"); };
    deviceApi.subtree = async () => { throw new Error("Wi-Fi is unavailable during USB Transfer"); };
    const device = useAppStore.getState().device;
    useAppStore.setState({ device: { ...device, status: "error" }, connectionError: "Wi-Fi is unavailable during USB Transfer" });
  });
  const connectionGate = page.locator(".device-connect-gate");
  await expect(connectionGate).toBeAttached();
  await expect(connectionGate).toBeHidden();
  await expect(page.locator(".app-workspace")).toHaveAttribute("inert", "");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  expect(await dialog.evaluate((element) => element.closest("[inert]") === null)).toBe(true);
  await expect(transfer).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("nam-usb-transfer-390.png") });
  await transfer.click();
  await expect(dialog).not.toBeVisible();
  const completion = page.getByRole("dialog", { name: "NAM copied to HeadRush" });
  await expect(completion).toBeVisible();
  await expect(completion.getByLabel("Copied NAM location")).toHaveText("Neural Amp Modeler/User/Lead/My Lead.nam");
  await expect(completion.getByText("Safely eject the HeadRush drive from this computer.")).toBeVisible();
  await expect(completion.getByText("Tap Sync on HeadRush and wait for the import to finish.")).toBeVisible();
  await expect(connectionGate).toBeHidden();
  await expect(page.locator(".app-workspace")).toHaveAttribute("inert", "");
  await expect(completion.getByRole("button", { name: "Done" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("nam-usb-complete-offline-390.png") });
  await completion.getByRole("button", { name: "Done" }).click();
  await expect(completion).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "Connect to your device" })).toBeVisible();
  await expect(page.locator(".app-workspace")).toHaveAttribute("inert", "");
});
