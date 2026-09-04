import { describe, expect, it } from "vitest";
import type { LiveButton } from "./types";
import { canonicalLiveSwitchType, liveActionAllowedForGesture, resolveLiveButtonGesture } from "./stage-gestures";

const button = (patch: Partial<LiveButton>): LiveButton => ({
  id: "control", label: "Control", subtitle: "", action: "custom", color: "rose", icon: "terminal",
  switchType: "trigger", midi: { type: "note", channel: 1, number: 60, value: 127 }, ...patch,
});

describe("StageHand gesture safety", () => {
  it("keeps normal functions on their compatible fixed switch behaviour", () => {
    expect(canonicalLiveSwitchType(button({ action: "tap-tempo", switchType: "multi" }))).toBe("trigger");
    expect(canonicalLiveSwitchType(button({ action: "block-toggle", switchType: "hold" }))).toBe("toggle");
    expect(canonicalLiveSwitchType(button({ action: "drums", target: "accent" }))).toBe("momentary");
    expect(canonicalLiveSwitchType(button({ action: "tuner" }))).toBe("multi");
  });

  it("allows multi gestures only through the dedicated multifunction control", () => {
    const multifunction = button({ multiFunction: true, switchType: "multi", tapBinding: { action: "scene", target: "B" }, holdBinding: { action: "tap-tempo" }, doubleBinding: { action: "tuner", target: "mute" } });
    expect(resolveLiveButtonGesture(multifunction, "release")).toMatchObject({ action: "scene", target: "B" });
    expect(resolveLiveButtonGesture(multifunction, "hold")).toBeNull();
    expect(resolveLiveButtonGesture(multifunction, "double")).toMatchObject({ action: "tuner", target: "mute" });
    expect(liveActionAllowedForGesture("tap-tempo", "release")).toBe(true);
    expect(liveActionAllowedForGesture("tap-tempo", "hold")).toBe(false);
  });
});
