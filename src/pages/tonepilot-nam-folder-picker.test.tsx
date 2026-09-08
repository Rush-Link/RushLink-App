import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceApi } from "../services/device-api";
import { TonePilotNamFolderPicker } from "./tonepilot-nam-folder-picker";

const NAM_ROOT = "Neural Amp Modeler";
const USER_FOLDER = `${NAM_ROOT}/User`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("TonePilotNamFolderPicker", () => {
  beforeEach(() => {
    vi.spyOn(deviceApi, "listDeviceFiles").mockResolvedValue([]);
  });

  it("opens the provided User destination and only commits a verified folder", async () => {
    const listing = deferred<string[]>();
    vi.mocked(deviceApi.listDeviceFiles).mockReturnValueOnce(listing.promise);
    const onChange = vi.fn();
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={onChange}/>);

    expect(screen.getByLabelText("NAM destination folder")).toHaveTextContent(USER_FOLDER);
    expect(deviceApi.listDeviceFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(deviceApi.listDeviceFiles).toHaveBeenCalledWith(USER_FOLDER, "folders");
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { listing.resolve([]); });

    expect(screen.getByText("No subfolders")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(USER_FOLDER);
    expect(screen.queryByRole("region", { name: "Choose NAM destination folder" })).not.toBeInTheDocument();
  });

  it("lets the user browse multiple subfolders before selecting a destination", async () => {
    vi.mocked(deviceApi.listDeviceFiles).mockImplementation(async (path) => {
      if (path === USER_FOLDER) return ["Amps"];
      if (path === `${USER_FOLDER}/Amps`) return ["Clean"];
      return [];
    });
    const onChange = vi.fn();
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={onChange}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open NAM folder Amps" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open NAM folder Clean" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    expect(deviceApi.listDeviceFiles).toHaveBeenLastCalledWith(`${USER_FOLDER}/Amps/Clean`, "folders");
    expect(screen.getByLabelText("NAM destination folder")).toHaveTextContent(USER_FOLDER);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(`${USER_FOLDER}/Amps/Clean`);
  });

  it("clamps invalid destinations to NAM and never navigates above its root", async () => {
    render(<TonePilotNamFolderPicker value="Neural Amp Modeler/../../Rigs" onChange={vi.fn()}/>);
    expect(screen.getByLabelText("NAM destination folder")).toHaveTextContent(NAM_ROOT);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());

    expect(deviceApi.listDeviceFiles).toHaveBeenCalledExactlyOnceWith(NAM_ROOT, "folders");
    const up = screen.getByRole("button", { name: "Up to parent NAM folder" });
    expect(up).toBeDisabled();
    fireEvent.click(up);
    expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(1);
  });

  it("returns to User and the NAM root using the parent and breadcrumb controls", async () => {
    render(<TonePilotNamFolderPicker value={`${USER_FOLDER}/Amps/Clean`} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Up to parent NAM folder" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Up to parent NAM folder" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    expect(deviceApi.listDeviceFiles).toHaveBeenLastCalledWith(`${USER_FOLDER}/Amps`, "folders");

    const location = screen.getByRole("navigation", { name: "NAM folder location" });
    fireEvent.click(within(location).getByRole("button", { name: "User" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    expect(deviceApi.listDeviceFiles).toHaveBeenLastCalledWith(USER_FOLDER, "folders");
    fireEvent.click(within(location).getByRole("button", { name: NAM_ROOT }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    expect(deviceApi.listDeviceFiles).toHaveBeenLastCalledWith(NAM_ROOT, "folders");
    expect(screen.getByRole("button", { name: "Up to parent NAM folder" })).toBeDisabled();
  });

  it("cancels browsing without changing the destination and reopens the selected folder", async () => {
    vi.mocked(deviceApi.listDeviceFiles).mockResolvedValueOnce(["Amps"]);
    const onChange = vi.fn();
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={onChange}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open NAM folder Amps" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("NAM destination folder")).toHaveTextContent(USER_FOLDER);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    expect(deviceApi.listDeviceFiles).toHaveBeenLastCalledWith(USER_FOLDER, "folders");
  });

  it("keeps an unreadable destination unselectable and retries that folder", async () => {
    vi.mocked(deviceApi.listDeviceFiles)
      .mockRejectedValueOnce(new Error("HeadRush is busy"))
      .mockResolvedValueOnce(["Clean"]);
    const onChange = vi.fn();
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={onChange}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HeadRush is busy");
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry folder listing" }));

    expect(await screen.findByRole("button", { name: "Open NAM folder Clean" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(deviceApi.listDeviceFiles).toHaveBeenNthCalledWith(2, USER_FOLDER, "folders");
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
  });

  it("ignores a cancelled request that completes after a new browser session", async () => {
    const staleListing = deferred<string[]>();
    vi.mocked(deviceApi.listDeviceFiles)
      .mockReturnValueOnce(staleListing.promise)
      .mockResolvedValueOnce(["Current"]);
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByRole("button", { name: "Open NAM folder Current" })).toBeInTheDocument();

    await act(async () => { staleListing.resolve(["Obsolete"]); });

    expect(screen.getByRole("button", { name: "Open NAM folder Current" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open NAM folder Obsolete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
  });

  it("ignores a late failure from a cancelled request", async () => {
    const staleListing = deferred<string[]>();
    vi.mocked(deviceApi.listDeviceFiles)
      .mockReturnValueOnce(staleListing.promise)
      .mockResolvedValueOnce([]);
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Close browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled());
    await act(async () => { staleListing.reject(new Error("Expired request")); });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
  });

  it("ignores returned parents, siblings, and paths outside NAM while accepting direct children", async () => {
    vi.mocked(deviceApi.listDeviceFiles).mockResolvedValueOnce([
      "..", "../Tone 3000", "../../Rigs", "../../../Outside",
      `${NAM_ROOT}/Tone 3000`, "Amps/Too deep", "Clean", "clean",
      `${USER_FOLDER}/Lead`, "Neural Amp Modeler\\User\\Bass",
    ]);
    render(<TonePilotNamFolderPicker value={USER_FOLDER} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByRole("button", { name: "Open NAM folder Lead" })).toBeInTheDocument();

    const folders = screen.getAllByRole("button", { name: /^Open NAM folder / });
    expect(folders).toHaveLength(3);
    expect(folders.map((folder) => folder.getAttribute("aria-label"))).toEqual([
      "Open NAM folder Bass", "Open NAM folder clean", "Open NAM folder Lead",
    ]);
    expect(deviceApi.listDeviceFiles).toHaveBeenCalledExactlyOnceWith(USER_FOLDER, "folders");
  });
});
