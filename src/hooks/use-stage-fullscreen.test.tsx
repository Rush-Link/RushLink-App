import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStageFullscreen } from "./use-stage-fullscreen";

const platform = vi.hoisted(() => ({
  isTauri: vi.fn(() => false), isFullscreen: vi.fn(), setFullscreen: vi.fn(), onResized: vi.fn(), stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: platform.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => platform }));

let element: Element | null = null;
const request = vi.fn();
const leave = vi.fn();
const properties = [[document, "fullscreenElement"], [document, "exitFullscreen"], [document.documentElement, "requestFullscreen"]] as const;
const originals = properties.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));

beforeEach(() => {
  element = null;
  platform.isTauri.mockReturnValue(false);
  platform.isFullscreen.mockResolvedValue(false);
  platform.setFullscreen.mockResolvedValue(undefined);
  platform.onResized.mockResolvedValue(platform.stop);
  request.mockImplementation(async () => { element = document.documentElement; document.dispatchEvent(new Event("fullscreenchange")); });
  leave.mockImplementation(async () => { element = null; document.dispatchEvent(new Event("fullscreenchange")); });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: leave });
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
});
afterEach(() => {
  cleanup();
  properties.forEach(([target, key], index) => { const original = originals[index]; if (original) Object.defineProperty(target, key, original); else Reflect.deleteProperty(target, key); });
});

describe("StageHand full screen", () => {
  it("enters and exits browser full screen and follows a system exit", async () => {
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    expect(request).toHaveBeenCalledOnce();
    expect(result.current.fullscreen).toBe(true);
    await act(() => result.current.toggle());
    expect(leave).toHaveBeenCalledOnce();
    expect(result.current.fullscreen).toBe(false);
    await act(() => result.current.toggle());
    act(() => { element = null; document.dispatchEvent(new Event("fullscreenchange")); });
    expect(result.current.fullscreen).toBe(false);
  });

  it.each(["missing", "rejected"])("keeps an escapable stage workspace when the browser API is %s", async (failure) => {
    if (failure === "missing") Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: undefined });
    else request.mockRejectedValueOnce(new Error("Denied"));
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    expect(result.current.fullscreen).toBe(true);
    expect(result.current.notice).toMatch(/System full screen is unavailable/);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(result.current.fullscreen).toBe(false);
    expect(result.current.notice).toBeNull();
  });

  it("uses the native desktop window and follows a system exit", async () => {
    platform.isTauri.mockReturnValue(true);
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    expect(platform.setFullscreen).toHaveBeenCalledWith(true);
    expect(request).not.toHaveBeenCalled();
    expect(result.current.fullscreen).toBe(true);
    await act(async () => { platform.onResized.mock.calls.at(-1)![0](); });
    expect(result.current.fullscreen).toBe(false);
    expect(platform.stop).toHaveBeenCalled();
  });

  it("uses the browser route on Android instead of desktop-only native commands", async () => {
    platform.isTauri.mockReturnValue(true);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 16)");
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    expect(request).toHaveBeenCalledOnce();
    expect(platform.setFullscreen).not.toHaveBeenCalled();
    expect(result.current.fullscreen).toBe(true);
  });

  it("keeps the stage usable when native full screen is rejected", async () => {
    platform.isTauri.mockReturnValue(true);
    platform.setFullscreen.mockRejectedValueOnce(new Error("Unavailable"));
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    expect(result.current.fullscreen).toBe(true);
    expect(result.current.notice).toMatch(/System full screen is unavailable/);
    await act(() => result.current.toggle());
    expect(result.current.fullscreen).toBe(false);
  });

  it("exits native full screen with the button", async () => {
    platform.isTauri.mockReturnValue(true);
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    await act(() => result.current.toggle());
    expect(platform.setFullscreen.mock.calls).toEqual([[true], [false]]);
    expect(result.current.fullscreen).toBe(false);
  });

  it("does not exit a system fullscreen session it did not start", async () => {
    element = document.documentElement;
    const { result, unmount } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    await act(() => result.current.toggle());
    unmount();
    expect(leave).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("serializes rapid taps and cleans up when entry finishes after unmount", async () => {
    let complete!: () => void;
    request.mockImplementation(() => new Promise<void>((resolve) => { complete = () => { element = document.documentElement; resolve(); }; }));
    const { result, unmount } = renderHook(useStageFullscreen);
    let entering!: Promise<void>;
    act(() => { entering = result.current.toggle(); void result.current.toggle(); });
    expect(request).toHaveBeenCalledOnce();
    expect(result.current.busy).toBe(true);
    unmount();
    await act(async () => { complete(); await entering; });
    expect(leave).toHaveBeenCalledOnce();
  });

  it("keeps Exit available after a failed system exit so the user can retry", async () => {
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    leave.mockRejectedValueOnce(new Error("Denied"));
    await act(() => result.current.toggle());
    expect(result.current.fullscreen).toBe(true);
    expect(result.current.notice).toMatch(/Couldn’t exit/);
    expect(result.current.busy).toBe(false);
    await act(() => result.current.toggle());
    expect(result.current.fullscreen).toBe(false);
  });

  it("lets dialogs consume Escape before leaving full screen", async () => {
    const { result } = renderHook(useStageFullscreen);
    await act(() => result.current.toggle());
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.append(dialog);
    try {
      act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
      expect(result.current.fullscreen).toBe(true);
    } finally { dialog.remove(); }
  });
});
