import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Parameter } from "../../domain/types";
import { deviceApi } from "../../services/device-api";
import { DeviceFileControl } from "./device-file-control";

const original = "Neural Amp Modeler/User/A.nam";
const alternate = "Neural Amp Modeler/User/B.nam";
const parameter: Parameter = {
  id: "LoadedClone",
  sourceProperty: "LoadedClone",
  label: "NAM profile",
  value: original,
  rawValue: original,
  deviceFile: { fileType: 9, startPath: "Neural Amp Modeler" },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockCatalogue() {
  return vi.spyOn(deviceApi, "listDeviceFiles").mockImplementation(async (_path, kind) => kind === "folders" ? [] : ["A.nam", "B.nam"]);
}

describe("HeadRush device file control", () => {
  it("auditions a clicked file and restores the opening value when cancelled", async () => {
    mockCatalogue();
    const onPreview = vi.fn(async () => undefined);
    const onChange = vi.fn();
    const { container } = render(<DeviceFileControl parameter={parameter} onPreview={onPreview} onChange={onChange} />);

    expect(container.querySelector(".device-file-control--loaded")).toHaveAttribute("data-current-file", original);
    expect(screen.getByText("A.nam")).toBeInTheDocument();
    expect(screen.getByText(/Loaded on HeadRush/i)).toBeInTheDocument();
    expect(screen.getByText("Change file")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /NAM profile.*A\.nam/i }));
    fireEvent.click(await screen.findByRole("button", { name: /B\.nam/i }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(alternate));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(original));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("presents a clear empty state when no device file is selected", () => {
    const { container } = render(<DeviceFileControl parameter={{ ...parameter, value: "" }} onChange={vi.fn()} />);
    expect(container.querySelector(".device-file-control--empty")).toBeInTheDocument();
    expect(screen.getByText("Choose a compatible device file")).toBeInTheDocument();
    expect(screen.getByText("Browse files")).toBeInTheDocument();
  });

  it("keeps an auditioned file only after confirmation", async () => {
    mockCatalogue();
    const onPreview = vi.fn(async () => undefined);
    const onChange = vi.fn();
    render(<DeviceFileControl parameter={parameter} onPreview={onPreview} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /NAM profile.*A\.nam/i }));
    fireEvent.click(await screen.findByRole("button", { name: /B\.nam/i }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(alternate));
    fireEvent.click(screen.getByRole("button", { name: "Use selected file" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(alternate));
    expect(onPreview).not.toHaveBeenCalledWith(original);
  });

  it("cycles through sibling files with icon controls", async () => {
    mockCatalogue();
    const onChange = vi.fn();
    const { rerender } = render(<DeviceFileControl parameter={parameter} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Next NAM profile" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(alternate));

    rerender(<DeviceFileControl parameter={{ ...parameter, value: alternate }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous NAM profile" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(original));
  });
});
