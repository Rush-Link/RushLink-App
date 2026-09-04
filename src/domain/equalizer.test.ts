import { describe, expect, it } from "vitest";
import type { Parameter } from "./types";
import { equalizerBands, equalizerFrequencyForX, equalizerGainForY, equalizerParameters, equalizerXForFrequency, equalizerYForGain } from "./equalizer";

const numberParameter = (id: string, value: number, unit?: string): Parameter => ({ id, label: id, value, min: unit === "Hz" ? 20 : -24, max: unit === "Hz" ? 20000 : 24, unit, writable: true });

describe("effect equalizer analysis", () => {
  it("recognises fixed frequencies encoded in Ten Freq EQ gain IDs", () => {
    const parameters = [numberParameter("Gain", 2, "dB"), ...["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"].map((frequency, index) => numberParameter(`Gain${frequency}`, index - 5, "dB"))];
    const bands = equalizerBands(parameters);
    expect(bands).toHaveLength(10);
    expect(bands.map((band) => band.frequency)).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
    expect(bands.some((band) => band.id === "Gain")).toBe(false);
  });

  it("pairs parametric frequency, gain, and Q by band number rather than array order", () => {
    const parameters = [numberParameter("Gain2", -3, "dB"), numberParameter("Q1", .7), numberParameter("Freq2", 2400, "Hz"), numberParameter("Gain1", 4, "dB"), numberParameter("Freq1", 180, "Hz"), numberParameter("Q2", 1.4)];
    const bands = equalizerBands(parameters);
    expect(bands.map((band) => ({ frequency: band.frequency, gain: band.gain, q: band.q }))).toEqual([{ frequency: 180, gain: 4, q: .7 }, { frequency: 2400, gain: -3, q: 1.4 }]);
  });

  it("exposes the slot EQ as an editable single band", () => {
    const parameters = [numberParameter("SltEQG", 3, "dB"), numberParameter("SltEQQ", 2), numberParameter("SltEQF", 750, "Hz"), { id: "SltEQOn", label: "Slot EQ", value: true, writable: true } satisfies Parameter];
    const bands = equalizerBands(parameters);
    expect(bands[0]).toMatchObject({ label: "Block EQ", frequency: 750, gain: 3, q: 2 });
    expect(equalizerParameters(parameters, bands).map((parameter) => parameter.id)).toEqual(["SltEQG", "SltEQQ", "SltEQF", "SltEQOn"]);
  });

  it("round-trips logarithmic graph positions without introducing pointer jumps", () => {
    for (const frequency of [20, 80, 440, 1000, 6500, 20000]) expect(equalizerFrequencyForX(equalizerXForFrequency(frequency))).toBeCloseTo(frequency, 8);
    for (const gain of [-18, -7.5, 0, 4.2, 18]) expect(equalizerGainForY(equalizerYForGain(gain, 18), 18)).toBeCloseTo(gain, 8);
  });
});
