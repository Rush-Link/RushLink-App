import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice } from "../data/demo-data";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { FILE_AREAS, LibraryBackupPage } from "./library-backup";

describe("Library device index", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ device: { ...demoDevice, status: "ready" } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses the firmware file categories and excludes an unsupported drum preset type", () => {
    expect(FILE_AREAS).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "Neural Amp Modeler", kind: "nam" }),
      expect.objectContaining({ path: "Amp Clones", kind: "amp-clone" }),
      expect.objectContaining({ path: "SuperClones", kind: "superclone" }),
      expect.objectContaining({ path: "Reverbs", kind: "reverb" }),
      expect.objectContaining({ path: "Settings/MIDI Out Messages", kind: "midi-preset" }),
    ]));
    expect(FILE_AREAS.some((area) => area.path === "Drum Machine")).toBe(false);
  });

  it("keeps the NAM filter when navigating into a folder and exposes returned files", async () => {
    const listing = vi.spyOn(deviceApi, "listDeviceDirectory").mockImplementation(async (path, kind) => {
      if (path === "Neural Amp Modeler/User") return {
        path, folders: [], files: [{ name: "Chug.nam", type: "file" }], entries: [{ name: "Chug.nam", type: "file" }],
      };
      return {
        path: "Neural Amp Modeler", folders: [{ name: "User", type: "folder" }], files: [], entries: [{ name: "User", type: "folder" }],
      };
    });

    const { container } = render(<LibraryBackupPage/>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Device index/i }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "NAM" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /User/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /User/ }));

    await waitFor(() => expect(screen.getByText("Chug.nam")).toBeInTheDocument());
    expect(listing).toHaveBeenNthCalledWith(1, "Neural Amp Modeler", "nam");
    expect(listing).toHaveBeenNthCalledWith(2, "Neural Amp Modeler/User", "nam");
    expect(container.querySelector(".device-entry-grid button.file")).toBeDisabled();
    expect(screen.getByText("0 folders · 1 file")).toBeInTheDocument();
  });

  it("presents an actionable, contextual empty directory state", async () => {
    const listing = vi.spyOn(deviceApi, "listDeviceDirectory").mockResolvedValue({
      path: "Neural Amp Modeler/User", folders: [], files: [], entries: [],
    });
    const { container } = render(<LibraryBackupPage/>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Device index/i }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "NAM" }));

    await waitFor(() => expect(screen.getByText("No nam models found")).toBeInTheDocument());
    expect(container.querySelector(".device-index-empty")).toBeInTheDocument();
    expect(container.querySelector(".device-index-empty__path code")).toHaveTextContent("Neural Amp Modeler/User");
    expect(container.querySelector(".device-index-empty__filter")).toHaveTextContent("NAM models");
    expect(screen.getByRole("button", { name: "Parent folder" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    await waitFor(() => expect(listing).toHaveBeenLastCalledWith("Neural Amp Modeler/User", "all"));
  });
});
