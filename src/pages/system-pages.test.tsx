import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceApi } from "../services/device-api";
import { SettingsPage } from "./system-pages";

describe("MIDI settings transport boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("rushlink-settings-tab", "midi");
    vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: { methodReturnValue: "[]" } });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("defaults to input-only controller setup and keeps device MIDI output separate", async () => {
    render(<SettingsPage/>);

    expect(screen.getByText("RushLink input mapping")).toBeInTheDocument();
    expect(screen.getByText("External controller input")).toBeInTheDocument();
    expect(screen.queryByText("Rig MIDI Out messages")).not.toBeInTheDocument();
    expect(deviceApi.callMethod).not.toHaveBeenCalledWith("/Evil/Engine/MIDIOutCtrl", "presets", []);

    const deviceTab = screen.getByRole("tab", { name: "HeadRush hardware" });
    fireEvent.mouseDown(deviceTab, { button: 0, ctrlKey: false });

    await waitFor(() => expect(screen.getByText("These are HeadRush hardware settings")).toBeInTheDocument());
    expect(screen.getByText("Physical MIDI behaviour")).toBeInTheDocument();
    expect(screen.getByText("Rig MIDI Out messages")).toBeInTheDocument();
    expect(screen.queryByText("External controller input")).not.toBeInTheDocument();
    await waitFor(() => expect(deviceApi.callMethod).toHaveBeenCalledWith("/Evil/Engine/MIDIOutCtrl", "presets", []));
  });

  it("remembers the hardware view without presenting it as RushLink MIDI output", () => {
    localStorage.setItem("rushlink-midi-settings-view", "device");
    render(<SettingsPage/>);

    expect(screen.getByRole("tab", { name: "HeadRush hardware" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/The pedal—not RushLink—receives, forwards or sends/i)).toBeInTheDocument();
    expect(screen.queryByText("RushLink MIDI is input-only")).not.toBeInTheDocument();
  });
});
