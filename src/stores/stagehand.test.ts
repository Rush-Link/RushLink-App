import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionPalette, defaultLiveLayout, defaultLiveStage, demoRigs } from "../data/demo-data";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "./app-store";

describe("StageHand stages", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      liveLayout: structuredClone(defaultLiveLayout),
      liveStages: [structuredClone(defaultLiveStage)],
      selectedLiveStageId: defaultLiveStage.id,
      favoriteLiveControlKeys: [],
      liveControlPresets: [],
      rigs: structuredClone(demoRigs),
      selectedRigId: demoRigs[0].id,
      liveSnapshot: null,
      diagnostics: [],
      preferences: { ...useAppStore.getState().preferences, writeMode: "immediate" },
    });
  });

  it("blocks every layout mutation while locked, including stale menu and MIDI-learn actions", () => {
    const store = useAppStore.getState();
    store.createLiveStage();
    store.selectLiveStage(defaultLiveStage.id);
    store.setLiveLocked(true);
    const before = structuredClone(useAppStore.getState().liveStages);
    const button = useAppStore.getState().liveLayout.buttons[0]!;
    store.moveLiveButton(0, 1);
    store.removeLiveButton(button.id);
    store.updateLiveButton(button.id, { label: "Changed" });
    store.updateMidi(button.id, { ...button.midi, number: 99 });
    store.addLiveButton({ ...button, id: "extra" });
    store.setLiveDimensions(4, 8, 8);
    store.setLiveSpacing({ columnGap: 35 });
    store.setLiveModel("Prime");
    store.renameLiveStage("Changed");
    store.attachLiveStageToRig(demoRigs[0].id);
    store.deleteLiveStage();
    store.duplicateLiveStage();
    store.createLiveStage();
    expect(useAppStore.getState().liveStages).toEqual(before);
    expect(useAppStore.getState().liveLayout).toEqual(before[0].layout);
    store.setLiveLocked(false);
    store.updateLiveButton(button.id, { label: "Changed" });
    expect(useAppStore.getState().liveLayout.buttons[0]?.label).toBe("Changed");
  });

  it("creates a separate empty stage and keeps its layout in sync", () => {
    useAppStore.getState().createLiveStage("Acoustic set");
    const created = useAppStore.getState().liveStages.at(-1)!;
    expect(created.name).toBe("Acoustic set");
    expect(created.layout.buttons.every((button) => button === null)).toBe(true);

    useAppStore.getState().addLiveButton(structuredClone(defaultLiveLayout.buttons[0]!));
    const active = useAppStore.getState().liveStages.find((stage) => stage.id === created.id)!;
    expect(active.layout.buttons.filter(Boolean)).toHaveLength(1);
  });

  it("manually switches stages without sharing layout edits", () => {
    useAppStore.getState().duplicateLiveStage();
    const [first, second] = useAppStore.getState().liveStages;
    useAppStore.getState().removeLiveButton(second.layout.buttons[0]!.id);
    expect(useAppStore.getState().liveLayout.buttons[0]).toBeNull();

    useAppStore.getState().selectLiveStage(first.id);
    expect(useAppStore.getState().liveLayout.buttons[0]).not.toBeNull();
  });

  it("moves controls without losing them and ignores invalid drag destinations", () => {
    const first = useAppStore.getState().liveLayout.buttons[0]!;
    const second = useAppStore.getState().liveLayout.buttons[1]!;
    useAppStore.getState().moveLiveButton(0, 1);
    expect(useAppStore.getState().liveLayout.buttons.slice(0, 2).map((button) => button?.id)).toEqual([second.id, first.id]);
    expect(useAppStore.getState().liveStages[0].layout.buttons.slice(0, 2).map((button) => button?.id)).toEqual([second.id, first.id]);
    useAppStore.getState().moveLiveButton(-1, 99);
    expect(useAppStore.getState().liveLayout.buttons.slice(0, 2).map((button) => button?.id)).toEqual([second.id, first.id]);
  });

  it("stores spacing and safe-area insets on the active stage", () => {
    useAppStore.getState().setLiveSpacing({ columnGap: 22, rowGap: 14, insetLeft: 48 });
    expect(useAppStore.getState().liveLayout.spacing).toMatchObject({ columnGap: 22, rowGap: 14, insetLeft: 48 });
    expect(useAppStore.getState().liveStages[0].layout.spacing).toEqual(useAppStore.getState().liveLayout.spacing);
  });

  it("keeps only one automatic stage attachment per rig", () => {
    useAppStore.getState().createLiveStage("Lead");
    useAppStore.getState().attachLiveStageToRig(demoRigs[1].id);
    const lead = useAppStore.getState().selectedLiveStageId;
    useAppStore.getState().selectLiveStage(defaultLiveStage.id);
    useAppStore.getState().attachLiveStageToRig(demoRigs[1].id);

    expect(useAppStore.getState().liveStages.find((stage) => stage.id === defaultLiveStage.id)?.rigId).toBe(demoRigs[1].id);
    expect(useAppStore.getState().liveStages.find((stage) => stage.id === lead)?.rigId).toBeUndefined();
  });

  it("uses tap for device tuner visibility and hold for tuner muting", async () => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockResolvedValue({ status: 200, body: {} });
    useAppStore.setState({ liveSubtree: {
      "/Evil/Engine/AudioCtrl/Input": { value: { TunerOn: false } },
      "/Evil/Engine/AudioCtrl/Tuner": { value: { TunerMuting: true } },
    } });
    const tuner = useAppStore.getState().liveLayout.buttons.find((button) => button?.action === "tuner" && !button.widget)!;
    await useAppStore.getState().triggerLiveButton(tuner.id, "release");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "tuner", target: undefined, active: false }), "release");
    await useAppStore.getState().triggerLiveButton(tuner.id, "hold");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "tuner", target: "mute", active: true }), "hold");
    execute.mockRestore();
  });

  it("dispatches and activates every scene from A through F", async () => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockResolvedValue({ status: 200, body: {} });
    const scenes = actionPalette.filter((button) => button.action === "scene").map((button, index) => ({ ...structuredClone(button), id: `scene-${index}` }));
    const layout = { ...structuredClone(defaultLiveLayout), rows: 2, columns: 3, firstRowColumns: 3, buttons: scenes };
    useAppStore.setState({ liveLayout: layout, liveStages: [{ ...structuredClone(defaultLiveStage), layout }] });

    for (const [index, scene] of scenes.entries()) {
      await useAppStore.getState().triggerLiveButton(scene.id, "release");
      expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "scene", target: "ABCDEF"[index] }), "release");
      expect(useAppStore.getState().liveLayout.buttons.filter((button) => button?.active).map((button) => button?.target)).toEqual(["ABCDEF"[index]]);
    }
    execute.mockRestore();
  });

  it("restores the previous scene selection when the device rejects a scene", async () => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockRejectedValueOnce(new Error("device busy"));
    const sceneA = { ...structuredClone(actionPalette.find((button) => button.action === "scene" && button.target === "A")!), id: "scene-a", active: true };
    const sceneE = { ...structuredClone(actionPalette.find((button) => button.action === "scene" && button.target === "E")!), id: "scene-e", active: false };
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [sceneA, sceneE, ...Array(defaultLiveLayout.buttons.length - 2).fill(null)] };
    useAppStore.setState({ liveLayout: layout, liveStages: [{ ...structuredClone(defaultLiveStage), layout }] });

    await expect(useAppStore.getState().triggerLiveButton(sceneE.id)).resolves.toBe(false);
    expect(useAppStore.getState().liveLayout.buttons.slice(0, 2).map((button) => button?.active)).toEqual([true, false]);
    expect(useAppStore.getState().diagnostics.at(-1)).toMatchObject({ source: "StageHand", message: "Could not trigger SCENE E" });
    execute.mockRestore();
  });

  it("routes drum deck targets with their exact gesture and reflected play state", async () => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockResolvedValue({ status: 200, body: {} });
    const template = actionPalette.find((button) => button.group === "Drum decks" && button.widgetLayout === "2x3")!;
    const drums = { ...structuredClone(template), id: "drum-deck", active: false };
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [drums, ...Array(defaultLiveLayout.buttons.length - 1).fill(null)] };
    useAppStore.setState({
      liveLayout: layout,
      liveStages: [{ ...structuredClone(defaultLiveStage), layout }],
      liveSubtree: { "/Evil/Engine/DrumsCtrl": { value: { isPlaying: true } } },
    });

    await useAppStore.getState().triggerLiveButton(drums.id, "release", "toggle");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "drums", target: "toggle", active: true }), "release");
    await useAppStore.getState().triggerLiveButton(drums.id, "press", "accent");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "drums", target: "accent" }), "press");
    execute.mockRestore();
  });

  it("rejects legacy outbound-only controls without calling the HTTP adapter", async () => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockResolvedValue({ status: 200, body: {} });
    const looper = { id: "looper-command", label: "Legacy looper", subtitle: "Removed", action: "looper" as const, target: "toggle", color: "rose", icon: "repeat", midi: { type: "cc" as const, channel: 1, number: 69, value: 127, releaseValue: 0 } };
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [looper, ...Array(defaultLiveLayout.buttons.length - 1).fill(null)] };
    useAppStore.setState({ liveLayout: layout, liveStages: [{ ...structuredClone(defaultLiveStage), layout }] });

    await expect(useAppStore.getState().triggerLiveButton(looper.id)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(useAppStore.getState().diagnostics.at(-1)?.detail).toMatch(/no longer sends MIDI/i);
    execute.mockRestore();
  });

  it("rejects missing controls and unassigned effect controls without a device write", async () => {
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    await expect(useAppStore.getState().triggerLiveButton("missing")).resolves.toBe(false);
    const source = useAppStore.getState().liveLayout.buttons.find((button) => button?.action === "block-toggle")!;
    useAppStore.getState().updateLiveButton(source.id, { target: undefined });
    await expect(useAppStore.getState().triggerLiveButton(source.id)).resolves.toBe(false);
    expect(setProperties).not.toHaveBeenCalled();
    expect(useAppStore.getState().diagnostics.at(-1)?.message).toContain("has no effect block assigned");
    setProperties.mockRestore();
  });

  it("dispatches only compatible assignments from the dedicated multifunction pad", async () => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockResolvedValue({ status: 200, body: {} });
    const template = {
      id: "multi", label: "MULTIFUNCTION", subtitle: "", action: "custom" as const, color: "rose", icon: "terminal",
      multiFunction: true, switchType: "multi" as const, tapBinding: { action: "scene" as const, target: "B" },
      holdBinding: { action: "tap-tempo" as const }, doubleBinding: { action: "tuner" as const, target: "mute" },
      midi: { type: "note" as const, channel: 1, number: 60, value: 127 },
    };
    useAppStore.getState().addLiveButton(template);
    await useAppStore.getState().triggerLiveButton(template.id, "release");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "scene", target: "B" }), "release");
    const callsAfterTap = execute.mock.calls.length;
    await useAppStore.getState().triggerLiveButton(template.id, "hold");
    expect(execute).toHaveBeenCalledTimes(callsAfterTap);
    await useAppStore.getState().triggerLiveButton(template.id, "double");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "tuner", target: "mute" }), "double");
    execute.mockRestore();
  });

  it("saves, updates, favourites and removes reusable controls", () => {
    const source = structuredClone(defaultLiveLayout.buttons[0]!);
    useAppStore.getState().saveLiveControlPreset("Lead switch", source);
    const first = useAppStore.getState().liveControlPresets[0];
    expect(first.name).toBe("Lead switch");
    expect(first.button).not.toHaveProperty("id");

    useAppStore.getState().saveLiveControlPreset("lead switch", { ...source, subtitle: "Updated mapping" });
    expect(useAppStore.getState().liveControlPresets).toHaveLength(1);
    expect(useAppStore.getState().liveControlPresets[0].button.subtitle).toBe("Updated mapping");

    const key = `preset:${first.id}`;
    useAppStore.getState().toggleFavoriteLiveControl(key);
    expect(useAppStore.getState().favoriteLiveControlKeys).toContain(key);
    useAppStore.getState().deleteLiveControlPreset(first.id);
    expect(useAppStore.getState().liveControlPresets).toHaveLength(0);
    expect(useAppStore.getState().favoriteLiveControlKeys).not.toContain(key);
  });

  it("never creates an invisible control when the stage is full", () => {
    const source = structuredClone(defaultLiveLayout.buttons[0]!);
    const fullButtons = defaultLiveLayout.buttons.map((button, index) => button ?? { ...source, id: `filled-${index}` });
    useAppStore.setState({
      liveLayout: { ...structuredClone(defaultLiveLayout), buttons: fullButtons },
      liveStages: [{ ...structuredClone(defaultLiveStage), layout: { ...structuredClone(defaultLiveLayout), buttons: fullButtons } }],
    });

    useAppStore.getState().addLiveButton({ ...source, id: "must-not-be-hidden" });
    expect(useAppStore.getState().liveLayout.buttons).toHaveLength(fullButtons.length);
    expect(useAppStore.getState().liveLayout.buttons.some((button) => button?.id === "must-not-be-hidden")).toBe(false);
  });

  it("does not overwrite an occupied slot when adding a control", () => {
    const original = useAppStore.getState().liveLayout.buttons[0]!;
    useAppStore.getState().addLiveButton({ ...original, id: "replacement" }, 0);
    expect(useAppStore.getState().liveLayout.buttons[0]?.id).toBe(original.id);
  });

  it("normalizes manually entered MIDI data before persisting it", () => {
    const button = useAppStore.getState().liveLayout.buttons[0]!;
    useAppStore.getState().updateMidi(button.id, { type: "cc", channel: 99, number: -4, value: 200, releaseValue: -20 });
    expect(useAppStore.getState().liveLayout.buttons[0]?.midi).toEqual({ type: "cc", channel: 16, number: 0, value: 127, releaseValue: 0 });
  });

  it("rolls back an effect control when the immediate device write fails", async () => {
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockRejectedValueOnce(new Error("offline"));
    const control = useAppStore.getState().liveLayout.buttons.find((button) => button?.action === "block-toggle")!;
    const beforeControl = control.active;
    const beforeBlock = useAppStore.getState().rigs[0].blocks.find((block) => block.id === control.target)!.enabled;

    await expect(useAppStore.getState().triggerLiveButton(control.id)).resolves.toBe(false);
    expect(useAppStore.getState().liveLayout.buttons.find((button) => button?.id === control.id)?.active).toBe(beforeControl);
    expect(useAppStore.getState().rigs[0].blocks.find((block) => block.id === control.target)?.enabled).toBe(beforeBlock);
    expect(useAppStore.getState().diagnostics.at(-1)?.source).toBe("StageHand");
    setProperties.mockRestore();
  });

  it.each(demoRigs[0].blocks.filter((block) => !block.empty && !["input", "output"].includes(block.category)).map((block) => [block.name, block] as const))
  ("toggles attached rig block · %s through its reflected On property", async (_name, sourceBlock) => {
    const path = `/Evil/Engine/Patch/${sourceBlock.name.replaceAll(" ", "_")}`;
    const rig = structuredClone(demoRigs[0]);
    rig.blocks = rig.blocks.map((block) => block.id === sourceBlock.id ? { ...block, sourcePath: path } : block);
    const control = {
      id: `effect-${sourceBlock.id}`, label: sourceBlock.name.toUpperCase(), subtitle: sourceBlock.model,
      action: "block-toggle" as const, target: sourceBlock.id, switchType: "toggle" as const,
      color: "amber", icon: "zap", active: sourceBlock.enabled,
      midi: { type: "cc" as const, channel: 1, number: 75 + sourceBlock.slot, value: 127, releaseValue: 0 },
    };
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [control, ...Array(defaultLiveLayout.buttons.length - 1).fill(null)] };
    useAppStore.setState({ rigs: [rig], selectedRigId: rig.id, liveLayout: layout, liveStages: [{ ...structuredClone(defaultLiveStage), layout }] });
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });

    await expect(useAppStore.getState().triggerLiveButton(control.id)).resolves.toBe(true);
    expect(setProperties).toHaveBeenCalledWith(path, { On: !sourceBlock.enabled });
    expect(useAppStore.getState().rigs[0].blocks.find((block) => block.id === sourceBlock.id)?.enabled).toBe(!sourceBlock.enabled);
    setProperties.mockRestore();
  });
});
