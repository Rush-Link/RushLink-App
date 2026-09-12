import { describe, expect, it } from "vitest";
import {
  loadAssignmentsPage,
  loadDashboardPage,
  loadEditorPage,
  loadLibraryPage,
  loadPerformancePage,
  loadRigsPages,
  loadStageHandPage,
  loadSystemPages,
  loadToneModPage,
  preloadPage,
} from "./page-loaders";

describe("workspace code splitting", () => {
  it.each([
    ["dashboard", loadDashboardPage, "DashboardPage"],
    ["editor", loadEditorPage, "EditorPage"],
    ["rig library", loadRigsPages, "RigsPage"],
    ["StageHand", loadStageHandPage, "LivePlayPage"],
    ["ToneMod", loadToneModPage, "ToneLabPage"],
    ["performance tools", loadPerformancePage, "PerformanceToolsPage"],
    ["library", loadLibraryPage, "LibraryBackupPage"],
    ["system pages", loadSystemPages, "SettingsPage"],
    ["assignments", loadAssignmentsPage, "AssignmentsPage"],
  ] as const)("loads the %s chunk with its expected public page", async (_name, loader, exportName) => {
    const module = await loader();
    expect(module).toHaveProperty(exportName);
    expect(typeof module[exportName as keyof typeof module]).toBe("function");
  });

  it.each([
    ["dashboard", "DashboardPage"],
    ["editor", "EditorPage"],
    ["rigs", "RigsPage"],
    ["setlists", "SetlistsPage"],
    ["live", "LivePlayPage"],
    ["tone-cloud", "ToneLabPage"],
    ["tools", "PerformanceToolsPage"],
    ["library", "LibraryBackupPage"],
    ["settings", "SettingsPage"],
    ["diagnostics", "DiagnosticsPage"],
    ["assignments", "AssignmentsPage"],
    ["future-workspace", "DashboardPage"],
  ] as const)("preloads route %s from the correct chunk", async (route, exportName) => {
    const module = await preloadPage(route);
    expect(module).toHaveProperty(exportName);
    expect(typeof module[exportName as keyof typeof module]).toBe("function");
  });
});
