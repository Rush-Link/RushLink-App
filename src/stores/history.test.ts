import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRigs } from "../data/demo-data";
import { flushAppPersistence, useAppStore } from "./app-store";

describe("automatic rig history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useAppStore.setState((state) => ({
      rigs: structuredClone(demoRigs),
      selectedRigId: demoRigs[0].id,
      selectedBlockId: "b-input",
      liveSnapshot: null,
      rigHistory: {},
      historyPreview: null,
      preferences: { ...state.preferences, keepHistory: undefined as unknown as boolean, writeMode: "staged" },
    }));
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("records a completed parameter gesture when an older persisted profile has no keepHistory key", () => {
    useAppStore.getState().updateParameter("b-input", "mix", 57);
    vi.advanceTimersByTime(600);

    const entries = useAppStore.getState().rigHistory[demoRigs[0].id];
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toContain("changed");
    expect(entries[0].before.blocks[0].parameters[0].value).toBe(42);
    expect(entries[0].after.blocks[0].parameters[0].value).toBe(57);
  });

  it("coalesces a continuous parameter gesture into one restorable entry", () => {
    useAppStore.getState().updateParameter("b-input", "mix", 48);
    vi.advanceTimersByTime(300);
    useAppStore.getState().updateParameter("b-input", "mix", 63);
    vi.advanceTimersByTime(600);

    const entries = useAppStore.getState().rigHistory[demoRigs[0].id];
    expect(entries).toHaveLength(1);
    expect(entries[0].before.blocks[0].parameters[0].value).toBe(42);
    expect(entries[0].after.blocks[0].parameters[0].value).toBe(63);
  });

  it("persists ordinary timeline entries without requiring a star", () => {
    useAppStore.getState().updateParameter("b-input", "mix", 71);
    vi.advanceTimersByTime(600);
    flushAppPersistence();

    const persisted = JSON.parse(localStorage.getItem("rushlink-state-v1") ?? "{}") as { state?: { rigHistory?: Record<string, Array<{ saved: boolean }>> } };
    const entries = persisted.state?.rigHistory?.[demoRigs[0].id] ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].saved).toBe(false);
  });

  it("restores a pre-edit state without recording timeline navigation as a new edit", async () => {
    useAppStore.getState().updateParameter("b-input", "mix", 71);
    vi.advanceTimersByTime(600);

    const entry = useAppStore.getState().rigHistory[demoRigs[0].id][0];
    const originalRestore = useAppStore.getState().restoreRigSnapshot;
    const applySnapshot = vi.fn(async () => undefined);
    useAppStore.setState({ restoreRigSnapshot: applySnapshot });

    try {
      await useAppStore.getState().restoreHistory(entry.id, "before");

      expect(applySnapshot).toHaveBeenCalledWith(
        entry.before,
        expect.stringContaining("Previewed before"),
        false,
      );
      expect(useAppStore.getState().rigHistory[demoRigs[0].id]).toHaveLength(1);
    } finally {
      useAppStore.setState({ restoreRigSnapshot: originalRestore });
    }
  });

  it("keeps the original live state while several history states are previewed", async () => {
    useAppStore.getState().updateParameter("b-input", "mix", 71);
    vi.advanceTimersByTime(600);
    const entry = useAppStore.getState().rigHistory[demoRigs[0].id][0];
    const originalRestore = useAppStore.getState().restoreRigSnapshot;
    const applySnapshot = vi.fn(async () => undefined);
    useAppStore.setState({ restoreRigSnapshot: applySnapshot });

    try {
      await useAppStore.getState().restoreHistory(entry.id, "before");
      await useAppStore.getState().restoreHistory(entry.id, "after");

      const preview = useAppStore.getState().historyPreview;
      expect(preview?.returnState.blocks[0].parameters[0].value).toBe(71);
      expect(preview?.previewState.blocks[0].parameters[0].value).toBe(71);
      expect(preview?.side).toBe("after");
    } finally {
      useAppStore.setState({ restoreRigSnapshot: originalRestore });
    }
  });

  it("returns from a history preview to the captured live state", async () => {
    useAppStore.getState().updateParameter("b-input", "mix", 71);
    vi.advanceTimersByTime(600);
    const entry = useAppStore.getState().rigHistory[demoRigs[0].id][0];
    const originalRestore = useAppStore.getState().restoreRigSnapshot;
    const applySnapshot = vi.fn(async () => undefined);
    useAppStore.setState({ restoreRigSnapshot: applySnapshot });

    try {
      await useAppStore.getState().restoreHistory(entry.id, "before");
      const returnState = useAppStore.getState().historyPreview!.returnState;
      await useAppStore.getState().returnFromHistory();

      expect(applySnapshot).toHaveBeenLastCalledWith(returnState, expect.stringContaining("Returned to the device state"), false);
      expect(useAppStore.getState().historyPreview).toBeNull();
    } finally {
      useAppStore.setState({ restoreRigSnapshot: originalRestore });
    }
  });
});
