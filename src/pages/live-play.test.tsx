import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionPalette, defaultLiveLayout, defaultLiveStage, demoRigs } from "../data/demo-data";
import type { LiveButton, LiveGesture } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { filterStagehandPalette, LivePad, LivePlayPage, MultiButtonDeck, PALETTE_CATEGORIES, StageTunerWidget, stagehandPaletteAccent, stagehandPaletteCategory, stagehandPaletteItemKey } from "./live-play";

const widgetData = {
  tuner: { open: false, note: "", cents: 0, reference: 440 },
  drums: { playing: false, muted: false, kit: "Studio", part: "Verse", bar: 1, beat: 1 },
};

afterEach(() => cleanup());

describe("StageHand multi-button decks", () => {
  it("triggers an internal drum button while the layout is editable", () => {
    const template = actionPalette.find((item) => item.group === "Drum decks" && item.widgetLayout === "2x2")!;
    const onWidgetAction = vi.fn();
    render(<MultiButtonDeck button={{ ...template, id: "drums" } as LiveButton} editable widgetData={widgetData} onWidgetAction={onWidgetAction}/>);
    fireEvent.click(screen.getByRole("button", { name: /fill · drums · cc 43/i }));
    expect(onWidgetAction).toHaveBeenCalledWith("fill");
  });

  it("wires all drum-deck triggers and the accent press/release pair", () => {
    const template = actionPalette.find((item) => item.group === "Drum decks" && item.widgetLayout === "2x3")!;
    const onWidgetAction = vi.fn();
    const { container } = render(<MultiButtonDeck button={{ ...template, id: "drums-all" } as LiveButton} editable widgetData={widgetData} onWidgetAction={onWidgetAction}/>); const deck = within(container);
    for (const [label, target] of [["play", "toggle"], ["fill", "fill"], ["bridge", "bridge"], ["outro", "outro"], ["mute", "mute"]]) {
      fireEvent.click(deck.getByRole("button", { name: new RegExp(`${label} · drums`, "i") }));
      expect(onWidgetAction).toHaveBeenLastCalledWith(target);
    }
    const accent = deck.getByRole("button", { name: /accent · drums · cc 47/i });
    fireEvent.pointerDown(accent);
    fireEvent.pointerUp(accent);
    expect(onWidgetAction).toHaveBeenNthCalledWith(6, "accent", "press");
    expect(onWidgetAction).toHaveBeenNthCalledWith(7, "accent", "release");
  });

  it.each(["toggle", "fill", "bridge", "outro", "mute", "accent"])("wires Drummer button · %s independently", (target) => {
    const template = actionPalette.find((item) => item.group === "Drum decks" && item.widgetLayout === "2x3")!;
    const onWidgetAction = vi.fn();
    render(<MultiButtonDeck button={{ ...template, id: `drums-${target}` } as LiveButton} editable={false} widgetData={widgetData} onWidgetAction={onWidgetAction}/>);
    const control = screen.getByRole("button", { name: new RegExp(`^${target === "toggle" ? "play" : target} · drums`, "i") });
    if (target === "accent") {
      fireEvent.pointerDown(control);
      fireEvent.pointerUp(control);
      expect(onWidgetAction.mock.calls).toEqual([["accent", "press"], ["accent", "release"]]);
    } else {
      fireEvent.click(control);
      expect(onWidgetAction).toHaveBeenCalledOnce();
      expect(onWidgetAction).toHaveBeenCalledWith(target);
    }
  });
});

describe("StageHand live tuner display", () => {
  const renderTuner = (onTrigger: (gesture?: LiveGesture) => void) => {
    const template = actionPalette.find((item) => item.widget === "tuner")!;
    return render(<LivePad button={{ ...template, id: "tuner-display" } as LiveButton} index={0} editable={false} selected={false} moving={false} spanRows={1} spanColumns={2} gridStyle={{}} dragging={false} dragOver={false} widgetData={widgetData} onSelect={vi.fn()} onTrigger={onTrigger} onWidgetAction={vi.fn()} onDragBegin={vi.fn()} onDragHover={vi.fn()} onDragFinish={vi.fn()} onDragCancel={vi.fn()}/>);
  };

  it("toggles the device tuner on a short tap", () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn<(gesture?: LiveGesture) => void>();
    const { container, unmount } = renderTuner(onTrigger);
    const tuner = within(container).getByRole("group", { name: /tuner display · tap tuner · hold mute/i });
    fireEvent.pointerDown(tuner, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(tuner, { pointerId: 1, button: 0 });
    act(() => vi.advanceTimersByTime(261));
    expect(onTrigger).toHaveBeenCalledOnce();
    expect(onTrigger).toHaveBeenCalledWith("release");
    unmount();
    vi.useRealTimers();
  });

  it("sends the mute gesture after a hold without also toggling the tuner", () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn<(gesture?: LiveGesture) => void>();
    const { container, unmount } = renderTuner(onTrigger);
    const tuner = within(container).getByRole("group", { name: /tuner display · tap tuner · hold mute/i });
    fireEvent.pointerDown(tuner, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(650));
    fireEvent.pointerUp(tuner, { pointerId: 2, button: 0 });
    act(() => vi.advanceTimersByTime(300));
    expect(onTrigger).toHaveBeenCalledOnce();
    expect(onTrigger).toHaveBeenCalledWith("hold");
    unmount();
    vi.useRealTimers();
  });

  it("updates its own live readout from the device tuner feed", async () => {
    const native = vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    const tunerValues = vi.spyOn(deviceApi, "tunerValues").mockResolvedValue({ TunerString: "E", TunerCents: 7, TunerRef: 442 });
    const { unmount } = render(<StageTunerWidget tuner={{ open: true, note: "", cents: 0, reference: 440 }} deviceId="device-1"/>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(screen.getByText("+7 cents")).toBeInTheDocument();
    expect(tunerValues).toHaveBeenCalledOnce();
    unmount();
    tunerValues.mockRestore();
    native.mockRestore();
  });
});

describe("StageHand add-control catalogue", () => {
  it("opens directly into focused categories without an everything view", () => {
    expect(PALETTE_CATEGORIES.map((category) => category.label)).not.toContain("Everything");
    expect(new Set(PALETTE_CATEGORIES.map((category) => category.accent)).size).toBe(PALETTE_CATEGORIES.length);
  });

  it("places controls into focused functional categories", () => {
    const byLabel = (label: string) => actionPalette.find((item) => item.label === label)!;
    expect(stagehandPaletteCategory(byLabel("TAP TEMPO"))).toBe("Tuner");
    expect(stagehandPaletteCategory(byLabel("SCENE A"))).toBe("Scenes");
    expect(stagehandPaletteCategory(byLabel("MULTIFUNCTION"))).toBe("My controls");
    expect(actionPalette.some((item) => ["looper", "practice", "expression"].includes(item.action))).toBe(false);
    expect(PALETTE_CATEGORIES.map((category) => category.label)).not.toEqual(expect.arrayContaining(["Practice & pedal", "Looper"]));
    expect(actionPalette.some((item) => item.action === "snapshot")).toBe(false);
    expect(PALETTE_CATEGORIES.map((category) => category.label)).not.toContain("Utilities");
  });

  it("uses the same explicit accent colour for a catalogue item and its stage pad", () => {
    const template = actionPalette.find((item) => item.label === "RIG +")!;
    expect(stagehandPaletteAccent(template)).toBe(PALETTE_CATEGORIES.find((category) => category.id === "Rig")?.accent);
    const { container } = render(<LivePad button={{ ...template, id: "accent-preview", accentColor: "#d25b91" } as LiveButton} index={0} editable={false} selected={false} moving={false} spanRows={1} spanColumns={1} gridStyle={{}} dragging={false} dragOver={false} widgetData={widgetData} onSelect={vi.fn()} onTrigger={vi.fn()} onWidgetAction={vi.fn()} onDragBegin={vi.fn()} onDragHover={vi.fn()} onDragFinish={vi.fn()} onDragCancel={vi.fn()}/>);
    expect(within(container).getByRole("button").style.getPropertyValue("--pad-color")).toBe("#d25b91");
  });

  it("uses stable keys for built-in and saved controls", () => {
    const template = actionPalette.find((item) => item.label === "RIG +")!;
    expect(stagehandPaletteItemKey(template)).toContain("Rig:rig-next");
    expect(stagehandPaletteItemKey({ ...template, group: "My controls", presetId: "lead" })).toBe("preset:lead");
  });

  it("keeps category tabs authoritative even when a search spans categories", () => {
    const searched = actionPalette.filter((item) => ["Rig", "Scenes", "Drums"].includes(stagehandPaletteCategory(item)));
    const rigItems = filterStagehandPalette(searched, "Rig", []);
    const sceneItems = filterStagehandPalette(searched, "Scenes", []);
    const drumItems = filterStagehandPalette(searched, "Drums", []);
    expect(rigItems.length).toBeGreaterThan(0);
    expect(sceneItems.length).toBeGreaterThan(0);
    expect(drumItems.length).toBeGreaterThan(0);
    expect(rigItems.every((item) => stagehandPaletteCategory(item) === "Rig")).toBe(true);
    expect(sceneItems.every((item) => stagehandPaletteCategory(item) === "Scenes")).toBe(true);
    expect(drumItems.every((item) => stagehandPaletteCategory(item) === "Drums")).toBe(true);
  });
});

describe("StageHand layout editor", () => {
  it("uses the full stage outside edit mode and opens a selected control in its own tab", () => {
    const layout = structuredClone(defaultLiveLayout);
    useAppStore.setState({
      liveLayout: layout,
      liveStages: [{ ...structuredClone(defaultLiveStage), layout }],
      selectedLiveStageId: defaultLiveStage.id,
      rigs: structuredClone(demoRigs),
      liveSnapshot: null,
      liveSubtree: {},
      favoriteLiveControlKeys: [],
      liveControlPresets: [],
    });

    const { container } = render(<LivePlayPage/>);
    const page = container.querySelector(".stagehand-v2")!;
    const rigStrip = screen.getByLabelText("Current device rig");
    expect(page).toHaveClass("live-page--performance");
    expect(within(rigStrip).getByText(demoRigs[0].name)).toBeInTheDocument();
    expect(within(rigStrip).getByText("Preview")).toBeInTheDocument();
    expect(within(rigStrip).queryByText("NEXT")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit layout/i }));
    expect(page).not.toHaveClass("live-page--performance");
    const stageTab = screen.getByRole("tab", { name: /stage layout and rig/i });
    const controlTab = screen.getByRole("tab", { name: /control select a control/i });
    expect(stageTab).toHaveAttribute("aria-selected", "true");
    expect(controlTab).toBeDisabled();
    expect(screen.queryByLabelText(/device profile/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Horizontal gap"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("Left inset"), { target: { value: "52" } });
    const board = container.querySelector(".live-board.stagehand-grid") as HTMLElement;
    expect(board.style.getPropertyValue("--stage-column-gap")).toBe("24px");
    expect(board.style.getPropertyValue("--stage-inset-left")).toBe("52px");

    fireEvent.click(container.querySelector(".live-board .live-pad:not(.live-pad--empty)")!);
    const selectedControlTab = screen.getByRole("tab", { name: /control slot 1/i });
    expect(selectedControlTab).toBeEnabled();
    expect(selectedControlTab).toHaveAttribute("aria-selected", "true");
    expect(stageTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("CONTROL 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /editing layout/i }));
    expect(page).toHaveClass("live-page--performance");
    expect(screen.queryByRole("tab", { name: /control/i })).not.toBeInTheDocument();
  });
});
