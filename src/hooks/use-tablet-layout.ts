import { useSyncExternalStore } from "react";

export const TABLET_VIEWPORT = "(min-width: 761px) and (max-width: 1280px), (min-width: 600px) and (pointer: coarse)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(TABLET_VIEWPORT);
  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}

export function useTabletLayout() {
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === "function" && window.matchMedia(TABLET_VIEWPORT).matches, () => false);
}

const COMPACT_WORKSPACE = "(max-width: 1280px), (pointer: coarse)";
function subscribeCompact(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(COMPACT_WORKSPACE);
  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}
export function useCompactWorkspace() {
  return useSyncExternalStore(subscribeCompact, () => typeof window.matchMedia === "function" && window.matchMedia(COMPACT_WORKSPACE).matches, () => false);
}
