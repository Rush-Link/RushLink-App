import type { LiveGesture } from "./types";

export function drumMethodForTarget(target: string | undefined, gesture: LiveGesture): string | null {
  if (target === "toggle") return "togglePlay";
  if (target === "fill") return "playFill";
  if (target === "accent") return gesture === "release" ? "stopAccent" : "playAccent";
  if (target === "bridge") return "playBridge";
  if (target === "outro") return "playOutro";
  if (target === "mute") return "toggleMute";
  if (target === "restart") return "restart";
  return null;
}

export function tunerPropertyForTarget(target?: string) {
  return target === "mute"
    ? { path: "/Evil/Engine/AudioCtrl/Tuner", property: "TunerMuting" as const }
    : { path: "/Evil/Engine/AudioCtrl/Input", property: "TunerOn" as const };
}
