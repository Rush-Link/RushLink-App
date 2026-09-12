import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLiveLayout, defaultLiveStage, demoRigs } from "../data/demo-data";
import { useAppStore } from "../stores/app-store";
import { LivePlayPage } from "./live-play";
import { RushLinkContextMenu } from "../components/system/rushlink-context-menu";

beforeEach(() => {
  localStorage.clear();
  const layout = structuredClone(defaultLiveLayout);
  useAppStore.setState({ liveLayout: layout, liveStages: [{ ...structuredClone(defaultLiveStage), layout }], selectedLiveStageId: defaultLiveStage.id,
    rigs: structuredClone(demoRigs), liveSnapshot: null, liveSubtree: null,
    preferences: { ...useAppStore.getState().preferences, keepAwake: false },
  });
});
afterEach(cleanup);

describe("StageHand layout lock", () => {
  it("keeps fullscreen in performance mode even after unlocking", async () => {
    const trigger = vi.spyOn(useAppStore.getState(), "triggerLiveButton").mockResolvedValue(true);
    const { container } = render(<LivePlayPage/>);
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(container.querySelector('[data-live-index="0"]')!);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Full screen" })); });
    expect(container.querySelector(".stagehand--fullscreen")).toHaveClass("live-page--performance");
    expect(container.querySelector(".live-inspector")).toBeNull();
    expect(container.querySelector(".live-pad--empty")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Lock layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Unlock layout" }));
    expect(useAppStore.getState().liveLayout.locked).toBe(false);
    expect(container.querySelector(".live-pad--empty")).toBeDisabled();
    await act(async () => { fireEvent.click(container.querySelector('[data-live-index="0"]')!); });
    expect(trigger).toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Exit full screen" })); });
    expect(container.querySelector(".stagehand--fullscreen")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeEnabled();
  });

  it("closes editing, cancels a pending move, and keeps the performance pads active", async () => {
    const trigger = vi.spyOn(useAppStore.getState(), "triggerLiveButton").mockResolvedValue(true);
    const { container } = render(<LivePlayPage/>);
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(container.querySelector('[data-live-index="0"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Move control" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock layout" }));
    expect(screen.getByRole("button", { name: "Unlock layout" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New stage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplicate this stage" })).toBeDisabled();
    expect(container.querySelector(".live-inspector")).toBeNull();
    expect(container.querySelector(".stagehand-move-banner")).toBeNull();
    const empty = container.querySelector(".live-pad--empty")!;
    expect(empty).toBeDisabled();
    fireEvent.click(empty);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const before = useAppStore.getState().liveLayout.buttons.map((button) => button?.id);
    await act(async () => { fireEvent.click(container.querySelector('[data-live-index="0"]')!); });
    expect(trigger).toHaveBeenCalledWith(before[0], "release", undefined);
    expect(useAppStore.getState().liveLayout.buttons.map((button) => button?.id)).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Unlock layout" }));
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeEnabled();
    expect(container.querySelector(".live-inspector")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    expect(container.querySelector(".live-inspector")).toBeVisible();
  });

  it("disables removal from the context menu while locked", () => {
    useAppStore.getState().setLiveLocked(true);
    const { container } = render(<><LivePlayPage/><RushLinkContextMenu/></>);
    fireEvent.contextMenu(container.querySelector('[data-live-index="0"]')!);
    expect(screen.getByRole("menuitem", { name: /Remove from stage/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Trigger control/ })).toBeEnabled();
  });

  it("restores a saved lock when StageHand is reopened", () => {
    const first = render(<LivePlayPage/>);
    fireEvent.click(screen.getByRole("button", { name: "Lock layout" }));
    first.unmount();
    render(<LivePlayPage/>);
    expect(screen.getByRole("button", { name: "Unlock layout" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeDisabled();
    expect(useAppStore.getState().liveStages[0].layout.locked).toBe(true);
  });
});
