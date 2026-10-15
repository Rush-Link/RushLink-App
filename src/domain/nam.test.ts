import { describe, expect, it } from "vitest";
import type { RigBlock, ToneModel } from "./types";
import { allocateModuleType, baseModuleName, namCapacity, namModules, namParameterValue, parseNamModule, selectPreferredNamModel, validateNamCapacity } from "./nam";

const catalogue = ["Empty Slot", "Neural Amp Modeler", "Neural Amp Modeler 2", "Tape Echo", "Tape Echo 2", "Tape Echo 3"];
const models: ToneModel[] = [
  { id: "a1", remoteId: 1, name: "Legacy capture", architecture: "A1", url: "a1.nam" },
  { id: "a2-one", remoteId: 2, name: "Clean capture", architecture: "A2", url: "clean.nam" },
  { id: "a2-two", remoteId: 3, name: "Lead capture", architecture: "A2", url: "lead.nam" },
];
const host = (id: string, doubled = false): RigBlock => ({ id, name: "Neural Amp Modeler", model: "Neural Amp Modeler", category: "clone", color: "#fff", enabled: true, slot: 1, parameters: [{ id: "Doubling", label: "Doubling", value: doubled }] });

describe("NAM architecture and reflected host allocation", () => {
  it("keeps architecture numbers separate from arbitrary DSP instance suffixes", () => {
    expect(parseNamModule("Neural Amp Modeler 12")).toMatchObject({ instance: 12, baseName: "Neural Amp Modeler" });
    expect(parseNamModule("NAM2 Lite")).toBeNull();
    expect(baseModuleName("Tape Echo 3")).toBe("Tape Echo");
    expect(namModules(catalogue).map((module) => [module.instance, module.moduleTypeId])).toEqual([[1, 1], [2, 2]]);
  });

  it("allocates independent reflected objects without inventing a third NAM host", () => {
    expect(allocateModuleType(catalogue, ["Neural Amp Modeler"], new Set([1]))).toBe(2);
    expect(allocateModuleType(catalogue, ["Neural Amp Modeler"], new Set([1, 2]))).toBeNull();
    expect(allocateModuleType(catalogue, ["Tape Echo"], new Set([3, 4]))).toBe(5);
    expect(allocateModuleType(catalogue, ["Neural Amp Modeler"], new Set(), 2)).toBe(2);
    expect(allocateModuleType(catalogue, ["Neural Amp Modeler"], new Set(), 3)).toBeNull();
  });

  it("preserves an explicit model in auto mode and prioritizes A2 for Full and Lite", () => {
    expect(selectPreferredNamModel(models, "auto", "", "a1")?.id).toBe("a1");
    expect(selectPreferredNamModel(models, "nam2", "", "a1")?.id).toBe("a2-one");
    expect(selectPreferredNamModel(models, "nam2-lite", "", "a2-two")?.id).toBe("a2-two");
    expect(selectPreferredNamModel(models, "other", "A1", "a2-two")?.id).toBe("a1");
    expect(selectPreferredNamModel(models, "other", "Lead capture")?.id).toBe("a2-two");
    expect(selectPreferredNamModel([], "nam2")).toBeUndefined();
  });

  it("derives host and file-lane capacity from the connected firmware catalogue", () => {
    expect(namCapacity(catalogue)).toEqual({ hostCount: 2, maxA2FullFiles: 2, maxA2LiteFiles: 4 });
    expect(namCapacity(catalogue.filter((name) => name !== "Neural Amp Modeler 2"))).toEqual({ hostCount: 1, maxA2FullFiles: 1, maxA2LiteFiles: 1 });
    expect(validateNamCapacity([host("legacy-double", true)], ["Empty Slot", "Neural Amp Modeler"]).valid).toBe(false);
    expect(validateNamCapacity([host("one", true), host("two", true)], catalogue)).toMatchObject({ valid: true, hostCountUsed: 2, fullFiles: 4, warnings: [expect.stringMatching(/Lite/)] });
    expect(validateNamCapacity([host("one"), host("two"), host("three")], catalogue)).toMatchObject({ valid: false, errors: [expect.stringMatching(/exposes 2 NAM hosts/)] });
  });

  it("decodes displayed boolean mode choices when counting doubled lanes", () => {
    const block = host("one");
    block.parameters = [{ id: "Doubling", label: "Doubling", value: "Double", choices: ["Single", "Double"], choiceValues: [false, true] }];
    expect(namParameterValue(block.parameters, "Doubling")).toBe(true);
    expect(validateNamCapacity([block], catalogue)).toMatchObject({ fullFiles: 2, hostCountUsed: 1 });
  });
});
