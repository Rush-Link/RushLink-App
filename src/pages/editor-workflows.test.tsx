import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs } from "../data/demo-data";
import type { Parameter, RigHistoryEntry } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { EditorPage, EqGraph } from "./editor";

function editorRig() {
  const rig = structuredClone(demoRigs[0]);
  const drive = rig.blocks.find((block) => block.id === "b-drive")!;
  Object.assign(drive, { moduleTypeId: 17, presetName: "Crunch", canDouble: true, doubled: false, sourcePath: "/Evil/Engine/Patch/Module3" });
  return rig;
}

describe("Rig Editor high-risk workflows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const rig = editorRig();
    useAppStore.setState({
      device: { ...demoDevice, status: "ready" },
      rigs: [rig],
      selectedRigId: rig.id,
      selectedBlockId: null,
      liveSnapshot: null,
      liveSubtree: null,
      rigHistory: {},
      historyPreview: null,
      pendingWrites: [],
      favoriteBlockNames: [],
    });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    vi.spyOn(deviceApi, "blockPresets").mockResolvedValue(["Crunch", "Solo"]);
  });
  afterEach(cleanup);

  it("adds a searched block to the chosen empty slot and supports catalogue favourites", async () => {
    const addBlock = vi.spyOn(useAppStore.getState(), "addBlock").mockResolvedValue();
    const favorite = vi.spyOn(useAppStore.getState(), "toggleFavoriteBlock");
    render(<EditorPage/>);

    const targetSlot = document.querySelector('[data-chain-slot="9"] .add-block');
    expect(targetSlot).not.toBeNull();
    fireEvent.click(targetSlot as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText(/Search effects and models/i), { target: { value: "Tape Echo" } });
    fireEvent.click(screen.getByRole("button", { name: /Add Tape Echo to favorites/i }));
    expect(favorite).toHaveBeenCalledWith("Tape Echo");
    const result = document.querySelector(".block-choice-card");
    expect(result).not.toBeNull();
    fireEvent.click(result as HTMLElement);

    await waitFor(() => expect(addBlock).toHaveBeenCalledWith(expect.objectContaining({ name: "Tape Echo", slot: 9, enabled: true, empty: false })));
    expect(screen.queryByText("Choose a block")).not.toBeInTheDocument();
  });

  it("routes utility, stereo and tails changes while keeping Mix unavailable for a straight chain", () => {
    const updateRouting = vi.spyOn(useAppStore.getState(), "updateRouting").mockResolvedValue();
    render(<EditorPage/>);

    const mix = screen.getByRole("button", { name: /MIX.*requires a split path/i });
    expect(mix).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "ROUTING" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("switch", { name: "Stereo" }));
    fireEvent.click(screen.getByRole("switch", { name: "Effect tails" }));
    expect(updateRouting).toHaveBeenCalledWith({ Routing: 2 });
    expect(updateRouting).toHaveBeenCalledWith({ RigIsStereo: true });
    expect(updateRouting).toHaveBeenCalledWith({ Tails: true });

    fireEvent.click(screen.getByRole("button", { name: /INPUT.*gate/i }));
    expect(screen.getByText("Routing controls unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Routing controls unavailable")).not.toBeInTheDocument();
  });

  it("supports accessible keyboard block movement and bypass without opening the inspector accidentally", () => {
    const moveBlock = vi.spyOn(useAppStore.getState(), "moveBlock").mockResolvedValue();
    const toggleBlock = vi.spyOn(useAppStore.getState(), "toggleBlock").mockResolvedValue(true);
    const selectBlock = vi.spyOn(useAppStore.getState(), "selectBlock");
    render(<EditorPage/>);
    const drive = screen.getByRole("button", { name: /Velvet Drive, slot 3/i });
    fireEvent.keyDown(drive, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(screen.getByRole("switch", { name: "Bypass Velvet Drive" }), { key: "Enter" });
    expect(moveBlock).toHaveBeenCalledWith(2, 3);
    expect(toggleBlock).toHaveBeenCalledWith("b-drive");
    expect(selectBlock).not.toHaveBeenCalled();
  });

  it("loads and manages block presets, doubling and removal through device APIs", async () => {
    useAppStore.setState({ selectedBlockId: "b-drive" });
    const loadPreset = vi.spyOn(useAppStore.getState(), "loadBlockPreset").mockResolvedValue();
    const removeBlock = vi.spyOn(useAppStore.getState(), "removeBlock").mockResolvedValue();
    const refresh = vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const create = vi.spyOn(deviceApi, "createBlockPreset").mockResolvedValue();
    const rename = vi.spyOn(deviceApi, "renameBlockPreset").mockResolvedValue();
    const removePreset = vi.spyOn(deviceApi, "deleteBlockPreset").mockResolvedValue();
    vi.spyOn(window, "prompt").mockReturnValueOnce("  Saved Tone  ").mockReturnValueOnce("Renamed Tone");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EditorPage/>);
    await screen.findByRole("option", { name: "Solo" });

    const presetPanel = document.querySelector(".inspector-preset");
    expect(presetPanel).not.toBeNull();
    fireEvent.change(within(presetPanel as HTMLElement).getByRole("combobox"), { target: { value: "Solo" } });
    await waitFor(() => expect(loadPreset).toHaveBeenCalledWith("b-drive", "Solo"));
    fireEvent.click(within(presetPanel as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Velvet Drive", 17, "Saved Tone"));
    fireEvent.click(within(presetPanel as HTMLElement).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("Velvet Drive", "Crunch", "Renamed Tone"));
    fireEvent.click(within(presetPanel as HTMLElement).getByRole("button", { name: "Delete preset" }));
    await waitFor(() => expect(removePreset).toHaveBeenCalledWith("Velvet Drive", "Crunch"));

    const doubling = document.querySelector(".inspector-option");
    fireEvent.click(within(doubling as HTMLElement).getByRole("switch"));
    await waitFor(() => expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Module3", { Doubling: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith("editor", "manual"));
    fireEvent.click(screen.getByRole("button", { name: /Remove block/i }));
    await waitFor(() => expect(removeBlock).toHaveBeenCalledWith("b-drive"));
  });

  it("captures and recalls independent A/B rig snapshots", async () => {
    const restore = vi.spyOn(useAppStore.getState(), "restoreRigSnapshot").mockResolvedValue();
    render(<EditorPage/>);
    const captureButtons = screen.getAllByRole("button", { name: /Capture/i });
    fireEvent.click(captureButtons[0]);
    const listenButtons = screen.getAllByRole("button", { name: "Listen" });
    expect(listenButtons[0]).toBeEnabled();
    expect(listenButtons[1]).toBeDisabled();
    fireEvent.click(listenButtons[0]);
    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ name: "Neon Boulevard" }), "Recalled A/B snapshot A"));
    expect(screen.getByRole("button", { name: /A\/B A/i })).toBeInTheDocument();
  });

  it("previews, pins, undoes and redoes history without confusing it with a new edit", async () => {
    const rig = editorRig();
    const before = structuredClone(rig);
    const after = structuredClone(rig);
    after.blocks[2].enabled = false;
    const entry: RigHistoryEntry = { id: "history-1", rigId: rig.id, createdAt: new Date().toISOString(), description: "Bypassed Velvet Drive", before, after, saved: false };
    useAppStore.setState({ rigHistory: { [rig.id]: [entry] } });
    const restore = vi.spyOn(useAppStore.getState(), "restoreHistory").mockResolvedValue();
    const pin = vi.spyOn(useAppStore.getState(), "toggleHistorySaved");
    render(<EditorPage/>);

    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo last edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Bypassed Velvet Drive.*preview completed state/i }));
    fireEvent.click(screen.getByRole("button", { name: /Preview state before Bypassed Velvet Drive/i }));
    fireEvent.click(screen.getByRole("button", { name: "Pin state" }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith("history-1", "before");
      expect(restore).toHaveBeenCalledWith("history-1", "after");
    });
    expect(pin).toHaveBeenCalledWith("history-1");
  });

  it("returns from a history preview or deliberately overwrites the current rig", async () => {
    const rig = editorRig();
    const entry: RigHistoryEntry = { id: "history-1", rigId: rig.id, createdAt: new Date().toISOString(), description: "Changed amp gain", before: structuredClone(rig), after: structuredClone(rig), saved: false };
    useAppStore.setState({
      rigHistory: { [rig.id]: [entry] },
      historyPreview: { rigId: rig.id, entryId: entry.id, side: "before", returnState: structuredClone(rig), previewState: structuredClone(rig) },
    });
    const returnFromHistory = vi.spyOn(useAppStore.getState(), "returnFromHistory").mockResolvedValue();
    const overwrite = vi.spyOn(useAppStore.getState(), "overwriteFromHistory").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EditorPage/>);
    fireEvent.click(screen.getByRole("button", { name: /Return to live state/i }));
    await waitFor(() => expect(returnFromHistory).toHaveBeenCalled());

    cleanup();
    render(<EditorPage/>);
    fireEvent.click(screen.getByRole("button", { name: /Overwrite current rig/i }));
    await waitFor(() => expect(overwrite).toHaveBeenCalled());
  });
});

describe("interactive block EQ", () => {
  it("nudges frequency and gain from the keyboard with parameter-aware steps", () => {
    const parameters: Parameter[] = [
      { id: "SltEQOn", label: "Block EQ", value: true },
      { id: "SltEQF", label: "Frequency", value: 1000, min: 20, max: 20000, step: 1, unit: "Hz" },
      { id: "SltEQG", label: "Gain", value: 0, min: -18, max: 18, step: .5, unit: "dB" },
      { id: "SltEQQ", label: "Q", value: 1, min: .2, max: 10, step: .1 },
      { id: "SltEQHP", label: "High-pass", value: 20, min: 20, max: 20000, step: 1, unit: "Hz" },
      { id: "SltEQLP", label: "Low-pass", value: 20000, min: 20, max: 20000, step: 1, unit: "Hz" },
    ];
    const change = vi.fn();
    render(<EqGraph parameters={parameters} onParameterChange={change}/>);
    const band = screen.getByRole("slider", { name: /Block EQ/i });
    fireEvent.keyDown(band, { key: "ArrowRight" });
    fireEvent.keyDown(band, { key: "ArrowUp" });
    fireEvent.keyDown(band, { key: "Escape" });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ id: "SltEQF" }), expect.any(Number));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ id: "SltEQG" }), .5);
    expect(change).toHaveBeenCalledTimes(2);
  });
});
