import { beforeEach, describe, expect, it } from "vitest";
import { testRigTemplates } from "../data/demo-data";
import type { RigBlock } from "../domain/types";
import { migratePersistedTestRigIrCuts, migratePersistedTestRigIrFiles, migratePersistedTestRigNamControls, useAppStore } from "./app-store";

describe("ToneMod local test sets", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      testRigs: structuredClone(testRigTemplates),
      selectedTestRigId: testRigTemplates[0].id,
      testRigSets: [{ id: "reference", name: "Reference Run", rigIds: testRigTemplates.slice(0, 2).map((rig) => rig.id) }],
      selectedTestRigSetId: "reference",
      testRigReturn: null,
    });
  });

  it("creates and edits independent local test sets", () => {
    useAppStore.getState().createTestRigSet("High Gain Checks");
    const createdId = useAppStore.getState().selectedTestRigSetId;
    useAppStore.getState().addTestRigToSetlist("metal");
    useAppStore.getState().addTestRigToSetlist("lead");
    useAppStore.getState().moveTestRigInSetlist(1, 0);
    useAppStore.getState().renameTestRigSet("NAM Shootout");

    const created = useAppStore.getState().testRigSets.find((setlist) => setlist.id === createdId);
    expect(created).toMatchObject({ name: "NAM Shootout", rigIds: ["lead", "metal"] });
    expect(useAppStore.getState().testRigSets.find((setlist) => setlist.id === "reference")?.rigIds).toEqual(["clean", "overdrive"]);
  });

  it("does not allow deleting the final local test set", () => {
    useAppStore.getState().deleteTestRigSet();
    expect(useAppStore.getState().testRigSets).toHaveLength(1);
  });

  it("protects the capture marker and required input/output blocks", () => {
    const rig = useAppStore.getState().testRigs[0];
    const capture = rig.blocks.find((block) => block.name === "Capture slot")!;
    const input = rig.blocks.find((block) => block.category === "input")!;
    const output = rig.blocks.find((block) => block.category === "output")!;

    useAppStore.getState().toggleTestRigBlock(capture.id);
    useAppStore.getState().removeTestRigBlock(capture.id);
    useAppStore.getState().removeTestRigBlock(input.id);
    useAppStore.getState().removeTestRigBlock(output.id);

    const updated = useAppStore.getState().testRigs[0];
    expect(updated.blocks.find((block) => block.id === capture.id)?.enabled).toBe(capture.enabled);
    expect(updated.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: capture.id }),
      expect.objectContaining({ id: input.id }),
      expect.objectContaining({ id: output.id }),
    ]));
  });

  it("edits NAM host controls while keeping its structure and file selector protected", () => {
    const rig = useAppStore.getState().testRigs[0];
    const capture = rig.blocks.find((block) => block.name === "Capture slot")!;
    const input = capture.parameters.find((parameter) => parameter.id === "Input")!;
    capture.parameters.push({ id: "LoadedClone", sourceProperty: "LoadedClone", label: "NAM file", value: "Models/original.nam", writable: true, deviceFile: { fileType: 7, startPath: "Models" } });

    useAppStore.getState().updateTestRigParameter(capture.id, input.id, 6.2);
    useAppStore.getState().updateTestRigParameter(capture.id, "LoadedClone", "Models/replaced.nam");
    expect(useAppStore.getState().testRigs[0].blocks.find((block) => block.id === capture.id)?.parameters.find((parameter) => parameter.id === "LoadedClone")?.value).toBe("Models/original.nam");
    useAppStore.getState().updateTestRigBlock(capture.id, { name: "Replace me", model: "IR", category: "ir", enabled: false });

    const updated = useAppStore.getState().testRigs[0].blocks.find((block) => block.id === capture.id)!;
    expect(updated).toMatchObject({ name: "Capture slot", model: "Neural Amp Modeler", category: "clone", enabled: true, slot: 6 });
    expect(updated.parameters.find((parameter) => parameter.id === "Input")?.value).toBe(6.2);
    expect(updated.parameters.some((parameter) => parameter.id === "LoadedClone")).toBe(false);
  });

  it("migrates legacy capture markers to real NAM controls without retaining a NAM file", () => {
    const legacy = structuredClone(testRigTemplates[0]);
    const capture = legacy.blocks.find((block) => block.name === "Capture slot")!;
    capture.parameters = [
      { id: "Input", sourceProperty: "Input", label: "Input", value: 7.5, writable: true },
      { id: "mix", sourceProperty: "mix", label: "Mix", value: 42, writable: true },
      { id: "LoadedClone", sourceProperty: "LoadedClone", label: "NAM file", value: "Models/private.nam", writable: true, deviceFile: { fileType: 7, startPath: "Models" } },
    ];

    const [migrated] = migratePersistedTestRigNamControls([legacy]);
    const parameters = migrated.blocks.find((block) => block.name === "Capture slot")!.parameters;
    expect(parameters.find((parameter) => parameter.id === "Input")).toMatchObject({ value: 7.5, min: -20, max: 20, normalized: true });
    expect(parameters.find((parameter) => parameter.id === "Output")).toMatchObject({ value: 0, min: -40, max: 40, normalized: true });
    expect(parameters.map((parameter) => parameter.id)).toEqual(expect.arrayContaining(["Output", "Threshold", "Gate", "EQ", "Bass", "Middle", "Treble", "Normalize", "LightMode"]));
    expect(parameters.some((parameter) => parameter.deviceFile || /LoadedClone|FileMissing/i.test(parameter.id))).toBe(false);
    expect(parameters.some((parameter) => parameter.id === "mix")).toBe(false);
    expect(migratePersistedTestRigNamControls([migrated])).toEqual([migrated]);
  });

  it("adds reference blocks to open unrestricted slots without moving fixed hosts", () => {
    const rig = useAppStore.getState().testRigs[0];
    const originalCaptureSlot = rig.blocks.find((block) => block.name === "Capture slot")?.slot;
    const originalOutputSlot = rig.blocks.find((block) => block.category === "output")?.slot;
    const block: RigBlock = { id: "reference-eq", name: "Reference EQ", model: "Para EQ", category: "eq", color: "#6ee7f2", enabled: true, slot: 0, parameters: [] };

    useAppStore.getState().addTestRigBlock(block);
    const updated = useAppStore.getState().testRigs[0];
    expect(updated.blocks.find((item) => item.id === block.id)?.slot).toBe(2);
    expect(updated.blocks.find((item) => item.name === "Capture slot")?.slot).toBe(originalCaptureSlot);
    expect(updated.blocks.find((item) => item.category === "output")?.slot).toBe(originalOutputSlot);
  });

  it("supports exact-slot moves, duplication, block metadata, and rig details", () => {
    useAppStore.getState().selectTestRig("lead");
    const delay = useAppStore.getState().testRigs.find((rig) => rig.id === "lead")!.blocks.find((block) => block.category === "delay")!;
    useAppStore.getState().moveTestRigBlock(delay.id, 10);
    useAppStore.getState().updateTestRigBlock(delay.id, { presetName: "Reference Echo" });
    useAppStore.getState().duplicateTestRigBlock(delay.id);
    useAppStore.getState().updateTestRigDetails({ name: "Lead comparison", description: "Live editable reference chain" });

    const updated = useAppStore.getState().testRigs.find((rig) => rig.id === "lead")!;
    expect(updated).toMatchObject({ name: "Lead comparison", description: "Live editable reference chain" });
    expect(updated.blocks.find((block) => block.id === delay.id)).toMatchObject({ slot: 10, presetName: "Reference Echo" });
    expect(updated.blocks.some((block) => block.id.startsWith("test-copy-") && block.model === delay.model)).toBe(true);
  });

  it("rejects incompatible exact-slot additions and metadata changes", () => {
    useAppStore.getState().selectTestRig("overdrive");
    const rig = useAppStore.getState().testRigs.find((item) => item.id === "overdrive")!;
    const drive = rig.blocks.find((block) => block.category === "overdrive")!;
    const delay: RigBlock = { id: "wrong-delay", name: "Delay", model: "Tape Echo", category: "delay", color: "#fff", enabled: true, slot: 6, parameters: [] };

    useAppStore.getState().addTestRigBlock(delay, 6);
    useAppStore.getState().updateTestRigBlock(drive.id, { name: "Delay", model: "Tape Echo", category: "delay" });

    const updated = useAppStore.getState().testRigs.find((item) => item.id === "overdrive")!;
    expect(updated.blocks.some((block) => block.id === delay.id)).toBe(false);
    expect(updated.blocks.find((block) => block.id === drive.id)).toMatchObject({ category: "overdrive", model: "B2 Drive", slot: 3 });
  });

  it("ignores invalid test-rig and test-set selections", () => {
    const originalRig = useAppStore.getState().selectedTestRigId;
    const originalSet = useAppStore.getState().selectedTestRigSetId;
    useAppStore.getState().selectTestRig("missing");
    useAppStore.getState().selectTestRigSet("missing");
    expect(useAppStore.getState()).toMatchObject({ selectedTestRigId: originalRig, selectedTestRigSetId: originalSet });
  });

  it("repairs blank IR selections in every seeded Test Rig", () => {
    const legacy = structuredClone(testRigTemplates).map((rig) => ({
      ...rig,
      blocks: rig.blocks.map((block) => block.category !== "ir" ? block : {
        ...block,
        parameters: block.parameters.map((parameter) => parameter.id === "IR" ? { ...parameter, value: "   " } : parameter),
      }),
    }));

    const repaired = migratePersistedTestRigIrFiles(legacy);

    for (const rig of repaired) {
      const ir = rig.blocks.find((block) => block.category === "ir")!;
      expect(ir.parameters.find((parameter) => parameter.id === "IR"), rig.name).toMatchObject({
        value: expect.stringMatching(/^Impulse Responses\/Choptones\/.+\.wav$/i),
        sourceProperty: "IR",
        deviceFile: { fileType: 2, startPath: "Impulse Responses" },
      });
    }
  });

  it("adds a missing IR file control to an older persisted block", () => {
    const legacy = structuredClone(testRigTemplates[0]);
    const ir = legacy.blocks.find((block) => block.category === "ir")!;
    ir.parameters = ir.parameters.filter((parameter) => parameter.id !== "IR");

    const [repaired] = migratePersistedTestRigIrFiles([legacy]);
    expect(repaired.blocks.find((block) => block.category === "ir")?.parameters[0]).toMatchObject({
      id: "IR",
      value: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav",
      deviceFile: { fileType: 2 },
    });
  });

  it("never overwrites a non-empty user-selected IR", () => {
    const customized = structuredClone(testRigTemplates[0]);
    customized.blocks.find((block) => block.category === "ir")!.parameters.find((parameter) => parameter.id === "IR")!.value = "Impulse Responses/User/My Cab.wav";

    const [repaired] = migratePersistedTestRigIrFiles([customized]);
    expect(repaired.blocks.find((block) => block.category === "ir")?.parameters.find((parameter) => parameter.id === "IR")?.value).toBe("Impulse Responses/User/My Cab.wav");
  });

  it("updates legacy seeded IR cuts once while preserving user-adjusted values", () => {
    const legacy = structuredClone(testRigTemplates.find((rig) => rig.id === "clean")!);
    const ir = legacy.blocks.find((block) => block.id === "clean-ir")!;
    ir.parameters.find((parameter) => parameter.id === "LoCut")!.value = 75;
    ir.parameters.find((parameter) => parameter.id === "HiCut")!.value = 9300;

    const [migrated] = migratePersistedTestRigIrCuts([legacy]);
    const parameters = migrated.blocks.find((block) => block.id === "clean-ir")!.parameters;
    expect(parameters.find((parameter) => parameter.id === "LoCut")?.value).toBe(65);
    expect(parameters.find((parameter) => parameter.id === "HiCut")?.value).toBe(9300);
  });

  it("keeps the selected IR when refreshed device controls return an empty file value", () => {
    const rig = useAppStore.getState().testRigs[0];
    const ir = rig.blocks.find((block) => block.category === "ir")!;
    const selected = ir.parameters.find((parameter) => parameter.id === "IR")!;

    useAppStore.getState().updateTestRigBlock(ir.id, {
      parameters: [{ ...selected, value: "", deviceFile: undefined }],
    });

    const refreshed = useAppStore.getState().testRigs[0].blocks.find((block) => block.id === ir.id)!;
    expect(refreshed.parameters.find((parameter) => parameter.id === "IR")).toMatchObject({
      value: selected.value,
      deviceFile: selected.deviceFile,
    });
  });

  it("keeps a rig unique within a test set and ignores invalid reorder indexes", () => {
    useAppStore.getState().addTestRigToSetlist("clean");
    useAppStore.getState().addTestRigToSetlist("clean");
    useAppStore.getState().addTestRigToSetlist("missing-rig");
    useAppStore.getState().moveTestRigInSetlist(-1, 1);
    useAppStore.getState().moveTestRigInSetlist(0, 99);

    expect(useAppStore.getState().testRigSets[0].rigIds).toEqual(["clean", "overdrive"]);
  });

  it("preserves the existing test-set name when a rename is blank", () => {
    useAppStore.getState().renameTestRigSet("   ");
    expect(useAppStore.getState().testRigSets[0].name).toBe("Reference Run");
  });
});
