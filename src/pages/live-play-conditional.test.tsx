import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionPalette, defaultLiveLayout, defaultLiveStage, demoRigs } from "../data/demo-data";
import type { LiveButton, LiveLayout, LiveStage } from "../domain/types";
import { midiConnection } from "../services/midi-connection";
import { useAppStore } from "../stores/app-store";
import { LivePlayPage } from "./live-play";

const original = {
  loadRig: useAppStore.getState().loadRig,
  setPage: useAppStore.getState().setPage,
};

function stageState(layout: LiveLayout, rigId?: string): Pick<ReturnType<typeof useAppStore.getState>, "liveLayout" | "liveStages" | "selectedLiveStageId"> {
  const stage: LiveStage = { ...structuredClone(defaultLiveStage), ...(rigId ? { rigId } : {}), layout };
  return { liveLayout: layout, liveStages: [stage], selectedLiveStageId: stage.id };
}

function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: /edit layout/i }));
}

describe("StageHand conditional UI", () => {
  beforeEach(() => {
    const layout = structuredClone(defaultLiveLayout);
    useAppStore.setState({
      ...stageState(layout),
      rigs: structuredClone(demoRigs),
      selectedRigId: demoRigs[0].id,
      liveSnapshot: null,
      liveSubtree: null,
      favoriteLiveControlKeys: [],
      liveControlPresets: [],
      diagnostics: [],
      loadRig: original.loadRig,
      setPage: original.setPage,
      preferences: { ...useAppStore.getState().preferences, keepAwake: false },
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders a safe connection placeholder when no rig is available", () => {
    useAppStore.setState({ rigs: [], selectedRigId: "" });
    render(<LivePlayPage/>);
    expect(screen.getByText("Connect to your HeadRush")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("keeps rig controls unavailable on a manual stage and explains how to unlock them", () => {
    render(<LivePlayPage/>);
    openEditor();

    expect(screen.getByText("MANUAL")).toBeInTheDocument();
    expect(screen.getByText(/attach a rig before adding effect-block controls/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /control select a control/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete this stage/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /add control/i }));
    expect(screen.getByRole("tab", { name: /rig effects/i })).toBeDisabled();
    expect(screen.getByText(/attach a rig to expose its effects/i)).toBeInTheDocument();
  });

  it("distinguishes a linked rig from the current rig and offers an explicit load action", async () => {
    const loadRig = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ ...stageState(structuredClone(defaultLiveLayout), demoRigs[1].id), loadRig });
    render(<LivePlayPage/>);
    openEditor();

    expect(screen.getByText("RIG LINKED")).toBeInTheDocument();
    expect(screen.getByText(/loading this rig will automatically switch/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load rig/i }));
    await waitFor(() => expect(loadRig).toHaveBeenCalledWith(demoRigs[1].id, undefined));

    fireEvent.change(screen.getByLabelText("Attached rig"), { target: { value: demoRigs[0].id } });
    expect(screen.getByText("CURRENT RIG")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load rig/i })).not.toBeInTheDocument();
  });

  it("shows an orphaned rig link without presenting a load action", () => {
    useAppStore.setState(stageState(structuredClone(defaultLiveLayout), "deleted-rig"));
    render(<LivePlayPage/>);
    openEditor();

    expect(screen.getByText("Attached rig unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load rig/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add control/i }));
    expect(screen.getByRole("tab", { name: /rig effects/i })).toBeDisabled();
  });

  it("disables an attached-rig effect when a different rig is active", () => {
    const block = demoRigs[1].blocks.find((candidate) => candidate.category === "overdrive")!;
    const control: LiveButton = {
      id: "linked-effect", label: "LINKED DRIVE", subtitle: block.name, action: "block-toggle", target: block.id,
      switchType: "toggle", color: "amber", icon: "zap", midi: { type: "cc", channel: 1, number: 75 + block.slot, value: 127 },
    };
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [control, ...Array(11).fill(null)] };
    useAppStore.setState(stageState(layout, demoRigs[1].id));
    const { container } = render(<LivePlayPage/>);

    expect(container.querySelector('[data-button-id="linked-effect"]')).toBeDisabled();
  });

  it("renders and applies scene-specific editing without unrelated controls", () => {
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /scene a/i }));

    expect(screen.getByText(/scene .* documented cc 21/i)).toBeInTheDocument();
    expect(screen.queryByText(/drum action/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "F" }));

    const selected = useAppStore.getState().liveLayout.buttons.find((button) => button?.id === "live-5");
    expect(selected).toMatchObject({ label: "SCENE F", target: "F", midi: { type: "cc", number: 26 } });
  });

  it("switches a single Drummer control between trigger, momentary and toggle behaviours", () => {
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /drums play \/ stop/i }));

    fireEvent.click(screen.getByRole("button", { name: "Accent" }));
    expect(useAppStore.getState().liveLayout.buttons.find((button) => button?.id === "live-11")).toMatchObject({ target: "accent", switchType: "momentary", midi: { number: 47 } });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(useAppStore.getState().liveLayout.buttons.find((button) => button?.id === "live-11")).toMatchObject({ target: "mute", switchType: "toggle", midi: { number: 46 } });
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect(useAppStore.getState().liveLayout.buttons.find((button) => button?.id === "live-11")).toMatchObject({ target: "fill", switchType: "trigger", midi: { number: 43 } });
  });

  it("reports a stage becoming full while its add-control catalogue is open", () => {
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /add control/i }));

    const source = structuredClone(defaultLiveLayout.buttons[0]!);
    const full = defaultLiveLayout.buttons.map((button, index) => button ?? { ...source, id: `fill-${index}` });
    act(() => {
      const layout = { ...structuredClone(defaultLiveLayout), buttons: full };
      useAppStore.setState(stageState(layout));
    });
    const dialog = screen.getByRole("dialog", { name: /add stagehand control/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /rig .* previous/i }));
    expect(screen.getByText(/this stage is full/i)).toBeInTheDocument();
  });

  it("explains when the live tuner cannot obtain two adjacent cells", () => {
    const source = structuredClone(defaultLiveLayout.buttons[0]!);
    const layout: LiveLayout = { ...structuredClone(defaultLiveLayout), rows: 1, columns: 4, firstRowColumns: 4, buttons: [source, null, { ...source, id: "right-1" }, { ...source, id: "right-2" }] };
    useAppStore.setState(stageState(layout));
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /add control/i }));
    fireEvent.click(screen.getByRole("tab", { name: /tuner & tempo/i }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /add stagehand control/i })).getByRole("button", { name: /^tuner display/i }));

    expect(screen.getByText(/tuner display needs two adjacent free columns/i)).toBeInTheDocument();
  });

  it("routes the shared MIDI setup action to Settings and remembers its tab", () => {
    const setPage = vi.fn();
    useAppStore.setState({ setPage });
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /scene a/i }));
    fireEvent.click(screen.getByRole("button", { name: /configure in settings/i }));

    expect(localStorage.getItem("rushlink-settings-tab")).toBe("midi");
    expect(setPage).toHaveBeenCalledWith("settings");
  });

  it("shows a missing block-assignment warning when a block control has no attached rig", () => {
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /drive velvet drive/i }));
    expect(screen.getByText(/attach a rig to this stage before choosing an effect block/i)).toBeInTheDocument();
  });

  it("renders deck-only editors for a multi-button drummer and updates its assignments", () => {
    const deck = { ...structuredClone(actionPalette.find((item) => item.group === "Drum decks" && item.widgetLayout === "2x2")!), id: "drum-deck" } as LiveButton;
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [deck, ...Array(11).fill(null)] };
    useAppStore.setState(stageState(layout));
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("group", { name: deck.label }));

    expect(screen.getByText(/button layout .* maximum size/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/button \d assignment/i)).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /save as reusable control/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Button 1 assignment"), { target: { value: "outro" } });
    expect(useAppStore.getState().liveLayout.buttons[0]?.widgetActions?.[0]).toBe("outro");
  });

  it("edits every compatible multifunction gesture and its hold threshold", () => {
    const multifunction = { ...structuredClone(actionPalette.find((item) => item.label === "MULTIFUNCTION")!), id: "multi-editor" } as LiveButton;
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [multifunction, ...Array(11).fill(null)] };
    useAppStore.setState(stageState(layout));
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(document.querySelector<HTMLElement>('[data-button-id="multi-editor"]')!);

    fireEvent.change(screen.getByLabelText("TAP action"), { target: { value: "scene" } });
    fireEvent.change(screen.getByLabelText("TAP target"), { target: { value: "F" } });
    fireEvent.change(screen.getByLabelText("HOLD action"), { target: { value: "tuner" } });
    fireEvent.change(screen.getByLabelText("HOLD target"), { target: { value: "mute" } });
    fireEvent.change(screen.getByLabelText("DOUBLE action"), { target: { value: "rig-next" } });
    fireEvent.change(screen.getByLabelText(/Hold threshold/i), { target: { value: "900" } });

    expect(useAppStore.getState().liveLayout.buttons[0]).toMatchObject({
      tapBinding: { action: "scene", target: "F", label: expect.stringMatching(/Scene F/i) },
      holdBinding: { action: "tuner", target: "mute" },
      doubleBinding: { action: "rig-next" },
      holdMs: 900,
    });

    fireEvent.change(screen.getByLabelText("DOUBLE action"), { target: { value: "" } });
    expect(useAppStore.getState().liveLayout.buttons[0]?.doubleBinding).toBeUndefined();
  });

  it("learns a MIDI input message for the selected control and ignores its release", async () => {
    let receive: Parameters<typeof midiConnection.subscribeMessages>[0] | undefined;
    const midiSnapshot = { inputs: [], inputId: "all", bleDeviceName: "", enabled: true, connecting: false, ready: true, status: "Ready" };
    vi.spyOn(midiConnection, "getSnapshot").mockReturnValue(midiSnapshot);
    vi.spyOn(midiConnection, "autoConnect").mockResolvedValue(null);
    vi.spyOn(midiConnection, "subscribeMessages").mockImplementation((listener) => { receive = listener; return () => undefined; });
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /scene a/i }));
    fireEvent.click(screen.getByRole("button", { name: /midi learn/i }));

    act(() => receive?.({ type: "note", channel: 2, number: 60, value: 99, released: true }, "midi:keyboard"));
    expect(useAppStore.getState().liveLayout.buttons.find((button) => button?.id === "live-5")?.midi.type).toBe("cc");
    act(() => receive?.({ type: "note", channel: 2, number: 60, value: 99, released: false }, "midi:keyboard"));

    expect(useAppStore.getState().liveLayout.buttons.find((button) => button?.id === "live-5")?.midi).toMatchObject({ type: "note", channel: 2, number: 60, value: 99, releaseValue: 0 });
    expect(screen.getByRole("button", { name: /Learned NOTE 60/i })).toBeInTheDocument();
    expect(screen.getByText(/Learned from keyboard/i)).toBeInTheDocument();
  });

  it("saves, favourites, and removes a reusable control through the catalogue UI", () => {
    render(<LivePlayPage/>);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /scene a/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as reusable control/i }));
    const saveDialog = screen.getByRole("dialog", { name: /save reusable control/i });
    const name = within(saveDialog).getByLabelText("Preset name");
    fireEvent.change(name, { target: { value: "Lead recall" } });
    fireEvent.keyDown(name, { key: "Enter" });

    expect(useAppStore.getState().liveControlPresets).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /add control/i }));
    const catalogue = screen.getByRole("dialog", { name: /add stagehand control/i });
    fireEvent.click(within(catalogue).getByRole("tab", { name: /My controls/i }));
    fireEvent.click(within(catalogue).getByRole("button", { name: /Add Lead recall to favourites/i }));
    expect(useAppStore.getState().favoriteLiveControlKeys).toHaveLength(1);
    fireEvent.click(within(catalogue).getByRole("button", { name: /Delete saved control Lead recall/i }));
    expect(useAppStore.getState().liveControlPresets).toEqual([]);
    expect(useAppStore.getState().favoriteLiveControlKeys).toEqual([]);
  });

  it("moves an unlocked control with the real pointer drag lifecycle", () => {
    const { container } = render(<LivePlayPage/>);
    openEditor();
    const source = container.querySelector<HTMLElement>('[data-live-index="0"]')!;
    const target = container.querySelector<HTMLElement>('[data-live-index="1"]')!;
    const before = useAppStore.getState().liveLayout.buttons.slice(0, 2).map((button) => button?.id);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => target) });
    const emit = (type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) => {
      const event = createEvent[type](source, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 4 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      fireEvent(source, event);
    };

    emit("pointerDown", 10, 10);
    emit("pointerMove", 40, 40);
    expect(target).toHaveClass("drag-over");
    emit("pointerUp", 40, 40);

    expect(useAppStore.getState().liveLayout.buttons.slice(0, 2).map((button) => button?.id)).toEqual([before[1], before[0]]);
    Reflect.deleteProperty(document, "elementFromPoint");
  });
});
