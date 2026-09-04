import { describe, expect, it } from "vitest";
import { actionPalette, defaultLiveLayout } from "../data/demo-data";
import { adjacentLiveIndex, canPlaceLiveFootprint, liveCellToIndex, liveDeckDimensions, liveDeckFootprintChoices, liveFootprintIndexes, liveIndexToCell, midiCommandText, normalizeLiveDeckActions, normalizeLiveDimensions, normalizeLiveMidiCommand, normalizeLiveStageSpacing, resizeLiveLayout } from "./live-layout";

describe("StageHand layout", () => {
  it("enforces the 4 by 8 maximum and a shorter first row", () => {
    expect(normalizeLiveDimensions(9, 14, 12)).toEqual({ rows: 4, columns: 8, firstRowColumns: 8, size: 32 });
    expect(normalizeLiveDimensions(3, 8, 4).size).toBe(20);
  });

  it("normalizes block gaps and independent stage safe-area insets", () => {
    expect(normalizeLiveStageSpacing({ columnGap: 18.7, rowGap: -4, insetTop: 140, insetLeft: 32 })).toEqual({
      columnGap: 19, rowGap: 0, insetTop: 96, insetRight: 16, insetBottom: 16, insetLeft: 32,
    });
  });

  it("resizes the button storage without mutating the source", () => {
    const resized = resizeLiveLayout(defaultLiveLayout, 4, 8, 4);
    expect(resized.buttons).toHaveLength(28);
    expect(defaultLiveLayout.buttons).not.toHaveLength(28);
  });

  it("compacts controls that would otherwise fall outside a smaller grid", () => {
    const sparse = { ...defaultLiveLayout, buttons: [null, null, null, null, null, null, null, null, ...defaultLiveLayout.buttons.slice(0, 3)] };
    const resized = resizeLiveLayout(sparse, 2, 4, 4);
    expect(resized.buttons.filter(Boolean)).toHaveLength(3);
  });

  it("refuses a resize that would silently discard controls", () => {
    const full = { ...defaultLiveLayout, buttons: defaultLiveLayout.buttons.map((button, index) => button ?? { ...defaultLiveLayout.buttons[0]!, id: `filled-${index}` }) };
    expect(resizeLiveLayout(full, 1, 4, 4)).toBe(full);
  });

  it("normalizes manually entered MIDI bytes and channels", () => {
    expect(normalizeLiveMidiCommand({ type: "cc", channel: 22, number: -7, value: 222, releaseValue: -1 }))
      .toEqual({ type: "cc", channel: 16, number: 0, value: 127, releaseValue: 0 });
  });

  it("describes a MIDI mirror command", () => {
    expect(midiCommandText({ type: "cc", channel: 1, number: 14, value: 127, releaseValue: 0 })).toBe("Control Change 14, value 127, release 0, channel 1");
  });

  it("maps short first-row positions for keyboard and touch movement", () => {
    const layout = { rows: 3, columns: 8, firstRowColumns: 4 };
    expect(liveIndexToCell(layout, 4)).toEqual({ row: 1, column: 0 });
    expect(liveCellToIndex(layout, 2, 7)).toBe(19);
    expect(adjacentLiveIndex(layout, 3, "down")).toBe(7);
    expect(adjacentLiveIndex(layout, 11, "up")).toBe(3);
    expect(adjacentLiveIndex(layout, 0, "left")).toBeNull();
  });

  it("builds all supported multi-button deck arrangements", () => {
    expect(liveDeckDimensions("1x4")).toEqual({ rows: 1, columns: 4, capacity: 4 });
    expect(liveDeckDimensions("2x3")).toEqual({ rows: 2, columns: 3, capacity: 6 });
    expect(normalizeLiveDeckActions("looper", "1x3")).toEqual(["record", "toggle", "peel"]);
    expect(normalizeLiveDeckActions("drums", "2x2")).toEqual(["toggle", "fill", "bridge", "mute"]);
  });

  it("preserves valid custom deck assignments and replaces invalid ones", () => {
    expect(normalizeLiveDeckActions("looper", "2x2", ["reverse", "invalid", "mute", "record"]))
      .toEqual(["reverse", "toggle", "mute", "record"]);
  });

  it("publishes four reflected drummer deck variants and no outbound looper decks", () => {
    expect(actionPalette.some((item) => item.action === "looper")).toBe(false);
    expect(actionPalette.filter((item) => item.group === "Drum decks")).toHaveLength(4);
  });

  it("separates the device tuner toggle from the fixed 1 by 2 live readout", () => {
    const toggle = actionPalette.find((item) => item.label === "DEVICE TUNER");
    const display = actionPalette.find((item) => item.widget === "tuner");
    expect(toggle).toMatchObject({ action: "tuner", switchType: "multi", holdMs: 650, holdBinding: { action: "tuner", target: "mute" } });
    expect(toggle).not.toHaveProperty("widget");
    expect(display).toMatchObject({ label: "TUNER DISPLAY", action: "tuner", switchType: "multi", holdMs: 650, holdBinding: { action: "tuner", target: "mute" }, widgetSize: "1x2", width: 2 });
  });

  it("offers exactly one dedicated 1 by 1 multifunction control", () => {
    const multifunction = actionPalette.filter((item) => item.multiFunction);
    expect(multifunction).toHaveLength(1);
    expect(multifunction[0]).toMatchObject({ label: "MULTIFUNCTION", action: "custom", switchType: "multi" });
    expect(multifunction[0]).not.toHaveProperty("widget");
    expect(multifunction[0]).not.toHaveProperty("width");
  });

  it("limits deck footprints to compact, strip and the selected original size", () => {
    expect(liveDeckFootprintChoices("1x4")).toEqual(["1x1", "1x2", "1x4"]);
    expect(liveDeckFootprintChoices("2x3")).toEqual(["1x1", "1x2", "2x3"]);
    expect(liveDeckFootprintChoices("1x3")).toEqual(["1x1", "1x2", "1x3"]);
    expect(liveDeckFootprintChoices("2x2")).toEqual(["1x1", "1x2", "2x2"]);
  });

  it("only places a multi-cell deck when its complete footprint is free", () => {
    const grid = { rows: 3, columns: 4, firstRowColumns: 4 };
    const buttons = Array(12).fill(null);
    expect(liveFootprintIndexes(grid, 0, "2x3")).toEqual([0, 1, 2, 4, 5, 6]);
    expect(canPlaceLiveFootprint(grid, buttons, 0, "2x3")).toBe(true);
    expect(canPlaceLiveFootprint(grid, buttons, 2, "2x3")).toBe(false);
    buttons[5] = defaultLiveLayout.buttons[0];
    expect(canPlaceLiveFootprint(grid, buttons, 0, "2x3")).toBe(false);
  });
});
