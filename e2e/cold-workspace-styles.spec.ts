import { expect, test, type Page } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

type WorkspaceCase = {
  id: string;
  label: string;
  ready: string;
  checks: ReadonlyArray<readonly [selector: string, property: string, value: string, visible?: boolean]>;
};

const workspaces: WorkspaceCase[] = [
  { id: "dashboard", label: "Overview", ready: ".page-dashboard", checks: [
    [".overview-heading", "display", "flex"],
    [".overview-chain", "display", "grid"],
    [".live-metrics", "display", "grid"],
    [".overview-lower", "display", "grid"],
  ] },
  { id: "editor", label: "Rig Editor", ready: ".editor-page", checks: [
    [".editor-page", "display", "grid"],
    [".editor-workspace", "display", "grid"],
    [".interactive-signal-path--aligned .path-block-row", "display", "grid"],
    [".editor-workspace-tabs", "display", "grid"],
    [".history-list--clickable > .history-entry", "display", "grid"],
  ] },
  { id: "rigs", label: "Rigs", ready: ".device-library-page", checks: [
    [".library-summary-grid", "display", "grid"],
    [".library-control-bar", "display", "grid"],
    [".rig-library-grid", "display", "grid"],
    [".rig-library-card", "display", "grid"],
  ] },
  { id: "setlists", label: "Setlists", ready: ".setlist-library-page", checks: [
    [".setlist-studio", "display", "grid"],
    [".setlist-browser-panel", "display", "grid"],
    [".setlist-overview-grid", "display", "grid"],
    [".setlist-run-columns", "display", "grid"],
  ] },
  { id: "live", label: "StageHand", ready: ".stagehand-v2", checks: [
    [".stagehand-stage-bar", "display", "grid"],
    [".live-workspace", "display", "grid"],
    [".stagehand-grid", "display", "grid"],
    [".live-pad", "display", "flex"],
  ] },
  { id: "tone-cloud", label: "ToneMod", ready: ".tone-page", checks: [
    [".tone-provider-tabs", "display", "grid"],
    [".tone-layout", "display", "grid"],
    [".tone-search-row", "display", "flex"],
    [".audition-panel", "position", "sticky"],
  ] },
  { id: "assignments", label: "Assignments", ready: ".assignments-page", checks: [
    [".footswitch-board--smart", "display", "grid"],
    [".smart-footswitch", "display", "grid"],
    [".assignment-mode-switch", "display", "grid"],
  ] },
  { id: "tools", label: "Performance Tools", ready: ".performance-studio-page", checks: [
    [".performance-status-strip", "display", "flex"],
    [".drum-performance-surface", "display", "grid"],
    [".global-eq-head", "display", "flex"],
    [".global-eq-stage .graphic-eq", "isolation", "isolate"],
    [".eq-band-grid", "display", "grid"],
    [".performance-tuner-row", "margin-top", "13px"],
  ] },
  { id: "library", label: "Library & Backup", ready: ".backup-page", checks: [
    [".backup-hero", "display", "grid"],
    [".backup-workspace", "display", "grid"],
    [".restore-list", "display", "grid", false],
  ] },
  { id: "settings", label: "Settings", ready: ".settings-page", checks: [
    [".settings-layout", "display", "grid"],
    [".settings-content", "display", "flex"],
    [".settings-section__head", "display", "grid"],
  ] },
  { id: "diagnostics", label: "Diagnostics", ready: ".diagnostic-summary", checks: [
    [".diagnostic-summary", "display", "grid"],
    [".event-log__head", "display", "grid"],
  ] },
];

async function openColdWorkspace(page: Page, workspace: string) {
  await page.goto(`/?page=${workspace}`);
  await connectBrowserDemo(page);
}

test.use({ viewport: { width: 1440, height: 1000 } });

test.describe("cold workspace stylesheet ownership", () => {
  for (const workspace of workspaces) {
    test(`${workspace.label} owns the styles needed by its first render`, async ({ page }) => {
      await openColdWorkspace(page, workspace.id);
      await expect(page.locator(workspace.ready).first()).toBeVisible();

      for (const [selector, property, value, visible = true] of workspace.checks) {
        await test.step(`${selector} computes ${property}: ${value}`, async () => {
          const target = page.locator(selector).first();
          if (visible) await expect(target).toBeVisible();
          else expect(await target.count()).toBeGreaterThan(0);
          await expect(target).toHaveCSS(property, value);
        });
      }
    });
  }

  test("Setlists owns the shared empty-state presentation on a cold start", async ({ page }) => {
    await openColdWorkspace(page, "setlists");
    await expect(page.locator(".setlist-library-page")).toBeVisible();
    await page.getByRole("button", { name: "New setlist", exact: true }).click();
    await page.getByRole("button", { name: "Create setlist", exact: true }).click();

    const emptyState = page.locator(".empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toHaveCSS("display", "grid");
    await expect(emptyState).toHaveCSS("text-align", "center");
    await expect(emptyState.locator(".empty-state__icon")).toHaveCSS("display", "grid");
  });

  test("Settings owns both MIDI workspaces on a cold start", async ({ page }) => {
    await openColdWorkspace(page, "settings");
    await page.getByRole("button", { name: "MIDI", exact: true }).click();

    await expect(page.locator(".midi-settings-status")).toHaveCSS("display", "flex");
    await expect(page.locator(".midi-signal-flow")).toHaveCSS("display", "grid");

    await page.getByRole("tab", { name: "HeadRush hardware" }).click();
    await expect(page.locator(".midi-out-studio")).toBeVisible();
    await expect(page.locator(".midi-out-studio__head")).toHaveCSS("display", "grid");
    await expect(page.locator(".midi-preset-bar")).toHaveCSS("display", "flex");
    await expect(page.locator(".midi-lane-strip")).toHaveCSS("display", "grid");
  });
});
