import { describe, expect, it } from "vitest";
import { actionPalette } from "../data/demo-data";
import { normalizeLiveDeckActions } from "./live-layout";
import { drumMethodForTarget, tunerPropertyForTarget } from "./stage-actions";

describe("StageHand action transports", () => {
  it("maps every reflected drum action explicitly", () => {
    expect(drumMethodForTarget("toggle", "release")).toBe("togglePlay");
    expect(drumMethodForTarget("fill", "release")).toBe("playFill");
    expect(drumMethodForTarget("accent", "press")).toBe("playAccent");
    expect(drumMethodForTarget("accent", "release")).toBe("stopAccent");
    expect(drumMethodForTarget("bridge", "release")).toBe("playBridge");
    expect(drumMethodForTarget("outro", "release")).toBe("playOutro");
    expect(drumMethodForTarget("mute", "release")).toBe("toggleMute");
    expect(drumMethodForTarget("restart", "release")).toBe("restart");
    expect(drumMethodForTarget("open", "release")).toBeNull();
    expect(drumMethodForTarget(undefined, "release")).toBeNull();
  });

  it("leaves no published drum control without a reflected transport command", () => {
    for (const item of actionPalette) {
      if (item.action !== "drums") continue;
      const targets = item.widget === "drums" ? normalizeLiveDeckActions("drums", item.widgetLayout ?? "2x2", item.widgetActions) : [item.target];
      for (const target of targets) expect(drumMethodForTarget(target, target === "accent" ? "press" : "release"), `${item.label}:${target}`).not.toBeNull();
    }
  });

  it("uses separate reflected properties for tuner visibility and tuner muting", () => {
    expect(tunerPropertyForTarget()).toEqual({ path: "/Evil/Engine/AudioCtrl/Input", property: "TunerOn" });
    expect(tunerPropertyForTarget("mute")).toEqual({ path: "/Evil/Engine/AudioCtrl/Tuner", property: "TunerMuting" });
  });
});
