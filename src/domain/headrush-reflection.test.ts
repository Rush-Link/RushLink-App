import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HeadRushSubtree, Parameter } from "./types";
import { colorForIndex, denormalizeValue, normalizeValue, parameterDeviceValue, parametersForObject, parseHeadRushSubtree } from "./headrush-reflection";

const capturedTree = JSON.parse(readFileSync(resolve(process.cwd(), "reference/headrush/live/latest-subtree.json"), "utf8")) as HeadRushSubtree;

describe("HeadRush reflection adapter", () => {
  it("maps the current Flex Prime state and all fourteen slots", () => {
    const snapshot = parseHeadRushSubtree(capturedTree);
    expect(snapshot.rig.name).toBe("ROCK");
    expect(snapshot.rig.blocks).toHaveLength(14);
    expect(snapshot.rig.blocks.slice(0, 4).map((block) => block.name)).toEqual(["Kaften Gate", "Black Wah", "Green JRC-OD", "ReValver Amp"]);
    expect(snapshot.rig.blocks[4].empty).toBe(true);
    expect(snapshot.rig.blocks[0].parameters.map((parameter) => parameter.id)).toEqual(expect.arrayContaining(["SltEQOn", "SltEQF", "SltEQG", "SltEQQ", "SltEQHP", "SltEQLP"]));
    expect(snapshot.rig.tempo).toBeCloseTo(120, 0);
    expect(snapshot.loadedSetlistName).toBe("Plays");
    expect(snapshot.cloud.loggedIn).toBe(true);
    expect(snapshot.tone3000.loggedIn).toBe(true);
  });

  it("converts displayed parameter values back to reflected normalized values", () => {
    const parameter: Parameter = { id: "gain", label: "Gain", value: 50, min: 0, max: 100, normalized: true, normalizeAlgo: 0 };
    expect(normalizeValue(50, parameter)).toBeCloseTo(0.5);
  });

  it("preserves reflected integer bounds for MIDI and assignment editors", () => {
    const [parameter] = parametersForObject({
      meta: { properties: { Channel: { type: "integer", minimum: 1, maximum: 16 } } },
      value: { Channel: 7 },
    });
    expect(parameter).toMatchObject({ id: "Channel", value: 7, min: 1, max: 16, step: 1, normalized: false });
  });

  it("keeps reflected labels aligned when an editor requests a custom property group", () => {
    const input = capturedTree["/Evil/Engine/Patch/Input"];
    const parameters = parametersForObject(input, ["RigInput", "InputGain", "GateRelease", "Lock"]);
    expect(parameters.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "RigInput", label: "Rig Input" },
      { id: "InputGain", label: "Input Gain" },
      { id: "GateRelease", label: "Gate Rel" },
      { id: "Lock", label: "Lock" },
    ]);
    expect(parameters[0]).toMatchObject({ value: "Guitar", choices: ["Guitar", "FX Ret L"], choiceValues: [false, true] });
    expect(parameters[3]).toMatchObject({ value: "Unlocked", choices: ["Unlocked", "Locked"], choiceValues: [false, true] });
  });

  it("round-trips every reflected numeric FX and global EQ control", () => {
    const failures: string[] = [];
    for (const [path, object] of Object.entries(capturedTree)) {
      if (!path.startsWith("/Evil/Engine/Patch/") && !path.startsWith("/Evil/Engine/GlobalEQ")) continue;
      for (const parameter of parametersForObject(object)) {
        if (typeof parameter.rawValue !== "number" || typeof parameter.value !== "number") continue;
        const encoded = parameterDeviceValue(parameter, parameter.value);
        if (typeof encoded !== "number" || !Number.isFinite(encoded) || Math.abs(encoded - parameter.rawValue) > 0.00001) failures.push(`${path}.${parameter.id}: ${parameter.rawValue} -> ${parameter.value} -> ${String(encoded)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("turns firmware file metadata into a device-library selector", () => {
    const [parameter] = parametersForObject({
      meta: { properties: { LoadedClone: { type: "string", "x-options": { fileType: 9, startPath: "Neural Amp Modeler" } } } },
      value: { LoadedClone: "Neural Amp Modeler/Tone 3000/example.nam", order: ["LoadedClone"], labels: ["NAM profile"] },
    });
    expect(parameter).toMatchObject({
      id: "LoadedClone",
      label: "NAM profile",
      value: "Neural Amp Modeler/Tone 3000/example.nam",
      deviceFile: { fileType: 9, startPath: "Neural Amp Modeler" },
    });
  });

  it("uses reflected companion lists for dynamic drum kit and variation selectors", () => {
    const parameters = parametersForObject(capturedTree["/Evil/Engine/DrumsCtrl"], ["Kit", "StyleVari"]);
    expect(parameters[0]).toMatchObject({ id: "Kit", value: "Rock 1 (A)", choices: ["Rock 1 (A)"], choiceValues: ["Rock 1 (A)"] });
    expect(parameters[1]).toMatchObject({ id: "StyleVari", value: "Connie", choices: ["Connie", "Cry", "Dust", "Mojo", "Shuffle", "Sign"] });
  });

  it.each([
    ["split bipolar", .25, { minimum: -10, maximum: 10, "x-options": { normalizeAlgo: 1 } }],
    ["quadratic bipolar", .75, { minimum: -100, maximum: 100, "x-options": { normalizeAlgo: 4 } }],
    ["quadratic", .36, { minimum: 0, maximum: 100, "x-options": { normalizeAlgo: 5 } }],
    ["log frequency", .4, { minimum: 20, maximum: 20_000, "x-options": { normalizeAlgo: 6 } }],
    ["decibels", .5, { minimum: -200, maximum: 0, "x-options": { normalizeAlgo: 2 } }],
    ["exponential time", .6, { minimum: 0, maximum: 1, "x-options": { normalizeAlgo: 7 } }],
    ["offset decibels", .5, { minimum: -200, maximum: 6, "x-options": { normalizeAlgo: 8 } }],
    ["piecewise gain", .1, { minimum: 0, maximum: 1, "x-options": { normalizeAlgo: 9 } }],
    ["piecewise gain upper", .7, { minimum: 0, maximum: 1, "x-options": { normalizeAlgo: 9 } }],
    ["ratio", .5, { minimum: .45, maximum: 145, "x-options": { normalizeAlgo: 10 } }],
  ] as const)("round-trips the %s reflection normalization", (_label, raw, meta) => {
    const display = denormalizeValue(raw, meta);
    const parameter: Parameter = {
      id: "value", label: "Value", value: display, normalized: true,
      min: meta.minimum, max: meta.maximum, normalizeAlgo: meta["x-options"].normalizeAlgo,
    };
    expect(normalizeValue(display, parameter)).toBeCloseTo(raw, 6);
  });

  it("handles normalization boundary and fallback cases without invalid values", () => {
    expect(normalizeValue(-240, { id: "gate", label: "Gate", value: -240, min: -240, max: 6, normalized: true, normalizeAlgo: 8 })).toBe(0);
    expect(normalizeValue(145, { id: "ratio", label: "Ratio", value: 145, min: .45, max: 145, normalized: true, normalizeAlgo: 10 })).toBe(1);
    expect(denormalizeValue(.4, { type: "number", minimum: 0, maximum: 100, "x-options": { normalizeAlgo: 6 } })).toBe(40);
    expect(normalizeValue(40, { id: "linear-log", label: "Fallback", value: 40, min: 0, max: 100, normalized: true, normalizeAlgo: 6 })).toBeCloseTo(.4);
    expect(colorForIndex(-100)).toBe(colorForIndex(0));
    expect(colorForIndex(10_000)).toBe(colorForIndex(13));
  });

  it("filters firmware-only properties while preserving writable fallbacks and choice encodings", () => {
    const parameters = parametersForObject({
      meta: { properties: {
        Hidden: { type: "string" }, ReadOnly: { type: "string", readOnly: true }, Missing: { type: "string" },
        IRName: { type: "string" }, FileMissing2: { type: "string" }, Enabled: { type: "boolean", "x-options": { strings: ["Off", "On"] } },
        Plain: { type: "string" },
      } },
      value: { order: ["Hidden", "ReadOnly", "Missing", "IRName", "FileMissing2", "Enabled", "Plain"], labels: ["", "", "", "", "", "Enabled", "Plain"], disabled: ["Hidden"], ReadOnly: "firmware", IRName: "Cab", FileMissing2: "", Enabled: true, Plain: "value" },
    });
    expect(parameters.map((parameter) => parameter.id)).toEqual(["Enabled", "Plain"]);
    expect(parameters[0]).toMatchObject({ value: "On", choices: ["Off", "On"], choiceValues: [false, true] });
    expect(parameterDeviceValue(parameters[0], "Off")).toBe(false);
    expect(parameters[1]).toMatchObject({ value: "value", writable: true });
  });

  it("parses a sparse reflection tree into safe user-facing defaults", () => {
    const snapshot = parseHeadRushSubtree({});
    expect(snapshot.deviceName).toBe("HeadRush device");
    expect(snapshot.firmware).toBe("Unknown");
    expect(snapshot.rig).toMatchObject({ id: "current-rig", name: "Current rig", tempo: 0 });
    expect(snapshot.rig.blocks).toHaveLength(14);
    expect(snapshot.rig.blocks.every((block) => block.empty)).toBe(true);
    expect(snapshot.routing.label).toBe("Straight");
    expect(snapshot.storage).toMatchObject({ usedPercent: 0, usedLabel: "Unknown", capacityLabel: "Unknown" });
    expect(snapshot.footswitches).toHaveLength(6);
  });
});
