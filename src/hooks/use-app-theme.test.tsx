import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushAppPersistence, mergePersistedAppState, useAppStore } from "../stores/app-store";
import { SettingsPage } from "../pages/system-pages";
import { useAppTheme } from "./use-app-theme";

const platform = vi.hoisted(() => ({ native: vi.fn(() => false), setTheme: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({ ...await original<typeof import("@tauri-apps/api/core")>(), isTauri: platform.native }));
vi.mock("@tauri-apps/api/window", async (original) => ({ ...await original<typeof import("@tauri-apps/api/window")>(), getCurrentWindow: () => platform }));

let dark = false;
let media: MediaQueryList;
let events: EventTarget;
beforeEach(() => {
  dark = false;
  events = new EventTarget();
  media = {
    get matches() { return dark; }, media: "(prefers-color-scheme: dark)", onchange: null,
    addEventListener: vi.fn((...args: Parameters<EventTarget["addEventListener"]>) => events.addEventListener(...args)),
    removeEventListener: vi.fn((...args: Parameters<EventTarget["removeEventListener"]>) => events.removeEventListener(...args)),
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
    addListener: vi.fn(), removeListener: vi.fn(),
  } as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  platform.native.mockReturnValue(false);
  platform.setTheme.mockResolvedValue(undefined);
  useAppStore.getState().setPreference("theme", "dark");
});
afterEach(() => {
  cleanup();
  useAppStore.getState().setPreference("theme", "dark");
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  document.documentElement.style.removeProperty("color-scheme");
});

describe("application color mode", () => {
  it("preserves dark by default and applies a persisted light choice before connecting", () => {
    const initial = useAppStore.getState();
    expect(mergePersistedAppState({ preferences: { density: "compact" } }, initial).preferences.theme).toBe("dark");
    expect(mergePersistedAppState({ preferences: { theme: "invalid" } }, initial).preferences.theme).toBe("dark");
    useAppStore.getState().setPreference("theme", "light");
    flushAppPersistence();
    const saved = JSON.parse(localStorage.getItem("rushlink-state-v1")!);
    const recovered = mergePersistedAppState(saved.state, initial);
    useAppStore.setState({ preferences: recovered.preferences, device: null });
    renderHook(useAppTheme);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("tracks system changes and removes the listener when the workspace closes", () => {
    useAppStore.getState().setPreference("theme", "system");
    const { result, unmount } = renderHook(useAppTheme);
    expect(result.current).toBe("light");
    act(() => { dark = true; events.dispatchEvent(new Event("change")); });
    expect(result.current).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("keeps an explicit light choice when the operating system changes", () => {
    useAppStore.getState().setPreference("theme", "light");
    const { result } = renderHook(useAppTheme);
    act(() => { dark = true; events.dispatchEvent(new Event("change")); });
    expect(result.current).toBe("light");
    act(() => useAppStore.getState().setPreference("theme", "dark"));
    expect(result.current).toBe("dark");
  });

  it("applies the appearance selector immediately", () => {
    localStorage.setItem("rushlink-settings-tab", "appearance");
    renderHook(useAppTheme);
    render(<SettingsPage/>);
    fireEvent.change(screen.getByRole("combobox", { name: "Color mode" }), { target: { value: "light" } });
    expect(useAppStore.getState().preferences.theme).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("sets desktop native chrome and leaves mobile rendering to the WebView", () => {
    platform.native.mockReturnValue(true);
    useAppStore.getState().setPreference("theme", "light");
    const { unmount } = renderHook(useAppTheme);
    expect(platform.setTheme).toHaveBeenCalledWith("light");
    act(() => useAppStore.getState().setPreference("theme", "system"));
    expect(platform.setTheme).toHaveBeenLastCalledWith(null);
    unmount();
    platform.setTheme.mockClear();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 16)");
    renderHook(useAppTheme);
    expect(platform.setTheme).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
