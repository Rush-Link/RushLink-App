import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadRushObject } from "../../domain/types";
import { deviceApi } from "../../services/device-api";
import { useAppStore } from "../../stores/app-store";
import { ReflectionEditor } from "./reflection-editor";

const PATH = "/Evil/Engine/Test";

function reflected(): HeadRushObject {
  return {
    value: { Gain: .25, On: false, ReadOnlyValue: 9 },
    meta: { properties: {
      Gain: { type: "number", minimum: 0, maximum: 1 },
      On: { type: "boolean" },
      ReadOnlyValue: { type: "number", readOnly: true },
    } },
  };
}

describe("ReflectionEditor device writes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({ diagnostics: [] });
    vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
  });
  afterEach(cleanup);

  it("debounces rapid numeric edits and commits only the final value", async () => {
    render(<ReflectionEditor path={PATH} object={reflected()} include={["Gain"]} columns="compact" refreshPage="tools"/>);
    const gain = screen.getByRole("slider", { name: "Gain" });
    fireEvent.change(gain, { target: { value: ".4" } });
    fireEvent.change(gain, { target: { value: ".7" } });
    expect(screen.getByText("0.7")).toBeInTheDocument();
    await waitFor(() => expect(deviceApi.setProperties).toHaveBeenCalledWith(PATH, { Gain: .7 }), { timeout: 800 });
    expect(deviceApi.setProperties).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().refreshPage).toHaveBeenCalledWith("tools", "manual");
  });

  it("commits boolean controls immediately and removes optimistic state after refresh", async () => {
    render(<ReflectionEditor path={PATH} object={reflected()} include={["On"]} labels={{ On: "Engine power" }}/>);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(deviceApi.setProperties).toHaveBeenCalledWith(PATH, { On: true }));
    await waitFor(() => expect(screen.getByText("Bypassed")).toBeInTheDocument());
  });

  it("rolls back a rejected write and records an actionable diagnostic", async () => {
    vi.mocked(deviceApi.setProperties).mockRejectedValueOnce(new Error("write denied"));
    render(<ReflectionEditor path={PATH} object={reflected()} include={["On"]} labels={{ On: "Engine power" }}/>);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(useAppStore.getState().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", source: "Device editor", message: "Could not update Engine power", detail: expect.stringContaining("write denied") }),
    ])));
    expect(screen.getByText("Bypassed")).toBeInTheDocument();
  });

  it("invokes reflected reset methods and refreshes the requested workspace", async () => {
    render(<ReflectionEditor path={PATH} object={reflected()} include={["Gain"]} resetMethod="reset" refreshPage="settings"/>);
    fireEvent.click(screen.getByRole("button", { name: /Reset to device defaults/i }));
    await waitFor(() => expect(deviceApi.callMethod).toHaveBeenCalledWith(PATH, "reset"));
    expect(useAppStore.getState().refreshPage).toHaveBeenCalledWith("settings", "manual");
  });

  it("renders a contextual empty state when firmware exposes no writable controls", () => {
    render(<ReflectionEditor path={PATH} object={reflected()} include={["ReadOnlyValue"]} emptyText="No supported controls here."/>);
    expect(screen.getByText("No supported controls here.")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
