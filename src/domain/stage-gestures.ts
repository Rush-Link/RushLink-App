import type { LiveActionType, LiveButton, LiveGesture, LiveSwitchType } from "./types";

export function canonicalLiveSwitchType(button: LiveButton): LiveSwitchType {
  if (button.multiFunction || button.action === "tuner") return "multi";
  if (button.action === "block-toggle" || button.action === "expression") return "toggle";
  if (button.action === "drums") return button.target === "accent" ? "momentary" : ["toggle", "mute"].includes(button.target ?? "") || Boolean(button.widget) ? "toggle" : "trigger";
  if (button.action === "practice" && button.widget) return "toggle";
  if (button.action === "looper" && button.widget) return "toggle";
  return "trigger";
}

export function liveActionAllowedForGesture(action: LiveActionType, gesture: LiveGesture) {
  if (action === "custom") return false;
  if (action === "tap-tempo" && gesture !== "release") return false;
  return true;
}

export function resolveLiveButtonGesture(button: LiveButton, gesture: LiveGesture = "release", targetOverride?: string): LiveButton | null {
  if (targetOverride !== undefined) return { ...button, target: targetOverride };
  const binding = gesture === "release" && button.multiFunction ? button.tapBinding : gesture === "hold" ? button.holdBinding : gesture === "double" ? button.doubleBinding : undefined;
  if (button.multiFunction && !binding) return null;
  if ((gesture === "hold" && !button.holdBinding && button.switchType === "multi") || (gesture === "double" && !button.doubleBinding)) return null;
  if (!binding) return button;
  if (!liveActionAllowedForGesture(binding.action, gesture)) return null;
  return { ...button, action: binding.action, target: binding.target, label: binding.label ?? button.label };
}
