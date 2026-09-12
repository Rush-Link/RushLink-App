import { expect, test } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test("dual-cab selections remain readable and editable on cold ToneMod at desktop and phone widths", async ({ page }, testInfo) => {
  await page.goto("/?page=tone-cloud");
  await connectBrowserDemo(page);
  await expect(page.getByRole("heading", { name: "ToneMod", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // @ts-expect-error Vite exposes source modules only in this dev-browser test.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const state = useAppStore.getState();
    const source = state.testRigs.find((rig: { id: string }) => rig.id === state.selectedTestRigId) ?? state.testRigs[0];
    const rig = structuredClone(source);
    rig.blocks = rig.blocks.filter((block: { slot: number }) => block.slot !== 8);
    rig.blocks.push({ id: "qa-cab", name: "ReValver Cab", model: "ReValver Cab", category: "cab", color: "#e6b86a", enabled: true, slot: 8, parameters: [
      { id: "CabType", label: "CabType", value: "Michael Bluesmaker 212 Open Back", choices: ["Angel 412 Slant", "Michael Bluesmaker 212 Open Back"] },
      { id: "CabType2", label: "CabType", value: "Angel 412 Slant", choices: ["Angel 412 Slant", "Michael Bluesmaker 212 Open Back"] },
      { id: "MicType", label: "MicType", value: "414B (Card)", choices: ["414B (Card)", "414B (Omni)"] },
      { id: "Doubling", label: "Doubling", value: "Single", choices: ["Single", "Double"] },
      { id: "Ambience", label: "Ambience", value: false },
      { id: "Gain", label: "Gain", value: 0, min: -10, max: 10 },
    ] });
    useAppStore.setState({ testRigs: [rig], selectedTestRigId: rig.id });
  });
  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await page.getByRole("button", { name: /Full editor/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".tp-editor-slot").filter({ hasText: "ReValver Cab" }).click();
  const cabinet = dialog.getByRole("combobox", { name: "Cabinet 1", exact: true });
  await expect(cabinet).toHaveValue("Michael Bluesmaker 212 Open Back");
  await cabinet.selectOption("Angel 412 Slant");
  await expect(cabinet).toHaveValue("Angel 412 Slant");
  await expect(dialog.getByRole("combobox", { name: "Cabinet 2", exact: true })).toHaveValue("Angel 412 Slant");
  const mic = dialog.getByRole("combobox", { name: "Microphone", exact: true });
  await mic.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(mic).toHaveValue("414B (Omni)");
  await dialog.getByRole("switch", { name: "Ambience", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Ambience", exact: true })).toBeChecked();

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await cabinet.scrollIntoViewIfNeeded();
    for (const field of await dialog.locator(".parameter-selection").all()) {
      await expect(field).toHaveCSS("display", "grid");
      await expect(field.locator("select")).toHaveCSS("min-height", "44px");
      expect(await field.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const label = element.querySelector("span")!.getBoundingClientRect();
        const select = element.querySelector("select")!.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1
          && label.bottom <= select.top && select.left >= box.left && select.right <= box.right
          && box.left >= 0 && box.right <= window.innerWidth;
      })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`cab-controls-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Full editor/i }).click();
  await page.getByRole("dialog").locator(".tp-editor-slot").filter({ hasText: "ReValver Cab" }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Cabinet 1", exact: true })).toHaveValue("Angel 412 Slant");
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Microphone", exact: true })).toHaveValue("414B (Omni)");
});
