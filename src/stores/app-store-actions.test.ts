import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRushLinkArchive } from "../domain/backup";
import { demoCapabilities, demoDevice, demoRigs, demoSetlists, testRigTemplates } from "../data/demo-data";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "./app-store";
import type { RigBlock } from "../domain/types";
import type { SavedWorkflow } from "../domain/rushlink-sync";

const originalActions = Object.fromEntries(Object.entries(useAppStore.getState()).filter(([, value]) => typeof value === "function"));

function resetStore() {
  localStorage.clear();
  useAppStore.setState((state) => ({
    ...originalActions,
    page: "dashboard", sidebarCollapsed: false, device: null, capabilities: null, connectionBusy: false, connectionError: null,
    liveSubtree: null, liveSnapshot: null, syncBusy: false, performanceTunerActive: false,
    rigs: structuredClone(demoRigs), selectedRigId: demoRigs[0].id, selectedBlockId: null,
    setlists: structuredClone(demoSetlists), selectedSetlistId: demoSetlists[0].id,
    pendingWrites: [], undoStack: [], diagnostics: [], snapshots: [],
    favoriteToneIds: [], favoriteBlockNames: [], savedWorkflows: [], selectedToneModelId: null, captureOverride: "auto", auditionError: null,
    testRigs: structuredClone(testRigTemplates), selectedTestRigId: testRigTemplates[0].id,
    preferences: { ...state.preferences, writeMode: "staged", firstWriteResolved: true, autoBackup: false },
  }));
}

describe("application store action matrix", () => {
  beforeEach(() => { resetStore(); vi.restoreAllMocks(); });

  it.each(["headrushflexprime.local", "headrushprime.local", "headrushcore.local"])("uses %s for implicit reconnect while keeping IP fallback explicit", async (modelAddress) => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    const connect = vi.spyOn(deviceApi, "connect").mockRejectedValue(new Error("hostname unavailable"));
    useAppStore.setState(state => ({ preferences: { ...state.preferences, address: "192.168.1.129", modelAddress, fallbackAddress: undefined } }));
    await useAppStore.getState().connect();
    expect(connect.mock.calls).toEqual([[modelAddress]]);
    connect.mockResolvedValue({ device: demoDevice, capabilities: demoCapabilities });
    await useAppStore.getState().connect("192.168.1.129");
    expect(connect).toHaveBeenLastCalledWith("192.168.1.129");
    expect(useAppStore.getState().preferences.fallbackAddress).toBe("192.168.1.129");
  });

  it("updates shell, preference and focused-control state", () => {
    const store = useAppStore.getState();
    store.setPage("live"); store.toggleSidebar(); store.setPreference("density", "stage");
    store.setPerformanceTunerActive(true); store.selectBlock("slot-2");
    expect(useAppStore.getState()).toMatchObject({ page: "live", sidebarCollapsed: true, performanceTunerActive: true, selectedBlockId: "slot-2" });
    expect(useAppStore.getState().preferences.density).toBe("stage");
  });

  it("connects, records failures and fully disconnects", async () => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    vi.spyOn(deviceApi, "connect").mockResolvedValue({ device: demoDevice, capabilities: demoCapabilities });
    const disconnect = vi.spyOn(deviceApi, "disconnect").mockResolvedValue();
    await useAppStore.getState().connect("pedal.local");
    expect(useAppStore.getState().device).toEqual(demoDevice);
    expect(useAppStore.getState().preferences.address).toBe("pedal.local");
    expect(useAppStore.getState().rigs).toHaveLength(demoRigs.length);
    await useAppStore.getState().disconnect(); expect(disconnect).toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({ device: null, rigs: [], setlists: [], tones: [] });
    useAppStore.setState({ rigs: structuredClone(demoRigs), setlists: structuredClone(demoSetlists) });
    vi.spyOn(deviceApi, "connect").mockRejectedValueOnce(new Error("network down"));
    await useAppStore.getState().connect();
    expect(useAppStore.getState()).toMatchObject({ device: null, connectionBusy: false, connectionError: "network down", rigs: [], setlists: [], tones: [] });
  });

  it("keeps transient refresh failures non-blocking and marks the device unavailable after repetition", async () => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    vi.spyOn(deviceApi, "subtree").mockRejectedValue(new Error("operation timed out"));
    useAppStore.setState({ device: { ...demoDevice, status: "ready" }, capabilities: structuredClone(demoCapabilities), liveSubtree: null, connectionError: null });

    await useAppStore.getState().refreshFull("poll");
    await useAppStore.getState().refreshFull("poll");
    expect(useAppStore.getState().device?.status).toBe("ready");
    expect(useAppStore.getState().connectionError).toBeNull();

    await useAppStore.getState().refreshFull("poll");
    expect(useAppStore.getState().device?.status).toBe("error");
    expect(useAppStore.getState().connectionError).toMatch(/too long to respond/i);
    expect(useAppStore.getState().diagnostics[0]).toMatchObject({ level: "error", message: "Device connection appears unavailable" });

    vi.spyOn(deviceApi, "disconnect").mockResolvedValue();
    await useAppStore.getState().disconnect();
  });

  it("always clears local state when the native disconnect call fails", async () => {
    useAppStore.setState({ device: { ...demoDevice, status: "ready" }, capabilities: structuredClone(demoCapabilities) });
    vi.spyOn(deviceApi, "disconnect").mockRejectedValue(new Error("connection reset"));

    await expect(useAppStore.getState().disconnect()).resolves.toBeUndefined();

    expect(useAppStore.getState()).toMatchObject({ device: null, capabilities: null, connectionError: null });
    expect(useAppStore.getState().diagnostics[0]).toMatchObject({ level: "warning", message: "Disconnected locally" });
  });

  it("stages parameter and bypass writes, then applies or discards them", async () => {
    const rig = useAppStore.getState().rigs[0];
    const block = rig.blocks.find((item) => item.parameters.length)!; const parameter = block.parameters[0];
    useAppStore.getState().updateParameter(block.id, parameter.id, typeof parameter.value === "boolean" ? !parameter.value : 0.37);
    useAppStore.getState().toggleBlock(block.id);
    expect(useAppStore.getState().pendingWrites.length).toBeGreaterThanOrEqual(2);
    const set = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    await useAppStore.getState().applyPending();
    expect(set).toHaveBeenCalled(); expect(useAppStore.getState().pendingWrites).toEqual([]);
    useAppStore.setState({ pendingWrites: [{ id: "w", path: "/x", property: "P", previous: 0, value: 1, createdAt: new Date().toISOString() }] });
    useAppStore.getState().discardPending(); expect(useAppStore.getState().pendingWrites).toEqual([]);
    useAppStore.getState().resolveFirstWrite("immediate");
    expect(useAppStore.getState().preferences).toMatchObject({ writeMode: "immediate", firstWriteResolved: true });
  });

  it("validates and delegates block, routing, footswitch and preset operations", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    const set = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const preset = vi.spyOn(deviceApi, "loadBlockPreset").mockResolvedValue();
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    const source = structuredClone(useAppStore.getState().rigs[0].blocks.find((block) => !block.empty)!);
    await expect(useAppStore.getState().addBlock({ ...source, name: "Unknown", moduleTypeId: 0 } as RigBlock)).rejects.toThrow(/No reflected module/);
    await useAppStore.getState().addBlock({ ...source, slot: 99, moduleTypeId: source.moduleTypeId || 7 });
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [13, source.moduleTypeId || 7]);
    await useAppStore.getState().loadBlockPreset(source.id, "Lead"); expect(preset).toHaveBeenCalledWith(source.name, "Lead");
    await useAppStore.getState().removeBlock(source.id); expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [source.slot, 0]);
    await useAppStore.getState().updateRouting({ Split: 2 });
    await useAppStore.getState().updateFootswitch(3, { Label: "SOLO", Enabled: true });
    expect(set).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", { Split: 2 });
    expect(set).toHaveBeenCalledWith("/Evil/Engine/FootSwitch", { Label3: "SOLO", Enabled3: true });
  });

  it("moves an effect through the exact 14-slot device chain without compacting gaps", async () => {
    const empty = (slot: number): RigBlock => ({ id: `slot-${slot + 1}`, name: "Empty Slot", model: "Available", category: "utility", color: "#354150", enabled: false, empty: true, slot, moduleTypeId: 0, parameters: [] });
    const blocks = Array.from({ length: 14 }, (_, slot) => empty(slot));
    blocks[2] = { ...structuredClone(demoRigs[0].blocks[2]), id: "slot-3", slot: 2, moduleTypeId: 27 };
    const rig = { ...structuredClone(demoRigs[0]), blocks };
    useAppStore.setState({ rigs: [rig], selectedRigId: rig.id, liveSnapshot: null });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();

    await useAppStore.getState().moveBlock(2, 10);

    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [2, 0]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [10, 27]);
    expect(useAppStore.getState().selectedBlockId).toBe("slot-11");
  });

  it("manages favourites, workflows, tone selection and editable test rigs", () => {
    const workflow = { id: "flow", name: "Show prep", updatedAt: "2026-08-30T10:00:00Z" } as SavedWorkflow;
    const store = useAppStore.getState();
    store.toggleFavoriteTone("tone"); store.toggleFavoriteTone("tone");
    store.toggleFavoriteBlock("Amp"); store.toggleFavoriteBlock("Amp");
    store.saveWorkflow(workflow); store.saveWorkflow({ ...workflow, name: "Updated" });
    expect(useAppStore.getState().savedWorkflows).toHaveLength(1); store.deleteWorkflow("flow");
    store.selectToneModel("model"); store.setCaptureOverride("amp");
    const rig = useAppStore.getState().testRigs[0]; const block = rig.blocks[0];
    store.selectTestRig(rig.id); store.toggleTestRigBlock(block.id);
    if (block.parameters[0]) store.updateTestRigParameter(block.id, block.parameters[0].id, .9);
    const added = { ...structuredClone(block), id: "added" }; store.addTestRigBlock(added); store.removeTestRigBlock("added");
    expect(useAppStore.getState()).toMatchObject({ favoriteToneIds: [], favoriteBlockNames: [], savedWorkflows: [], selectedToneModelId: "model", captureOverride: "amp" });
  });

  it("captures, imports, restores and rejects invalid snapshots", async () => {
    const writableTree = { "/Evil/Engine/Patch/Rig": { value: { Name: "Test", ReadOnly: 2 }, meta: { properties: { Name: { type: "string" }, ReadOnly: { type: "number", readOnly: true } } } } };
    useAppStore.setState({ liveSubtree: writableTree, device: demoDevice });
    await useAppStore.getState().createSnapshot("Before show");
    const snapshot = useAppStore.getState().snapshots[0];
    expect(snapshot.payload?.objects).toEqual({ "/Evil/Engine/Patch/Rig": { Name: "Test" } });
    const set = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    await useAppStore.getState().restoreSnapshot(snapshot.id); expect(set).toHaveBeenCalledWith("/Evil/Engine/Patch/Rig", { Name: "Test" });
    await expect(useAppStore.getState().restoreSnapshot("missing")).rejects.toThrow(/cannot be restored/);
    const archive = createRushLinkArchive({ snapshots: [snapshot], workspace: { favoriteToneIds: ["remote"] }, deviceIndex: { rigs: [], setlists: [] } });
    expect(useAppStore.getState().importBackupArchive(archive, true)).toBe(0);
    expect(useAppStore.getState().favoriteToneIds).toEqual(["remote"]);
    useAppStore.getState().deleteSnapshot(snapshot.id); expect(useAppStore.getState().snapshots).toEqual([]);
  });

  it("bounds diagnostics and supports explicit clearing", () => {
    for (let index = 0; index < 260; index++) useAppStore.getState().addDiagnostic({ level: "info", source: "test", message: String(index) });
    expect(useAppStore.getState().diagnostics).toHaveLength(250);
    useAppStore.getState().clearDiagnostics(); expect(useAppStore.getState().diagnostics).toEqual([]);
  });

  it("loads and saves the current rig through the real store actions", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    const refreshFull = vi.fn().mockImplementation(async () => {
      useAppStore.setState({ liveSnapshot: { rig: { ...structuredClone(demoRigs[1]), name: "Loaded Clean" } } as never });
    });
    const refreshPage = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      device: { ...demoDevice, status: "ready" },
      refreshFull,
      refreshPage,
      preferences: { ...useAppStore.getState().preferences, confirmRigReplacement: true },
      liveSnapshot: { rig: { ...structuredClone(demoRigs[0]), modified: "Unsaved changes" } } as never,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await useAppStore.getState().loadRig("rig-2", "sr-2");
    expect(call).not.toHaveBeenCalled();
    await useAppStore.getState().loadRig("rig-2", "sr-2");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("/Evil/API/Rigs", "loadRigConfirm", ["rig-2", "sr-2"]);
    expect(refreshFull).toHaveBeenCalledWith("manual");
    expect(useAppStore.getState().diagnostics.at(-1)).toMatchObject({ level: "success", message: "Loaded Loaded Clean" });

    await useAppStore.getState().saveCurrentRig();
    expect(call).toHaveBeenCalledWith("/Evil/API/Rigs", "saveRig", []);
    expect(refreshPage).toHaveBeenCalledWith("editor", "manual");
  });

  it("hydrates a selected native setlist and reports malformed device responses safely", async () => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    useAppStore.setState({ device: { ...demoDevice, status: "ready" } });
    const detail = vi.spyOn(deviceApi, "getSetlist").mockResolvedValueOnce(JSON.stringify({ rigs: ["rig-2", "rig-3"], rig_names: ["Clean", "Heavy"] }));

    useAppStore.getState().selectSetlist("set-1");
    await vi.waitFor(() => expect(useAppStore.getState().setlists.find((setlist) => setlist.id === "set-1")?.items.map((item) => item.title)).toEqual(["Clean", "Heavy"]));
    expect(detail).toHaveBeenCalledWith("set-1");

    detail.mockRejectedValueOnce(new Error("invalid setlist JSON"));
    useAppStore.getState().selectSetlist("set-2");
    await vi.waitFor(() => expect(useAppStore.getState().diagnostics.at(-1)).toMatchObject({ level: "warning", message: "Could not load setlist" }));
  });

  it("covers StageHand stage metadata, device profiles, dimensions, and deletion boundaries", () => {
    const store = useAppStore.getState();
    store.renameLiveStage("  Rehearsal  ");
    expect(useAppStore.getState().liveStages[0].name).toBe("Rehearsal");
    store.renameLiveStage("   ");
    expect(useAppStore.getState().liveStages[0].name).toBe("Rehearsal");

    store.setLiveDimensions(4, 7, 5);
    expect(useAppStore.getState().liveLayout).toMatchObject({ rows: 4, columns: 7, firstRowColumns: 5 });
    store.setLiveModel("Prime");
    expect(useAppStore.getState().liveLayout).toMatchObject({ model: "Prime", columns: 8, firstRowColumns: 8 });
    store.setLiveLocked(true);
    expect(useAppStore.getState().liveStages[0].layout.locked).toBe(true);

    store.deleteLiveStage();
    expect(useAppStore.getState().liveStages).toHaveLength(1);
    store.setLiveLocked(false);
    store.duplicateLiveStage();
    const duplicateId = useAppStore.getState().selectedLiveStageId;
    store.deleteLiveStage();
    expect(useAppStore.getState().liveStages).toHaveLength(1);
    expect(useAppStore.getState().selectedLiveStageId).not.toBe(duplicateId);
  });

  it("commits a history preview and manages Test Rig set membership", async () => {
    const current = structuredClone(demoRigs[0]);
    const preview = { ...structuredClone(demoRigs[1]), id: current.id, name: "Previewed state" };
    const saveCurrentRig = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      saveCurrentRig,
      liveSnapshot: { rig: preview } as never,
      historyPreview: { rigId: current.id, entryId: "history-1", side: "after", returnState: current, previewState: preview },
      rigHistory: { [current.id]: [] },
      testRigSets: [{ id: "run", name: "Run", rigIds: testRigTemplates.slice(0, 2).map((rig) => rig.id) }],
      selectedTestRigSetId: "run",
    });

    await useAppStore.getState().overwriteFromHistory();
    expect(saveCurrentRig).toHaveBeenCalledOnce();
    expect(useAppStore.getState().historyPreview).toBeNull();
    expect(useAppStore.getState().rigHistory[current.id][0]).toMatchObject({ description: "Overwrote current rig from change history" });

    const removed = testRigTemplates[0].id;
    useAppStore.getState().removeTestRigFromSetlist(removed);
    expect(useAppStore.getState().testRigSets[0].rigIds).not.toContain(removed);
  });
});
