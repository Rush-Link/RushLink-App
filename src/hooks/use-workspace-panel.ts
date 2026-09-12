import { useCallback, useEffect, useState } from "react";

const COMPACT_SCREEN = "(max-width: 1280px), (pointer: coarse)";

function savedChoice(key: string): boolean | null {
  try {
    const value = localStorage.getItem(key);
    return value === "open" ? true : value === "closed" ? false : null;
  } catch { return null; }
}

export function restoreWorkspacePanelFocus(controls: string) {
  const panel = document.getElementById(controls);
  if (!panel?.contains(document.activeElement)) return;
  const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-workspace-panel-toggle]"))
    .find((button) => button.getAttribute("aria-controls") === controls && !panel.contains(button));
  trigger?.focus();
}

/** Keep each workspace's panel choice local to this screen, without changing rig data. */
export function useWorkspacePanel(workspace: string, controls: string) {
  const key = `rushlink-workspace-panel:${workspace}`;
  const [choice, setChoice] = useState(() => savedChoice(key));
  const [compact, setCompact] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(COMPACT_SCREEN).matches);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(COMPACT_SCREEN);
    const changed = () => {
      if (media.matches && choice === null) restoreWorkspacePanelFocus(controls);
      setCompact(media.matches);
    };
    changed();
    media.addEventListener?.("change", changed);
    return () => media.removeEventListener?.("change", changed);
  }, [choice, controls]);

  const open = choice ?? !compact;
  const setOpen = useCallback((next: boolean) => {
    setChoice(next);
    try { localStorage.setItem(key, next ? "open" : "closed"); } catch { /* The panel still works when storage is unavailable. */ }
  }, [key]);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  return { open, setOpen, toggle };
}
