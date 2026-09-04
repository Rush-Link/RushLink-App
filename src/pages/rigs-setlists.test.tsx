import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRigs, demoSetlists } from "../data/demo-data";
import { useAppStore } from "../stores/app-store";
import { RigsPage, SetlistsPage } from "./rigs-setlists";

function resetLibrary() {
  localStorage.clear();
  useAppStore.setState({
    page: "rigs",
    rigs: structuredClone(demoRigs),
    selectedRigId: demoRigs[0].id,
    setlists: structuredClone(demoSetlists),
    selectedSetlistId: demoSetlists[0].id,
    favoriteRigIds: ["rig-1"],
    liveSnapshot: null,
    syncBusy: false,
  });
}

describe("Rigs and Setlists device workflows", () => {
  beforeEach(() => { vi.restoreAllMocks(); resetLibrary(); });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("filters by searchable metadata, sorts by tempo, and keeps favourites app-local", () => {
    const toggle = vi.spyOn(useAppStore.getState(), "toggleFavoriteRig");
    render(<RigsPage/>);

    fireEvent.change(screen.getByPlaceholderText(/Search by rig/i), { target: { value: "metal" } });
    expect(screen.getByRole("heading", { name: "Black Horizon" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Neon Boulevard" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Search by rig/i), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "tempo" } });
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Black Horizon");

    fireEvent.click(screen.getByRole("button", { name: "Add Glass Cathedral to favourites" }));
    expect(toggle).toHaveBeenCalledWith("rig-2");
    fireEvent.click(screen.getByRole("button", { name: "Favourites" }));
    expect(screen.getByRole("heading", { name: "Neon Boulevard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Glass Cathedral" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Black Horizon" })).not.toBeInTheDocument();
  });

  it("plays a rig without navigation and loads before opening the editor", async () => {
    const load = vi.spyOn(useAppStore.getState(), "loadRig").mockResolvedValue();
    const setPage = vi.spyOn(useAppStore.getState(), "setPage");
    render(<RigsPage/>);

    fireEvent.click(screen.getByRole("button", { name: /Load and play Glass Cathedral/i }));
    await waitFor(() => expect(load).toHaveBeenCalledWith("rig-2", undefined));
    expect(setPage).not.toHaveBeenCalledWith("editor");

    fireEvent.click(screen.getByRole("button", { name: /Edit Rust & Thunder/i }));
    await waitFor(() => expect(load).toHaveBeenCalledWith("rig-3", undefined));
    expect(setPage).toHaveBeenCalledWith("editor");
  });

  it("validates create and rename dialogs before invoking device mutations", async () => {
    const create = vi.spyOn(useAppStore.getState(), "createRig").mockResolvedValue();
    const rename = vi.spyOn(useAppStore.getState(), "renameRig").mockResolvedValue();
    render(<RigsPage/>);

    fireEvent.click(screen.getByRole("button", { name: "New rig" }));
    const createDialog = screen.getByRole("dialog", { name: "Create a new rig" });
    const name = within(createDialog).getByLabelText("Rig name");
    fireEvent.change(name, { target: { value: "   " } });
    expect(within(createDialog).getByRole("button", { name: "Create rig" })).toBeDisabled();
    fireEvent.change(name, { target: { value: "Session Clean" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(create).toHaveBeenCalledWith("Session Clean"));

    fireEvent.click(screen.getByRole("button", { name: "Rename Neon Boulevard" }));
    const renameDialog = screen.getByRole("dialog", { name: "Rename rig" });
    fireEvent.change(within(renameDialog).getByLabelText("Rig name"), { target: { value: "Neon Live" } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("rig-1", "Neon Live"));
  });

  it("loads the source before duplication and requires confirmation for deletion", async () => {
    const load = vi.spyOn(useAppStore.getState(), "loadRig").mockResolvedValue();
    const duplicate = vi.spyOn(useAppStore.getState(), "duplicateRig").mockResolvedValue();
    const remove = vi.spyOn(useAppStore.getState(), "deleteRig").mockResolvedValue();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RigsPage/>);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Glass Cathedral" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Duplicate rig" })).getByRole("button", { name: "Create copy" }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledWith("Glass Cathedral Copy"));
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(duplicate.mock.invocationCallOrder[0]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Neon Boulevard" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Neon Boulevard" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith("rig-1");
  });

  it("explains and recovers from each meaningful empty-library state", () => {
    useAppStore.setState({ favoriteRigIds: [] });
    const refresh = vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
    const { unmount } = render(<RigsPage/>);

    fireEvent.click(screen.getByRole("button", { name: "Favourites" }));
    expect(screen.getByRole("heading", { name: "Save the rigs you reach for" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse all rigs" }));
    expect(screen.getByRole("heading", { name: "Neon Boulevard" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Current" }));
    expect(screen.getByRole("heading", { name: "No current rig reported" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse all rigs" }));
    fireEvent.change(screen.getByPlaceholderText(/Search by rig/i), { target: { value: "definitely absent" } });
    expect(screen.getByRole("heading", { name: /No rigs match/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("heading", { name: "Glass Cathedral" })).toBeInTheDocument();

    unmount();
    useAppStore.setState({ rigs: [], selectedRigId: "" });
    render(<RigsPage/>);
    expect(screen.getByRole("heading", { name: "No rigs reported by the device" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh library" }));
    expect(refresh).toHaveBeenCalledWith("rigs", "manual");
  });

  it("exports the complete rig library as a revocable JSON download", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:rushlink-rigs");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<RigsPage/>);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:rushlink-rigs");
  });

  it("marks added and removed setlist rigs dirty and saves only on demand", async () => {
    const add = vi.spyOn(useAppStore.getState(), "addRigToSetlist");
    const remove = vi.spyOn(useAppStore.getState(), "removeSetlistItem");
    const save = vi.spyOn(useAppStore.getState(), "saveSelectedSetlist").mockResolvedValue();
    render(<SetlistsPage/>);

    expect(screen.getByRole("button", { name: /Save changes/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Add rigs/i }));
    const picker = screen.getByRole("dialog", { name: /Add rigs to setlist/i });
    fireEvent.click(within(picker).getByRole("button", { name: /Polar Clean/i }));
    expect(add).toHaveBeenCalledWith("rig-5");
    fireEvent.click(within(picker).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Remove Neon Boulevard" }));
    expect(remove).toHaveBeenCalledWith("si-1");
    expect(screen.getByRole("button", { name: /Save to device/i })).toBeEnabled();
  });

  it("reorders locally, then opens a selected setlist rig through the device loader", async () => {
    const move = vi.spyOn(useAppStore.getState(), "moveSetlistItem");
    const load = vi.spyOn(useAppStore.getState(), "loadRig").mockResolvedValue();
    const setPage = vi.spyOn(useAppStore.getState(), "setPage");
    const { container } = render(<SetlistsPage/>);
    const rows = container.querySelectorAll<HTMLElement>(".setlist-run-row");

    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    expect(move).toHaveBeenCalledWith(0, 2);
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Load Glass Cathedral" }));
    await waitFor(() => expect(load).toHaveBeenCalledWith("rig-2", undefined));
    expect(setPage).toHaveBeenCalledWith("editor");
  });

  it("creates, renames, and deletes setlists through explicit device actions", async () => {
    const create = vi.spyOn(useAppStore.getState(), "createSetlist").mockResolvedValue();
    const rename = vi.spyOn(useAppStore.getState(), "renameSetlist").mockResolvedValue();
    const remove = vi.spyOn(useAppStore.getState(), "deleteSetlist").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetlistsPage/>);

    fireEvent.click(screen.getByRole("button", { name: "New setlist" }));
    let dialog = screen.getByRole("dialog", { name: "Create setlist" });
    fireEvent.change(within(dialog).getByLabelText("Setlist name"), { target: { value: "Autumn Tour" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create setlist" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Autumn Tour"));

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    dialog = screen.getByRole("dialog", { name: "Rename setlist" });
    fireEvent.change(within(dialog).getByLabelText("Setlist name"), { target: { value: "Friday Updated" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("set-1", "Friday Updated"));

    fireEvent.click(screen.getByRole("button", { name: /Delete Friday/i }));
    expect(remove).toHaveBeenCalledWith("set-1");
  });

  it("handles setlist search misses, empty libraries, and navigation without dead ends", () => {
    const setPage = vi.spyOn(useAppStore.getState(), "setPage");
    const { unmount } = render(<SetlistsPage/>);
    fireEvent.change(screen.getByPlaceholderText(/Find a setlist/i), { target: { value: "no such show" } });
    expect(screen.getByText(/No setlists match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rig library/i }));
    expect(setPage).toHaveBeenCalledWith("rigs");

    unmount();
    useAppStore.setState({ setlists: [], selectedSetlistId: "" });
    render(<SetlistsPage/>);
    expect(screen.getByText("Create your first setlist")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "New setlist" })[0]);
    expect(screen.getByRole("dialog", { name: "Create setlist" })).toBeInTheDocument();
  });
});
