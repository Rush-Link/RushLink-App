import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test("multiple NAM settings and file lanes work across desktop, tablet and phone", async ({ page }, testInfo) => {
  await page.goto("/?page=tone-cloud");
  await connectBrowserDemo(page);
  await page.evaluate(async () => {
    // @ts-expect-error The development-browser fixture uses the Vite source module.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const state = useAppStore.getState();
    const nam = {
      value: { LoadedClone: "Neural Amp Modeler/Other.nam", LoadedClone2: "Neural Amp Modeler/Second.nam", Doubling: true, LightMode: true, Output: 0.5, order: ["LoadedClone", "LoadedClone2", "Doubling", "LightMode", "Output"], labels: ["NAM file", "Second NAM file", "Doubling", "Lite Mode", "Output"] },
      meta: { properties: {
        LoadedClone: { type: "string", "x-options": { fileType: 10, startPath: "Neural Amp Modeler" } },
        LoadedClone2: { type: "string", "x-options": { fileType: 10, startPath: "Neural Amp Modeler" } },
        Doubling: { type: "boolean" }, LightMode: { type: "boolean" }, Output: { type: "number", minimum: -40, maximum: 40 },
      } },
    };
    useAppStore.setState({
      liveSubtree: { ...(state.liveSubtree ?? {}),
        "/Evil/API/Blocks": { value: { ModuleTypes: ["Empty Slot", "Neural Amp Modeler", "Neural Amp Modeler 2"] } },
        "/Evil/Engine/Patch/Neural_Amp_Modeler": nam,
        "/Evil/Engine/Patch/Neural_Amp_Modeler_2": structuredClone(nam),
      },
    });
  });

  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await page.getByRole("combobox", { name: "Preferred NAM model" }).selectOption("nam2-lite");
  await page.getByRole("combobox", { name: "NAM DSP host" }).selectOption("2");
  await page.getByRole("combobox", { name: "Audition chain slot" }).selectOption("2");
  await expect(page.getByText("Capture marker in plan slot 3")).toBeVisible();
  await page.getByRole("button", { name: /Full editor/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Preferred NAM model" })).toHaveValue("nam2-lite");
  await expect(dialog.getByRole("combobox", { name: "NAM DSP host" })).toHaveValue("2");
  await dialog.locator('[data-chain-slot="6"]').click();
  await dialog.getByPlaceholder(/Search blocks/i).fill("Neural Amp Modeler");
  const catalogue = dialog.locator(".tp-editor-results");
  await expect(catalogue.getByRole("button", { name: /NAM host 2.*Neural Amp Modeler 2/i })).toBeDisabled();
  await catalogue.getByRole("button", { name: /NAM host 1.*Neural Amp Modeler$/i }).click();
  await expect(dialog.getByRole("button", { name: /Change NAM file, currently Other.nam/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Change Second NAM file, currently Second.nam/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Remove Neural Amp Modeler$/i })).toBeEnabled();

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await dialog.locator(".tp-nam-settings").scrollIntoViewIfNeeded();
    for (const field of await dialog.locator(".tp-nam-settings__fields label").all()) {
      expect(await field.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const control = element.querySelector("select,input")!.getBoundingClientRect();
        return control.left >= box.left && control.right <= box.right + 1
          && box.left >= 0 && box.right <= window.innerWidth + 1
          && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`multiple-nam-${width}.png`) });
  }

  await dialog.getByRole("button", { name: /Done/i }).click();
  await page.reload();
  await connectBrowserDemo(page);
  await expect(page.getByRole("heading", { name: "ToneMod", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await expect(page.getByRole("combobox", { name: "Preferred NAM model" })).toHaveValue("nam2-lite");
  await expect(page.getByRole("combobox", { name: "NAM DSP host" })).toHaveValue("2");
  await expect(page.getByRole("combobox", { name: "Audition chain slot" })).toHaveValue("2");
  await expect(page.locator('.tp-config-block[data-chain-slot="6"]')).toContainText("Neural Amp Modeler");
});
