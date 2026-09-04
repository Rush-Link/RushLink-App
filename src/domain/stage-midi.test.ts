import { describe, expect, it } from "vitest";
import { actionPalette } from "../data/demo-data";
import { findStageMidiMatch, parseBleMidiPacket, parseStageMidiMessage } from "./stage-midi";

describe("StageHand MIDI input", () => {
  it("parses keyboard notes, CC and program changes", () => {
    expect(parseStageMidiMessage([0x90, 60, 100])).toMatchObject({ type: "note", channel: 1, number: 60, value: 100, released: false });
    expect(parseStageMidiMessage([0x80, 60, 0])?.released).toBe(true);
    expect(parseStageMidiMessage([0xb2, 21, 127])).toMatchObject({ type: "cc", channel: 3, number: 21 });
    expect(parseStageMidiMessage([0xc0, 8])).toMatchObject({ type: "pc", number: 8 });
  });

  it("matches a controller message to an active StageHand control", () => {
    const scene = actionPalette.find((item) => item.action === "scene" && item.target === "A")!;
    const button = { ...scene, id: "scene-a" };
    const message = parseStageMidiMessage([0xb0, 21, 127])!;
    expect(findStageMidiMatch([button], message)).toMatchObject({ button: { id: "scene-a" }, target: "A", gesture: "release" });
    expect(findStageMidiMatch([button], parseStageMidiMessage([0xb0, 21, 0])!)).toBeNull();
  });

  it("routes controller input to buttons inside a drummer deck", () => {
    const template = actionPalette.find((item) => item.group === "Drum decks" && item.widgetLayout === "2x2")!;
    const button = { ...template, id: "drums", widgetActions: ["toggle", "fill", "bridge", "mute"] };
    expect(findStageMidiMatch([button], parseStageMidiMessage([0xb0, 46, 127])!)).toMatchObject({ target: "mute" });
  });

  it("decodes BLE-MIDI notification packets", () => {
    expect(parseBleMidiPacket([0x87, 0xe8, 0xb0, 42, 127])).toEqual([{ type: "cc", channel: 1, number: 42, value: 127, released: false }]);
  });
});
