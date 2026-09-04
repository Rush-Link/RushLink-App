import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudTones, demoDevice, demoRigs, demoSetlists } from "../../data/demo-data";
import { useAppStore } from "../../stores/app-store";
import { buildRushLinkMenu, RushLinkContextMenu } from "./rushlink-context-menu";

const originalState = useAppStore.getState();

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    page: "editor",
    rigs: structuredClone(demoRigs),
    selectedRigId: demoRigs[0].id,
    favoriteRigIds: [],
    device: null,
    liveSnapshot: null,
    sidebarCollapsed: false,
  });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({
    toggleFavoriteRig: originalState.toggleFavoriteRig,
    setPage: originalState.setPage,
    refreshPage: originalState.refreshPage,
  });
});

describe("RushLink context menu", () => {
  it("suppresses the browser context menu and opens RushLink actions", () => {
    render(<><RushLinkContextMenu/><div data-testid="surface">Workspace</div></>);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
    const dispatched = fireEvent(screen.getByTestId("surface"), event);
    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("menu", { name: "RushLink actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /connect a headrush/i })).toBeInTheDocument();
  });

  it("shows text editing commands instead of device actions on a field", () => {
    render(<><RushLinkContextMenu/><input aria-label="Rig name" defaultValue="Clean rig"/></>);
    const input = screen.getByRole("textbox", { name: "Rig name" }) as HTMLInputElement;
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input, { clientX: 30, clientY: 30 });
    expect(screen.getByRole("menu", { name: "Rig name actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Paste" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: /refresh/i })).not.toBeInTheDocument();
  });

  it("builds and executes rig-specific actions", () => {
    const favorite = vi.fn();
    useAppStore.setState({ toggleFavoriteRig: favorite });
    render(<><RushLinkContextMenu/><article data-context-kind="rig" data-rig-id={demoRigs[0].id}>Rig card</article></>);
    fireEvent.contextMenu(screen.getByText("Rig card"));
    expect(screen.getByRole("menu", { name: `${demoRigs[0].name} actions` })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /play on headrush/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: /add to favourites/i }));
    expect(favorite).toHaveBeenCalledWith(demoRigs[0].id);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("resolves signal blocks, empty slots and StageHand controls", () => {
    const state = useAppStore.getState();
    const block = demoRigs[0].blocks.find((item) => !item.empty)!;
    const blockTarget = document.createElement("div");
    blockTarget.dataset.contextKind = "rig-block";
    blockTarget.dataset.blockId = block.id;
    blockTarget.dataset.slot = String(block.slot);
    const blockMenu = buildRushLinkMenu(blockTarget, { ...state, rigs: structuredClone(demoRigs), selectedRigId: demoRigs[0].id });
    expect(blockMenu.items.map((item) => item.label)).toEqual(expect.arrayContaining(["Edit block", block.enabled ? "Bypass block" : "Enable block", "Remove block"]));

    const slotTarget = document.createElement("button");
    slotTarget.dataset.contextKind = "test-rig-slot";
    slotTarget.dataset.slot = "11";
    expect(buildRushLinkMenu(slotTarget, state).items[0].label).toBe("Add a compatible block");

    const stageTarget = document.createElement("button");
    stageTarget.dataset.contextKind = "stage-slot";
    stageTarget.dataset.liveIndex = "3";
    expect(buildRushLinkMenu(stageTarget, { ...state, liveLayout: { ...state.liveLayout, buttons: state.liveLayout.buttons.map(() => null) } }).items[0].label).toBe("Add a StageHand control");
  });

  it("supports arrow-key navigation, Escape, and clamps to the viewport", () => {
    render(<><RushLinkContextMenu/><div data-testid="edge">Edge</div></>);
    fireEvent.contextMenu(screen.getByTestId("edge"), { clientX: window.innerWidth + 500, clientY: window.innerHeight + 500 });
    const menu = screen.getByRole("menu");
    expect(Number.parseFloat(menu.style.left)).toBeLessThan(window.innerWidth);
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(window.innerHeight);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAttribute("role", "menuitem");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("executes tone, block and Test Rig commands against their owning workspaces", async () => {
    const state = useAppStore.getState();
    const selectTone = vi.fn(); const setPage = vi.fn(); const favoriteTone = vi.fn();
    const toneTarget = document.createElement("article");
    toneTarget.dataset.contextKind = "tone"; toneTarget.dataset.toneId = cloudTones[0].id;
    const toneMenu = buildRushLinkMenu(toneTarget, { ...state, tones: cloudTones, favoriteToneIds: [], selectTone, setPage, toggleFavoriteTone: favoriteTone });
    await toneMenu.items.find((item) => item.id === "tone-configure")!.action();
    await toneMenu.items.find((item) => item.id === "tone-favorite")!.action();
    expect(selectTone).toHaveBeenCalledWith(cloudTones[0].id);
    expect(setPage).toHaveBeenCalledWith("tone-cloud");
    expect(favoriteTone).toHaveBeenCalledWith(cloudTones[0].id);

    const block = demoRigs[0].blocks[2];
    const selectBlock = vi.fn(); const toggleBlock = vi.fn(); const removeBlock = vi.fn().mockResolvedValue(undefined);
    const blockTarget = document.createElement("div");
    Object.assign(blockTarget.dataset, { contextKind: "rig-block", blockId: block.id, slot: String(block.slot) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const blockMenu = buildRushLinkMenu(blockTarget, { ...state, rigs: demoRigs, selectedRigId: demoRigs[0].id, selectBlock, toggleBlock, removeBlock, setPage });
    await blockMenu.items.find((item) => item.id === "block-edit")!.action();
    await blockMenu.items.find((item) => item.id === "block-toggle")!.action();
    await blockMenu.items.find((item) => item.id === "block-remove")!.action();
    expect(selectBlock).toHaveBeenCalledWith(block.id);
    expect(toggleBlock).toHaveBeenCalledWith(block.id);
    expect(removeBlock).toHaveBeenCalledWith(block.id);

    const testBlock = state.testRigs[0].blocks.find((item) => !item.empty)!;
    const toggleTestRigBlock = vi.fn(); const duplicateTestRigBlock = vi.fn(); const removeTestRigBlock = vi.fn();
    const testTarget = document.createElement("button");
    Object.assign(testTarget.dataset, { contextKind: "test-rig-block", blockId: testBlock.id, slot: String(testBlock.slot) });
    const testMenu = buildRushLinkMenu(testTarget, { ...state, toggleTestRigBlock, duplicateTestRigBlock, removeTestRigBlock });
    await testMenu.items.find((item) => item.id === "test-block-toggle")!.action();
    await testMenu.items.find((item) => item.id === "test-block-copy")!.action();
    await testMenu.items.find((item) => item.id === "test-block-remove")!.action();
    expect(toggleTestRigBlock).toHaveBeenCalledWith(testBlock.id);
    expect(duplicateTestRigBlock).toHaveBeenCalledWith(testBlock.id);
    expect(removeTestRigBlock).toHaveBeenCalledWith(testBlock.id);
  });

  it("triggers and removes StageHand controls and opens setlists from contextual commands", async () => {
    const state = useAppStore.getState();
    const button = state.liveLayout.buttons.find((item) => item && item.action === "block-toggle")!;
    const index = state.liveLayout.buttons.indexOf(button);
    const trigger = vi.fn().mockResolvedValue(true); const remove = vi.fn(); const setPage = vi.fn(); const selectSetlist = vi.fn();
    const stageTarget = document.createElement("button");
    Object.assign(stageTarget.dataset, { contextKind: "stage-control", liveIndex: String(index) });
    const stageMenu = buildRushLinkMenu(stageTarget, { ...state, triggerLiveButton: trigger, removeLiveButton: remove, setPage });
    await stageMenu.items.find((item) => item.id === "stage-trigger")!.action();
    expect(trigger).toHaveBeenCalledWith(button.id, "release");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await stageMenu.items.find((item) => item.id === "stage-remove")!.action();
    expect(remove).toHaveBeenCalledWith(button.id);

    const setlist = demoSetlists[0];
    const setlistTarget = document.createElement("article");
    Object.assign(setlistTarget.dataset, { contextKind: "setlist", setlistId: setlist.id });
    const setlistMenu = buildRushLinkMenu(setlistTarget, { ...state, setlists: demoSetlists, selectSetlist, setPage });
    await setlistMenu.items.find((item) => item.id === "setlist-open")!.action();
    expect(selectSetlist).toHaveBeenCalledWith(setlist.id);
    expect(setPage).toHaveBeenCalledWith("setlists");
  });

  it("opens device assets, links and sidebar workspaces through the clicked element", async () => {
    const state = useAppStore.getState();
    const fileTarget = document.createElement("button");
    Object.assign(fileTarget.dataset, { contextKind: "device-file", devicePath: "/NAM/Lead.nam", deviceName: "Lead.nam" });
    const clickFile = vi.spyOn(fileTarget, "click");
    await buildRushLinkMenu(fileTarget, state).items.find((item) => item.id === "file-use")!.action();
    expect(clickFile).toHaveBeenCalled();

    const link = document.createElement("a"); link.href = "https://tone3000.com/model/1"; link.textContent = "Tone details";
    const clickLink = vi.spyOn(link, "click").mockImplementation(() => undefined);
    await buildRushLinkMenu(link, state).items.find((item) => item.id === "link-open")!.action();
    expect(clickLink).toHaveBeenCalled();

    const navigation = document.createElement("div"); navigation.className = "sidebar__nav";
    const navigationButton = document.createElement("button"); navigationButton.textContent = "StageHand"; navigation.append(navigationButton);
    const clickNavigation = vi.spyOn(navigationButton, "click");
    await buildRushLinkMenu(navigationButton, state).items.find((item) => item.id === "navigate")!.action();
    expect(clickNavigation).toHaveBeenCalled();
  });

  it("runs global refresh, snapshot and navigation commands when a device is connected", async () => {
    const state = useAppStore.getState();
    const refreshPage = vi.fn().mockResolvedValue(undefined); const createSnapshot = vi.fn().mockResolvedValue(undefined); const setPage = vi.fn(); const toggleSidebar = vi.fn();
    const menu = buildRushLinkMenu(document.createElement("main"), { ...state, device: { ...demoDevice, status: "ready" }, refreshPage, createSnapshot, setPage, toggleSidebar });
    await menu.items.find((item) => item.id === "refresh")!.action();
    await menu.items.find((item) => item.id === "snapshot")!.action();
    await menu.items.find((item) => item.id === "rigs")!.action();
    await menu.items.find((item) => item.id === "sidebar")!.action();
    expect(refreshPage).toHaveBeenCalledWith("editor", "manual");
    expect(createSnapshot).toHaveBeenCalledWith("RushLink context menu");
    expect(setPage).toHaveBeenCalledWith("rigs");
    expect(toggleSidebar).toHaveBeenCalled();
  });

  it("records rejected context actions as diagnostics and closes on outside interaction", async () => {
    const refreshPage = vi.fn().mockRejectedValue(new Error("device timeout"));
    const diagnostic = vi.fn();
    useAppStore.setState({ device: { ...demoDevice, status: "ready" }, refreshPage, addDiagnostic: diagnostic });
    render(<><RushLinkContextMenu/><div data-testid="workspace">Workspace</div><div data-testid="outside">Outside</div></>);
    fireEvent.contextMenu(screen.getByTestId("workspace"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Refresh Rig Editor/i }));
    await waitFor(() => expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: "error", source: "Context menu", message: "Refresh Rig Editor failed", detail: expect.stringContaining("device timeout") })));

    fireEvent.contextMenu(screen.getByTestId("workspace"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
