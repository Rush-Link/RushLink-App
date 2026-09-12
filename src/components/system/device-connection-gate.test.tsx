import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice } from "../../data/demo-data";
import { deviceApi } from "../../services/device-api";
import { useAppStore } from "../../stores/app-store";
import { DeviceConnectionGate } from "./device-connection-gate";

function resetGate() {
  localStorage.clear();
  useAppStore.setState((state) => ({
    device: null,
    connectionBusy: false,
    connectionError: "The saved address did not answer.",
    preferences: { ...state.preferences, address: "headrushflexprime.local", autoDiscovery: false },
  }));
}

describe("device connection recovery", () => {
  beforeEach(resetGate);
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const openAdvanced = () => fireEvent.click(screen.getByRole("button", { name: /Check advanced settings/i }));

  it.each(["headrushflexprime.local", "headrushprime.local", "headrushcore.local"])("tries %s before offering the saved IP", async (modelAddress) => {
    const connect = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState(state => ({ connect, preferences: { ...state.preferences, address: "http://192.168.1.129", modelAddress, fallbackAddress: undefined } }));
    render(<DeviceConnectionGate/>);
    expect(screen.getByText(modelAddress)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Connect to your device" }));
    expect(connect).toHaveBeenLastCalledWith(modelAddress);
    openAdvanced();
    fireEvent.change(screen.getByRole("combobox", { name: "HeadRush model" }), { target: { value: "custom" } });
    expect(screen.getByRole("textbox", { name: "Custom HeadRush address" })).toHaveValue("http://192.168.1.129");
    fireEvent.click(screen.getByRole("button", { name: "Connect to your device" }));
    expect(connect).toHaveBeenLastCalledWith("http://192.168.1.129");
  });

  it("explains an empty discovery result and leaves manual recovery available", async () => {
    vi.spyOn(deviceApi, "discover").mockResolvedValue([]);
    render(<DeviceConnectionGate/>);
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /Scan network/i }));
    expect(await screen.findByText("No HeadRush device answered on this network.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "HeadRush model" })).toBeEnabled();
  });

  it("turns a rejected discovery request into a safe, readable recovery message", async () => {
    vi.spyOn(deviceApi, "discover").mockRejectedValue(new Error("mDNS permission denied"));
    render(<DeviceConnectionGate/>);
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /Scan network/i }));
    expect(await screen.findByText(/HeadRush is not reachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/mDNS permission denied/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scan network/i })).toBeEnabled();
  });

  it("connects directly to a discovered unit and persists its exact host", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ connect });
    vi.spyOn(deviceApi, "discover").mockResolvedValue([{ ...demoDevice, name: "Rehearsal Flex", host: "192.168.1.129" }]);
    render(<DeviceConnectionGate/>);
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /Scan network/i }));
    const result = await screen.findByRole("button", { name: /Rehearsal Flex/i });
    fireEvent.click(result);
    await waitFor(() => expect(connect).toHaveBeenCalledWith("192.168.1.129"));
    expect(useAppStore.getState().preferences.address).toBe("192.168.1.129");
  });

  it("updates the visible target when persisted preferences change externally", async () => {
    render(<DeviceConnectionGate/>);
    expect(screen.getAllByText("headrushflexprime.local").length).toBeGreaterThan(0);
    act(() => {
      useAppStore.getState().setPreference("address", "headrushcore.local");
    });
    await waitFor(() => expect(screen.getByText("HeadRush Core")).toBeInTheDocument());
    expect(screen.getAllByText("headrushcore.local").length).toBeGreaterThan(0);
  });
});
