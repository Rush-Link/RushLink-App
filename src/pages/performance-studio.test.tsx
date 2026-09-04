import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs } from "../data/demo-data";
import type { HeadRushObject, HeadRushSubtree } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { PerformanceToolsPage } from "./performance-studio";

const DRUMS = "/Evil/Engine/DrumsCtrl";
const FFT = "/Evil/Engine/FFTCtrl";
const TUNER_INPUT = "/Evil/Engine/AudioCtrl/Input";
const TUNER = "/Evil/Engine/AudioCtrl/Tuner";
const MAIN_EQ = "/Evil/Engine/GlobalEQMain";
const AMP_EQ = "/Evil/Engine/GlobalEQAmp";

function reflected(value: Record<string, unknown>, defaults: Record<string, unknown> = {}): HeadRushObject {
  return {
    value,
    meta: { properties: Object.fromEntries(Object.keys(value).map((property) => [property, {
      type: typeof value[property] === "boolean" ? "boolean" : typeof value[property] === "number" ? "number" : "string",
      minimum: typeof value[property] === "number" ? 0 : undefined,
      maximum: typeof value[property] === "number" ? 1 : undefined,
      "x-options": property in defaults ? { default: defaults[property] } : undefined,
    }])) },
  };
}

function performanceTree(): HeadRushSubtree {
  const drums = reflected({
    isPlaying: false, isMuted: false, isFillEngaged: false, currentBar: -1, currentBeat: -1,
    StyleVari: "Studio Rock", Kit: "Maple", Tempo: .5, Vol: .7, Intensity: .5, LoadedPreset: "Studio",
    Fill1Alwd: true, Fill2Alwd: false, Fill3Alwd: true, Fill4Alwd: true, Fill5Alwd: false, Fill6Alwd: true, Fill7Alwd: true, Fill8Alwd: true,
  });
  const eqDefaults = { On: false, MasterGain: .5, Freq1: .25, Gain1: .5, Q1: .5 };
  return {
    [DRUMS]: drums,
    [FFT]: reflected({ TunerString: "A", TunerCents: .5, TunerLow: false, TunerRef: 440 }),
    [TUNER_INPUT]: reflected({ TunerOn: false }),
    [TUNER]: reflected({ TunerMuting: false }),
    [MAIN_EQ]: reflected({ On: false, MasterGain: .5, Freq1: .25, Gain1: .5, Q1: .5 }, eqDefaults),
    [AMP_EQ]: reflected({ On: true, MasterGain: .5, Freq1: .25, Gain1: .5, Q1: .5 }, eqDefaults),
  };
}

describe("Performance Tools device workflows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      device: { ...demoDevice, status: "ready" }, rigs: structuredClone(demoRigs), selectedRigId: demoRigs[0].id,
      liveSubtree: performanceTree(), liveSnapshot: null, connectionBusy: false, syncBusy: false,
      performanceTunerActive: false, lastSyncSource: "websocket",
    });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
    vi.spyOn(deviceApi, "callMethod").mockImplementation(async (_path, method) => ({
      status: 200,
      body: method === "presets" ? { methodReturnValue: JSON.stringify(["Studio", "Live Rock"]) } : {},
    }));
    vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
  });
  afterEach(cleanup);

  it("opens and closes the device drum page and discovers presets", async () => {
    const call = vi.mocked(deviceApi.callMethod);
    const { unmount } = render(<PerformanceToolsPage/>);
    await waitFor(() => expect(call).toHaveBeenCalledWith(DRUMS, "drumsPageOpened"));
    expect(call).toHaveBeenCalledWith(DRUMS, "presets");
    await waitFor(() => expect(screen.getByRole("button", { name: /Presets 2/i })).toBeInTheDocument());
    unmount();
    expect(call).toHaveBeenCalledWith(DRUMS, "drumsPageClosed");
  });

  it("sends the complete drummer performance command set with visible phrase feedback", async () => {
    const call = vi.mocked(deviceApi.callMethod);
    const tree = performanceTree();
    const drums = tree[DRUMS];
    if (!drums?.value) throw new Error("Performance fixture is missing the drum controller");
    drums.value.isPlaying = true;
    useAppStore.setState({ liveSubtree: tree });
    render(<PerformanceToolsPage/>);
    fireEvent.click(screen.getByRole("button", { name: "Pause drummer" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    fireEvent.click(screen.getByRole("button", { name: /^Fill\b/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Bridge\b/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Outro\b/i }));
    const accent = screen.getByRole("button", { name: /Accent/i });
    fireEvent.keyDown(accent, { key: "Enter" });
    fireEvent.keyUp(accent, { key: "Enter" });

    await waitFor(() => {
      for (const method of ["togglePlay", "restart", "toggleMute", "playFill", "playBridge", "playOutro", "playAccent", "stopAccent"])
        expect(call).toHaveBeenCalledWith(DRUMS, method, []);
    });
    expect(screen.getByText(/Accent released/i)).toBeInTheDocument();
  });

  it("creates, loads, renames, and deletes drummer presets deliberately", async () => {
    const call = vi.mocked(deviceApi.callMethod);
    render(<PerformanceToolsPage/>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Presets 2/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Presets 2/i }));
    const dialog = screen.getByRole("dialog", { name: "Drummer presets" });
    fireEvent.click(within(dialog).getByRole("option", { name: /Live Rock/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Load preset" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(DRUMS, "loadPreset", ["Live Rock"]));

    fireEvent.click(screen.getByRole("button", { name: /Presets 2/i }));
    const reopened = screen.getByRole("dialog", { name: "Drummer presets" });
    fireEvent.change(within(reopened).getByLabelText("New drummer preset name"), { target: { value: "  QA Groove  " } });
    fireEvent.click(within(reopened).getByRole("button", { name: "Create preset" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(DRUMS, "createPreset", ["QA Groove"]));

    fireEvent.click(within(reopened).getByRole("option", { name: /Studio/i }));
    fireEvent.change(within(reopened).getByPlaceholderText("Preset name"), { target: { value: "Studio Updated" } });
    fireEvent.click(within(reopened).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(DRUMS, "renamePreset", ["Studio", "Studio Updated"]));
    fireEvent.click(within(reopened).getByRole("button", { name: /Delete selected preset/i }));
    fireEvent.click(within(reopened).getByRole("button", { name: "Delete preset" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(DRUMS, "deletePreset", ["Studio"]));
  });

  it("controls tuner mode, reference and mute, reverting a rejected mute", async () => {
    const start = vi.spyOn(deviceApi, "setDeviceTuner").mockResolvedValue();
    vi.spyOn(deviceApi, "tunerValues").mockResolvedValue({ TunerString: "A", TunerCents: .5, TunerLow: false, TunerRef: 440 });
    const mute = vi.spyOn(deviceApi, "setTunerMuted").mockResolvedValueOnce(true);
    render(<PerformanceToolsPage/>);

    fireEvent.click(screen.getByRole("button", { name: /Open device tuner/i }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Bass" }));
    fireEvent.change(screen.getByRole("combobox", { name: /Reference/i }), { target: { value: "442" } });
    const muteSwitch = screen.getByRole("switch", { name: /Mute outputs/i });
    fireEvent.click(muteSwitch);
    await waitFor(() => expect(mute).toHaveBeenCalledWith(true));
    await waitFor(() => expect(muteSwitch).toBeChecked());
    expect(deviceApi.setProperties).toHaveBeenCalledWith(FFT, { TunerLow: true });
    expect(deviceApi.setProperties).toHaveBeenCalledWith(FFT, { TunerRef: 442 });

    vi.mocked(deviceApi.setTunerMuted).mockResolvedValueOnce(true);
    fireEvent.click(muteSwitch);
    await waitFor(() => expect(screen.getByText(/pedal reported tuner mute as on/i)).toBeInTheDocument());
    expect(muteSwitch).toBeChecked();
  });

  it("toggles and resets both global EQ targets using their supported device APIs", async () => {
    const call = vi.mocked(deviceApi.callMethod);
    const set = vi.mocked(deviceApi.setProperties);
    render(<PerformanceToolsPage/>);

    fireEvent.click(screen.getByRole("button", { name: /Bypassed/i }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(MAIN_EQ, { On: true }));
    fireEvent.click(screen.getByRole("button", { name: /Reset flat/i }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(MAIN_EQ, "reset"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Reset flat/i })).not.toBeDisabled());

    const ampTab = screen.getByRole("tab", { name: "Amp output" });
    fireEvent.mouseDown(ampTab, { button: 0 });
    fireEvent.click(ampTab);
    await waitFor(() => expect(ampTab).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("button", { name: /Reset flat/i }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(AMP_EQ, expect.objectContaining({ On: false, MasterGain: .5 })));
  });

  it("supports keyboard navigation across drummer workspaces", () => {
    render(<PerformanceToolsPage/>);
    const groove = screen.getByRole("tab", { name: /Groove/i });
    fireEvent.keyDown(groove, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Kit Balance/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Kit Balance/i }), { key: "End" });
    expect(screen.getByRole("tab", { name: /Performance Fills/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Performance Fills/i }), { key: "Home" });
    expect(groove).toHaveAttribute("aria-selected", "true");
  });

  it("filters presets and supports the documented double-click load shortcut", async () => {
    const call = vi.mocked(deviceApi.callMethod);
    render(<PerformanceToolsPage/>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Presets 2/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Presets 2/i }));
    const dialog = screen.getByRole("dialog", { name: "Drummer presets" });
    fireEvent.change(within(dialog).getByLabelText("Find drummer preset"), { target: { value: "absent" } });
    expect(within(dialog).getByText("No matching presets on the device.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Find drummer preset"), { target: { value: "live" } });
    fireEvent.doubleClick(within(dialog).getByRole("option", { name: /Live Rock/i }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(DRUMS, "loadPreset", ["Live Rock"]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Drummer presets" })).not.toBeInTheDocument());
  });

  it("surfaces rejected drum commands and EQ writes without leaving controls busy", async () => {
    vi.mocked(deviceApi.callMethod).mockImplementation(async (_path, method) => {
      if (method === "togglePlay") throw new Error("drum engine refused the command");
      return { status: 200, body: method === "presets" ? { methodReturnValue: "[]" } : {} };
    });
    const set = vi.mocked(deviceApi.setProperties);
    render(<PerformanceToolsPage/>);

    fireEvent.click(screen.getByRole("button", { name: "Play drummer" }));
    await waitFor(() => expect(screen.getByText(/drum engine refused the command/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Play drummer" })).not.toBeDisabled();

    set.mockRejectedValueOnce(new Error("global EQ write rejected"));
    fireEvent.keyDown(screen.getByRole("slider", { name: /Gain1,/i }), { key: "ArrowUp" });
    await waitFor(() => expect(screen.getByText(/global EQ write rejected/i)).toBeInTheDocument());
  });
});
