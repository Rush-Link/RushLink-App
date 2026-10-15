import { useLayoutEffect, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizeThemePreference, resolveTheme } from "../domain/theme";
import { useAppStore } from "../stores/app-store";

const systemDark = () => typeof window.matchMedia !== "function" || window.matchMedia("(prefers-color-scheme: dark)").matches;
const subscribeSystemTheme = (onChange: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

export function useResolvedTheme() {
  const preference = useAppStore((state) => state.preferences.theme);
  const dark = useSyncExternalStore(subscribeSystemTheme, systemDark, () => true);
  return resolveTheme(preference, dark);
}

/** Apply appearance before painting, including the disconnected workspace. */
export function useAppTheme() {
  const preference = useAppStore((state) => state.preferences.theme);
  const resolved = useResolvedTheme();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePreference = normalizeThemePreference(preference);
    root.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f0f5fb" : "#06080c");
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (isTauri() && !mobile) {
      // Native title bars follow the same choice; mobile uses the WebView theme.
      void getCurrentWindow().setTheme(normalizeThemePreference(preference) === "system" ? null : resolved).catch(() => undefined);
    }
  }, [preference, resolved]);
  return resolved;
}
