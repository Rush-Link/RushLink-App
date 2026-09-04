import { describe, expect, it, vi } from "vitest";

describe("release workspace defaults", () => {
  it("starts without device, catalogue, history or user-library data", async () => {
    localStorage.clear();
    vi.resetModules();
    const { useAppStore } = await import("./app-store");
    const state = useAppStore.getState();

    expect(state.device).toBeNull();
    expect(state.liveSubtree).toBeNull();
    expect(state.liveSnapshot).toBeNull();
    expect(state.rigs).toEqual([]);
    expect(state.setlists).toEqual([]);
    expect(state.tones).toEqual([]);
    expect(state.toneModels).toEqual({});
    expect(state.snapshots).toEqual([]);
    expect(state.favoriteRigIds).toEqual([]);
    expect(state.favoriteToneIds).toEqual([]);
    expect(state.favoriteBlockNames).toEqual([]);
    expect(state.savedWorkflows).toEqual([]);
    expect(state.rigHistory).toEqual({});
    expect(localStorage.getItem("rushlink-state-v1")).toBeNull();
  });

  it("never writes transient device state into the persisted workspace", async () => {
    localStorage.clear();
    vi.resetModules();
    const { flushAppPersistence, useAppStore } = await import("./app-store");
    useAppStore.setState({
      device: { id: "private-device", name: "Private pedal", model: "Prime Flex", host: "192.168.1.129", firmware: "private", productCode: "HG12", status: "ready", latencyMs: 1, capabilities: [] },
      liveSubtree: { "/private": { value: { RigName: "Private rig" } } },
      connectionError: "private diagnostic",
    });
    useAppStore.getState().setPreference("density", "compact");
    flushAppPersistence();

    const persisted = JSON.parse(localStorage.getItem("rushlink-state-v1") ?? "{}") as { state?: Record<string, unknown> };
    expect(persisted.state).not.toHaveProperty("device");
    expect(persisted.state).not.toHaveProperty("liveSubtree");
    expect(persisted.state).not.toHaveProperty("liveSnapshot");
    expect(persisted.state).not.toHaveProperty("connectionError");
    expect(JSON.stringify(persisted)).not.toMatch(/Private pedal|Private rig|private diagnostic|192\.168\.1\.129/i);
  });
});
