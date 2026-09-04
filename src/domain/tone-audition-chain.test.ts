import { describe, expect, it } from "vitest";
import { testRigTemplates } from "../data/demo-data";
import type { HeadRushObject } from "./types";
import { buildTestRigDevicePlan, testRigBlockProperties, testRigModulePath, testRigPlanMismatches } from "./tone-audition-chain";

const moduleTypes = Array.from({ length: 60 }, () => "");
moduleTypes[0] = "Empty Slot";
moduleTypes[2] = "Amp";
moduleTypes[9] = "IR";
moduleTypes[19] = "Neural Amp Modeler";
moduleTypes[21] = "Gray Comp";
moduleTypes[39] = "Spring Reverb";
moduleTypes[35] = "AIR Reverb";
moduleTypes[45] = "Tape Echo";
moduleTypes[46] = "Tape Echo 2";
moduleTypes[10] = "IR 2";

describe("TonePilot temporary Test Rig planning", () => {
  it("ships every reference Test Rig with its intended IR file", () => {
    const expected = {
      clean: "CT-Fend312EMFDS-4217B.wav",
      overdrive: "CT-Mgan112AlnG-42158.wav",
      distortion: "CT-Brit412V30-160121.wav",
      lead: "CT-Brit412V30-160121.wav",
      rhythm: "CT-Bogie412V30-57421.wav",
      metal: "CT-Bogie412V30-57421.wav",
    };
    for (const rig of testRigTemplates) {
      const parameter = rig.blocks.find((block) => block.category === "ir")?.parameters.find((item) => item.id === "IR");
      expect(parameter, rig.name).toMatchObject({
        value: `Impulse Responses/Choptones/${expected[rig.id as keyof typeof expected]}`,
        sourceProperty: "IR",
        deviceFile: { fileType: 2, startPath: "Impulse Responses" },
      });
    }
  });

  it("builds a complete exact-slot audition plan for every seeded Test Rig", () => {
    const names = ["Empty Slot", "Neural Amp Modeler", "IR"];
    for (const rig of testRigTemplates) for (const block of rig.blocks) {
      if (["input", "output", "clone", "ir"].includes(block.category)) continue;
      if (!names.includes(block.model)) names.push(block.model);
    }
    const captureId = names.indexOf("Neural Amp Modeler");
    const irId = names.indexOf("IR");

    for (const rig of testRigTemplates) {
      const current = Array(14).fill(0);
      current[4] = captureId;
      current[5] = irId;
      const plan = buildTestRigDevicePlan({
        blocks: rig.blocks,
        captureType: "amp",
        source: "Tone3000",
        remoteKind: "tone-group",
        moduleTypes: names,
        currentModuleTypeIds: current,
        previousModuleTypeIds: Array(14).fill(0),
      });
      const expectedSlots = rig.blocks
        .filter((block) => !["input", "output"].includes(block.category))
        .map((block) => block.slot)
        .sort((left, right) => left - right);

      expect(plan, rig.name).toMatchObject({ applied: true, complete: true, captureSlot: 6, skippedBlocks: [] });
      expect(plan.assignments.map((assignment) => assignment.slot).sort((left, right) => left - right), rig.name).toEqual(expectedSlots);
      expect(plan.assignments.find((assignment) => assignment.block.category === "ir"), rig.name).toMatchObject({
        slot: 7,
        moduleName: "IR",
        enabled: true,
      });
    }
  });

  it("rebuilds the chain at the exact saved slots around the provider-loaded NAM block", () => {
    const plan = buildTestRigDevicePlan({
      blocks: testRigTemplates[0].blocks,
      captureType: "amp",
      source: "Tone3000",
      remoteKind: "tone-group",
      moduleTypes,
      currentModuleTypeIds: [55, 0, 0, 0, 19, 9, 0, 0, 0, 0, 0, 0, 0, 0],
      previousModuleTypeIds: [55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });

    expect(plan.applied).toBe(true);
    expect(plan.complete).toBe(true);
    expect(plan.captureSlot).toBe(6);
    expect(plan.clearSlots).toEqual([0, 4]);
    expect(plan.assignments.map(({ slot, moduleTypeId, enabled }) => ({ slot, moduleTypeId, enabled }))).toEqual([
      { slot: 1, moduleTypeId: 21, enabled: true },
      { slot: 5, moduleTypeId: 2, enabled: false },
      { slot: 6, moduleTypeId: 19, enabled: true },
      { slot: 7, moduleTypeId: 9, enabled: true },
      { slot: 9, moduleTypeId: 39, enabled: true },
    ]);
  });

  it("fails safely when the temporary capture cannot be identified", () => {
    const plan = buildTestRigDevicePlan({
      blocks: testRigTemplates[0].blocks,
      captureType: "amp",
      source: "Tone3000",
      moduleTypes,
      currentModuleTypeIds: Array(14).fill(0),
    });
    expect(plan).toMatchObject({ applied: false, assignments: [], clearSlots: [], captureSlot: null });
    expect(plan.message).toMatch(/NAM or IR host did not appear/i);
  });

  it("preserves complete HeadRush Cloud rig demos", () => {
    const plan = buildTestRigDevicePlan({
      blocks: testRigTemplates[0].blocks,
      captureType: "full-rig",
      source: "HeadRush Cloud",
      remoteKind: "rig",
      moduleTypes,
      currentModuleTypeIds: [19, 9],
    });
    expect(plan.applied).toBe(false);
    expect(plan.complete).toBe(true);
    expect(plan.message).toMatch(/complete temporary signal chain/i);
  });

  it("uses the reflected IR host for an IR-only audition", () => {
    const plan = buildTestRigDevicePlan({
      blocks: testRigTemplates[0].blocks,
      captureType: "ir",
      source: "HeadRush Cloud",
      remoteKind: "rig",
      moduleTypes,
      currentModuleTypeIds: [0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(plan.captureSlot).toBe(6);
    expect(plan.assignments.find((assignment) => assignment.capture)).toMatchObject({ slot: 6, moduleName: "IR", moduleTypeId: 9 });
    expect(plan.assignments.find((assignment) => assignment.block.name === "IR Loader")).toMatchObject({ slot: 7, moduleName: "IR 2", moduleTypeId: 10, enabled: false });
  });

  it("allocates separate DSP instances for repeated effect types", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    blocks.push(
      { id: "echo-one", name: "Echo one", model: "Tape Echo", category: "delay", color: "#fff", enabled: true, slot: 2, parameters: [] },
      { id: "echo-two", name: "Echo two", model: "Tape Echo", category: "delay", color: "#fff", enabled: true, slot: 8, parameters: [] },
    );
    const plan = buildTestRigDevicePlan({
      blocks, captureType: "amp", source: "Tone3000", moduleTypes,
      currentModuleTypeIds: [0, 0, 0, 0, 19, 9, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(plan.assignments.filter((assignment) => assignment.block.category === "delay").map((assignment) => [assignment.moduleTypeId, assignment.moduleName])).toEqual([[45, "Tape Echo"], [46, "Tape Echo 2"]]);
    expect(plan.complete).toBe(true);
  });

  it("fails honestly when a second DSP instance is unavailable", () => {
    const singleInstanceCatalogue = [...moduleTypes]; singleInstanceCatalogue[46] = "";
    const blocks = structuredClone(testRigTemplates[0].blocks);
    blocks.push(
      { id: "echo-one", name: "Echo one", model: "Tape Echo", category: "delay", color: "#fff", enabled: true, slot: 2, parameters: [] },
      { id: "echo-two", name: "Echo two", model: "Tape Echo", category: "delay", color: "#fff", enabled: true, slot: 8, parameters: [] },
    );
    const plan = buildTestRigDevicePlan({ blocks, captureType: "amp", source: "Tone3000", moduleTypes: singleInstanceCatalogue, currentModuleTypeIds: [0, 0, 0, 0, 19, 9] });
    expect(plan).toMatchObject({ complete: false, applied: false, skippedBlocks: ["Echo two"] });
  });

  it.each([
    ["IR", "/Evil/Engine/Patch/IR"],
    ["IR 2", "/Evil/Engine/Patch/IR_2"],
    ["IR (1024) 2", "/Evil/Engine/Patch/IR_(1024)_2"],
    ["Neural Amp Modeler 2", "/Evil/Engine/Patch/Neural_Amp_Modeler_2"],
  ])("maps the %s instance to its reflected object", (name, path) => {
    expect(testRigModulePath(name)).toBe(path);
  });

  it("reports every slot that did not match the applied chain", () => {
    const plan = buildTestRigDevicePlan({
      blocks: testRigTemplates[0].blocks,
      captureType: "amp",
      source: "Tone3000",
      moduleTypes,
      currentModuleTypeIds: [0, 0, 0, 0, 19, 9, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(testRigPlanMismatches(plan, [0, 0, 0, 0, 19, 9, 0, 35])).toEqual([1, 4, 5, 6, 7, 9]);
  });

  it("writes only reflected parameters and normalizes their display values", () => {
    const block = testRigTemplates.find((rig) => rig.id === "lead")!.blocks.find((candidate) => candidate.model === "Dyn Delay")!;
    const object: HeadRushObject = {
      meta: { properties: {
        On: { type: "boolean" },
        Mix: { type: "number", minimum: 0, maximum: 100 },
        Delay: { type: "number", minimum: 20, maximum: 2400 },
        Feedback: { type: "number", minimum: 0, maximum: 100 },
      } },
      value: { On: true, Mix: 0.5, Delay: 0.2, Feedback: 0.5, order: ["Mix", "Delay", "Feedback"] },
    };
    const properties = testRigBlockProperties(block, object, false);
    expect(properties.On).toBe(false);
    expect(properties.Mix).toBeCloseTo(0.2);
    expect(properties.Delay).toBeCloseTo((390 - 20) / (2400 - 20));
    expect(properties.Feedback).toBeCloseTo(0.28);
    expect(properties).not.toHaveProperty("level");
  });

  it("writes the configured IR file through the reflected device-file property", () => {
    const block = testRigTemplates[0].blocks.find((candidate) => candidate.category === "ir")!;
    const object: HeadRushObject = {
      meta: { properties: {
        On: { type: "boolean" },
        IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } },
      } },
      value: { On: true, IR: "", order: ["IR"], labels: ["IR File"] },
    };

    expect(testRigBlockProperties(block, object, true)).toMatchObject({
      On: true,
      IR: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav",
    });
  });

  it("does not invent properties missing from the reflected device schema", () => {
    const block = testRigTemplates[0].blocks.find((candidate) => candidate.category === "ir")!;
    const object: HeadRushObject = { meta: { properties: { On: { type: "boolean" }, Gain: { type: "number", minimum: -48, maximum: 18 } } }, value: { On: true, Gain: .5 } };
    const properties = testRigBlockProperties(block, object, true);
    expect(properties).toHaveProperty("On", true);
    expect(properties).not.toHaveProperty("IR");
    expect(properties).not.toHaveProperty("LoCut");
  });

  it("writes the secondary IR channel when that is the reflected file field", () => {
    const source = structuredClone(testRigTemplates[0].blocks.find((candidate) => candidate.category === "ir")!);
    const file = source.parameters.find((parameter) => parameter.id === "IR")!;
    file.id = "IR2"; file.sourceProperty = "IR2";
    const object: HeadRushObject = { meta: { properties: { On: { type: "boolean" }, IR2: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } } } }, value: { On: true, IR2: "" } };
    expect(testRigBlockProperties(source, object, true)).toMatchObject({ On: true, IR2: file.value });
  });

  it("omits blank alternative IR selectors instead of rejecting a populated template file", () => {
    const block = structuredClone(testRigTemplates[0].blocks.find((candidate) => candidate.category === "ir")!);
    const selected = block.parameters.find((parameter) => parameter.id === "IR")!;
    block.name = "IR";
    block.parameters.push({ ...selected, id: "IR2", sourceProperty: "IR2", value: "" });
    const object: HeadRushObject = {
      meta: { properties: {
        On: { type: "boolean" },
        IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } },
        IR2: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } },
      } },
      value: { On: true, IR: "", IR2: "", order: ["IR", "IR2"], labels: ["IR File", "IR File"] },
    };

    expect(testRigBlockProperties(block, object, true)).toEqual({ On: true, IR: selected.value });
  });

  it("writes a populated secondary IR selector without clearing its blank primary alternative", () => {
    const block = structuredClone(testRigTemplates[0].blocks.find((candidate) => candidate.category === "ir")!);
    const primary = block.parameters.find((parameter) => parameter.id === "IR")!;
    const secondary = { ...primary, id: "IR2", sourceProperty: "IR2", value: "Impulse Responses/User/Selected Cab.wav" };
    primary.value = "not selected";
    block.parameters.push(secondary);
    const object: HeadRushObject = {
      meta: { properties: {
        On: { type: "boolean" },
        IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } },
        IR2: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } },
      } },
      value: { On: true, IR: "", IR2: "", order: ["IR", "IR2"], labels: ["IR File", "IR File"] },
    };

    expect(testRigBlockProperties(block, object, true)).toEqual({ On: true, IR2: secondary.value });
  });
});
