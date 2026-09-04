import { describe, expect, it } from "vitest";
import { advanceDrumFrame, deviceDrumFrame, drumBeatDurationMs, drumBeatsRemaining, drumCounts, drumPhraseProgress } from "./drum-transport";

describe("drum phrase transport", () => {
  it("uses the device phrase dimensions instead of a fixed eight-beat rail", () => {
    expect(drumCounts({ barCount: 3, beatCount: 6 })).toEqual({ barCount: 3, beatCount: 6 });
    expect(drumCounts({ barCount: 0, beatCount: 0 })).toEqual({ barCount: 4, beatCount: 4 });
  });

  it("rejects idle device positions and clamps live positions", () => {
    expect(deviceDrumFrame({ currentBar: -1, currentBeat: -1 })).toBeNull();
    expect(deviceDrumFrame({ currentBar: 9, currentBeat: 9, barCount: 2, beatCount: 3 })).toMatchObject({ bar: 1, beat: 2 });
  });

  it("advances beats and wraps bars using the reported signature", () => {
    const frame = { bar: 1, beat: 2, barCount: 3, beatCount: 3, source: "device" as const };
    expect(advanceDrumFrame(frame)).toEqual({ bar: 2, beat: 0, barCount: 3, beatCount: 3, source: "clock" });
    expect(advanceDrumFrame({ ...frame, bar: 2 })).toEqual({ bar: 0, beat: 0, barCount: 3, beatCount: 3, source: "clock" });
  });

  it("reports useful progress and timebase values", () => {
    const frame = { bar: 0, beat: 1, barCount: 2, beatCount: 4, source: "device" as const };
    expect(drumPhraseProgress(frame)).toBe(25);
    expect(drumBeatsRemaining(frame)).toBe(6);
    expect(drumBeatDurationMs(120)).toBe(500);
  });
});
