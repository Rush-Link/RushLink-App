import { describe, expect, it } from "vitest";
import { FLEX_PRIME_MIDI_CC, flexPrimeMidiCommand } from "./headrush-midi";

describe("Flex Prime v5.1 MIDI map", () => {
  it("maps the documented rig, scene, tuner and block controls", () => {
    expect(flexPrimeMidiCommand("rig-prev").number).toBe(16);
    expect(flexPrimeMidiCommand("rig-next").number).toBe(17);
    expect("ABCDEF".split("").map((scene) => flexPrimeMidiCommand("scene", scene).number)).toEqual([21, 22, 23, 24, 25, 26]);
    expect(flexPrimeMidiCommand("tuner").number).toBe(92);
    expect(flexPrimeMidiCommand("block-toggle", undefined, 0).number).toBe(75);
    expect(flexPrimeMidiCommand("block-toggle", undefined, 13).number).toBe(88);
  });

  it("maps the complete Practice Tool command range", () => {
    expect(flexPrimeMidiCommand("practice", "open").number).toBe(102);
    expect(flexPrimeMidiCommand("practice", "play-pause").number).toBe(103);
    expect(flexPrimeMidiCommand("practice", "loop-toggle").number).toBe(117);
    expect(FLEX_PRIME_MIDI_CC.practiceLoopOut).toBe(108);
  });

  it("uses the documented drum performance controls", () => {
    expect(flexPrimeMidiCommand("drums", "toggle").number).toBe(42);
    expect(flexPrimeMidiCommand("drums", "fill").number).toBe(43);
    expect(flexPrimeMidiCommand("drums", "accent").number).toBe(47);
  });

  it("uses the documented looper layer and transport controls", () => {
    expect(flexPrimeMidiCommand("looper", "half-speed").number).toBe(65);
    expect(flexPrimeMidiCommand("looper", "double-speed").number).toBe(66);
    expect(flexPrimeMidiCommand("looper", "half-loop").number).toBe(67);
    expect(flexPrimeMidiCommand("looper", "double-loop").number).toBe(68);
    expect(flexPrimeMidiCommand("looper", "toggle").number).toBe(69);
    expect(flexPrimeMidiCommand("looper", "record").number).toBe(70);
    expect(flexPrimeMidiCommand("looper", "insert").number).toBe(71);
    expect(flexPrimeMidiCommand("looper", "peel").number).toBe(72);
    expect(flexPrimeMidiCommand("looper", "mute").number).toBe(73);
    expect(flexPrimeMidiCommand("looper", "reverse").number).toBe(74);
    expect(flexPrimeMidiCommand("looper", "open").number).toBe(91);
  });
});
