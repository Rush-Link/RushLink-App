import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type FullscreenSession = { exit: () => Promise<void>; native: boolean };

/** Keep the stage usable even in WebViews without the system fullscreen API. */
export function useStageFullscreen() {
  const session = useRef<FullscreenSession | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const exit = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await session.current?.exit();
      session.current = null;
      setFullscreen(false);
      setNotice(null);
    } catch {
      setNotice("Couldn’t exit system full screen. Try again or use your system’s full screen shortcut.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const toggle = async () => {
    if (pending.current) return;
    if (fullscreen) { await exit(); return; }
    pending.current = true;
    setBusy(true);
    setNotice(null);
    setFullscreen(true);
    try {
      let next: FullscreenSession | null = null;
      // Window commands are desktop-only; mobile uses the browser API when available.
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
      if (isTauri() && !mobile) {
        const appWindow = getCurrentWindow();
        if (!await appWindow.isFullscreen()) {
          await appWindow.setFullscreen(true);
          next = { native: true, exit: () => appWindow.setFullscreen(false) };
        }
      } else if (!document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen || document.fullscreenEnabled === false) throw new Error("Fullscreen unavailable");
        // Invoke directly from the user gesture, before any async platform lookup.
        await document.documentElement.requestFullscreen();
        next = { native: false, exit: async () => { if (document.fullscreenElement) await document.exitFullscreen(); } };
      }
      if (!mounted.current) { await next?.exit(); return; }
      session.current = next;
    } catch {
      if (mounted.current) setNotice("StageHand fills the app. System full screen is unavailable here.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      if (session.current && !session.current.native && !document.fullscreenElement) {
        session.current = null;
        setFullscreen(false);
        setNotice(null);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      mounted.current = false;
      document.removeEventListener("fullscreenchange", changed);
      const previous = session.current;
      session.current = null;
      void previous?.exit().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const escape = (event: KeyboardEvent) => {
      // Let an open dialog/menu handle Escape first.
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      void exit();
    };
    window.addEventListener("keydown", escape);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (session.current?.native) {
      const appWindow = getCurrentWindow();
      void appWindow.onResized(() => {
        if (pending.current) return;
        void appWindow.isFullscreen().then((active) => {
          if (!disposed && !active) { session.current = null; setFullscreen(false); setNotice(null); }
        }).catch(() => undefined);
      }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => undefined);
    }
    return () => { disposed = true; unlisten?.(); window.removeEventListener("keydown", escape); };
  }, [fullscreen, busy, exit]);

  return { fullscreen, busy, notice, toggle };
}
