import { describe, expect, it } from "vitest";
import { BLOCK_CATEGORY_COLORS, BLOCK_CATEGORY_GROUPS, blockBelongsToCategoryGroup, categoryForBlockName } from "./block-categories";

describe("HeadRush block categories", () => {
  it.each([
    ["ReValver Amp", "amp"],
    ["IR (1024)", "ir"],
    ["Pedal Clone", "clone"],
    ["Green JRC-OD", "overdrive"],
    ["Tri Fuzz", "distortion"],
    ["Acoust Sim", "eq"],
    ["Side Comp", "compressor"],
    ["Stereo Doubler", "delay"],
    ["Shimmer", "reverb"],
    ["Detune", "chorus"],
    ["Ring Mod", "phaser"],
    ["Panner", "vibrato"],
    ["Black Wah", "filter"],
    ["Smart Harm", "pitch"],
    ["Auto Swell", "dynamics"],
    ["Kill Seq", "rhythmic"],
    ["DB-33", "synth"],
    ["Kaften Gate", "utility"],
    ["FX-Loop", "fx-loop"],
  ] as const)("maps %s to %s", (name, category) => {
    expect(categoryForBlockName(name)).toBe(category);
    expect(BLOCK_CATEGORY_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("exposes every reflected Flex Prime picker group", () => {
    expect(BLOCK_CATEGORY_GROUPS.map((group) => group.id)).toEqual([
      "amp", "cab-ir", "clone", "overdrive", "distortion", "eq", "compressor", "delay", "reverb", "chorus",
      "phaser", "vibrato", "filter", "pitch", "dynamics", "rhythmic", "synth", "utility", "fx-loop",
    ]);
  });

  it("preserves blocks intentionally exposed in multiple device categories", () => {
    expect(categoryForBlockName("Ambi Verb")).toBe("reverb");
    expect(blockBelongsToCategoryGroup("Ambi Verb", "reverb")).toBe(true);
    expect(blockBelongsToCategoryGroup("Ambi Verb", "synth")).toBe(true);
  });

  it.each([
    ["User impulse response", 0, "ir"],
    ["User speaker", 3, "cab"],
    ["Prototype clone", 0, "clone"],
    ["Custom preamp", 2, "amp"],
    ["Studio Equalizer", 0, "eq"],
    ["Optical Compressor", 0, "compressor"],
    ["Memory Echo", 0, "delay"],
    ["Cloud Reverb", 0, "reverb"],
    ["Wide Chorus", 0, "chorus"],
    ["Jet Flanger", 0, "phaser"],
    ["Bias Tremolo", 0, "vibrato"],
    ["Envelope Filter", 0, "filter"],
    ["Micro Pitch", 0, "pitch"],
    ["Console Distortion", 0, "distortion"],
    ["Transparent Boost", 0, "overdrive"],
    ["Rhythmic Sequence", 0, "rhythmic"],
    ["Poly Synth", 0, "synth"],
    ["Volume Rider", 0, "dynamics"],
    ["Stereo FX Loop", 0, "fx-loop"],
    ["Future Processor", 0, "utility"],
  ] as const)("classifies future firmware name %s with safe heuristics", (name, effectType, expected) => {
    expect(categoryForBlockName(name, effectType)).toBe(expected);
  });

  it("rejects unknown catalogue groups and accepts stereo module suffixes", () => {
    expect(blockBelongsToCategoryGroup("Green JRC-OD 2", "overdrive")).toBe(true);
    expect(blockBelongsToCategoryGroup("Green JRC-OD", "not-a-group" as never)).toBe(false);
  });
});
