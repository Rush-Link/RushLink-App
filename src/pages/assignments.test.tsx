import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs } from "../data/demo-data";
import type { HeadRushObject, HeadRushSubtree } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { FootswitchAssignmentsPanel, SceneAssignmentsPanel } from "./assignments";

const FOOTSWITCH = "/Evil/Engine/FootSwitch";
const CHAIN = "/Evil/Engine/Patch/Chain";

function object(value: Record<string, unknown>): HeadRushObject {
  return { value, meta: { properties: {} } };
}

function assignmentTree(): HeadRushSubtree {
  const fs: Record<string, unknown> = {
    LastScene: 0,
    AnySwitchDoubling: true,
    ScenePathSwitch1: 0,
    SceneExtAmp1: 0,
  };
  for (let number = 1; number <= 6; number += 1) {
    Object.assign(fs, {
      [`ModeNew${number}`]: number === 2 ? 2 : 0,
      [`Module${number}`]: number === 1 ? "Unassigned" : "Velvet Drive",
      [`Operation${number}`]: number === 1 ? "" : "Bypass",
      [`FootSwitchText${number}`]: number === 1 ? "LEAD" : `SCENE ${"ABCDEF"[number - 1]}`,
      [`FootSwitchTextEditable${number}`]: true,
      [`FootSwitchColour${number}`]: number,
      [`FootSwitchOn${number}`]: true,
      [`ModuleList${number}`]: ["Unassigned", "Velvet Drive", "Quarter Echo", "Tuner"],
      [`SceneNumberOfStates${number}`]: 1,
      [`SceneState${number}`]: 0,
      [`MacroColour${number}`]: number,
    });
    for (let slot = 1; slot <= 14; slot += 1) fs[`Scene${number}_${slot}_Mode`] = 0;
  }
  return { [FOOTSWITCH]: object(fs), [CHAIN]: object({ Routing: 2 }) };
}

describe("hardware assignment device workflows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      device: { ...demoDevice, status: "ready" },
      rigs: structuredClone(demoRigs),
      selectedRigId: demoRigs[0].id,
      liveSubtree: assignmentTree(),
      liveSnapshot: null,
      page: "assignments",
      diagnostics: [],
    });
    vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "footswitchOperations").mockResolvedValue([{ label: "Bypass", isDisabled: false }]);
    vi.spyOn(deviceApi, "blockPresets").mockResolvedValue(["Crunch", "Solo"]);
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
  });
  afterEach(cleanup);

  it("writes enable, behavior, editable label, and assignment order changes to the device", async () => {
    const set = vi.mocked(deviceApi.setProperties);
    const call = vi.mocked(deviceApi.callMethod);
    render(<FootswitchAssignmentsPanel/>);

    fireEvent.click(screen.getByRole("switch", { name: "Enable switch 1" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { FootSwitchOn1: false }));
    const behavior = screen.getByRole("radiogroup", { name: "Switch 1 behavior" });
    fireEvent.click(within(behavior).getByRole("radio", { name: "Hold" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { ModeNew1: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /LEAD/i }));
    const label = screen.getByRole("textbox", { name: "Switch 1 label" });
    fireEvent.change(label, { target: { value: "solo boost" } });
    fireEvent.blur(label);
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { UserFootSwitchText1: "SOLO BOOST" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Move assignment right" })[0]);

    await waitFor(() => {
      expect(set).toHaveBeenCalledWith(FOOTSWITCH, { UserFootSwitchText1: "SOLO BOOST" });
      expect(call).toHaveBeenCalledWith(FOOTSWITCH, "moveAssignment", [0, 1]);
    });
  });

  it("filters device targets and commits the only supported operation automatically", async () => {
    const set = vi.mocked(deviceApi.setProperties);
    render(<FootswitchAssignmentsPanel/>);
    fireEvent.click(screen.getByRole("button", { name: /Assign an action/i }));
    fireEvent.change(screen.getByPlaceholderText(/Find an effect or utility/i), { target: { value: "velvet" } });
    expect(screen.queryByRole("button", { name: /Quarter Echo/i })).not.toBeInTheDocument();
    const picker = document.querySelector(".assignment-picker");
    expect(picker).not.toBeNull();
    fireEvent.click(within(picker as HTMLElement).getByRole("button", { name: /Velvet Drive/i }));

    await waitFor(() => expect(deviceApi.footswitchOperations).toHaveBeenCalledWith(0, "Velvet Drive"));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { Module1: "Velvet Drive", Operation1: "Bypass" }));
    expect(screen.queryByText(/What should Velvet Drive do/i)).not.toBeInTheDocument();
  });

  it("clears an assignment atomically and writes the selected hardware LED color", async () => {
    const set = vi.mocked(deviceApi.setProperties);
    render(<FootswitchAssignmentsPanel/>);
    fireEvent.click(screen.getByRole("button", { name: /Assign an action/i }));
    fireEvent.click(screen.getByRole("button", { name: /Unassigned/i }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { Module1: "Unassigned", Operation1: "" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Choose LED color" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { FootSwitchColour1: 5 }));
  });

  it("recalls all six scenes with the correct zero-based device indexes", async () => {
    const set = vi.mocked(deviceApi.setProperties);
    render(<SceneAssignmentsPanel/>);
    const sceneTabs = within(screen.getByRole("tablist", { name: "Scenes" })).getAllByRole("tab");
    for (const [index, tab] of sceneTabs.entries()) {
      fireEvent.click(tab);
      fireEvent.click(screen.getByRole("button", { name: /Recall on device/i }));
      await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { LastScene: index, LastSceneState: 0 }));
    }
  });

  it("builds scene overrides from the current rig and can clear all fourteen slots", async () => {
    const set = vi.mocked(deviceApi.setProperties);
    render(<SceneAssignmentsPanel/>);
    fireEvent.click(screen.getByRole("button", { name: "Match rig" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, expect.objectContaining({
      Scene1_1_Mode: 1,
      Scene1_6_Mode: 2,
      Scene1_9_Mode: 1,
    })));
    const matched = set.mock.calls.find(([, properties]) => "Scene1_1_Mode" in properties)?.[1];
    expect(Object.keys(matched ?? {})).toHaveLength(demoRigs[0].blocks.length);

    fireEvent.click(screen.getByRole("button", { name: "Clear overrides" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, expect.objectContaining({ Scene1_1_Mode: 0, Scene1_14_Mode: 0 })));
    const cleared = set.mock.calls.find(([, properties]) => "Scene1_14_Mode" in properties)?.[1];
    expect(Object.keys(cleared ?? {})).toHaveLength(14);
  });

  it("creates a second scene state and stores its block preset independently", async () => {
    const set = vi.mocked(deviceApi.setProperties);
    render(<SceneAssignmentsPanel/>);
    fireEvent.click(screen.getByRole("button", { name: /Add B/i }));
    await waitFor(() => expect(deviceApi.callMethod).toHaveBeenCalledWith(FOOTSWITCH, "createNewSceneState", [0, 0]));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { SceneNumberOfStates1: 2, SceneState1: 1 }));

    const driveSlot = screen.getByText("Velvet Drive").closest(".visual-scene-slot");
    expect(driveSlot).not.toBeNull();
    fireEvent.click(within(driveSlot as HTMLElement).getByRole("button", { name: /No Preset/i }));
    await waitFor(() => expect(deviceApi.blockPresets).toHaveBeenCalledWith("Velvet Drive"));
    fireEvent.click(await screen.findByRole("button", { name: "Solo" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(FOOTSWITCH, { State2Scene1Slot3Preset: "Solo" }));
  });

  it("reports device write failures without leaving the assignment workflow", async () => {
    vi.mocked(deviceApi.setProperties).mockRejectedValueOnce(new Error("device rejected write"));
    render(<FootswitchAssignmentsPanel/>);
    fireEvent.click(screen.getByRole("switch", { name: "Enable switch 1" }));
    await waitFor(() => expect(useAppStore.getState().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", source: "Footswitches", message: "Could not update rig control assignment", detail: expect.stringContaining("device rejected write") }),
    ])));
    expect(screen.getByText("Footswitch assignment studio")).toBeInTheDocument();
  });
});
