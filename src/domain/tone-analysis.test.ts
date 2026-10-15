import { describe, expect, it } from "vitest";
import { addBlockToTestRig, adaptAuditionChain, detectCaptureType, duplicateTestRigBlock, mergeTestRigParameters, normalizeTestRigEffectOrder, normalizeTestRigSlots, placeTestRigBlock, selectedTestRigFile, TEST_RIG_MAX_SLOTS, TEST_RIG_SLOT_ROLES, testRigSlotAllowsBlock, toneProviderReadiness, validateTestRig } from "./tone-analysis";
import { demoCapabilities, demoDevice, testRigTemplates } from "../data/demo-data";
import type { RigBlock } from "./types";

describe("Tone3000 capture analysis", () => {
  it.each([
    ["amp + IR capture with cabinet", "amp+ir"],
    ["Green Screamer overdrive pedal", "effect"],
    ["4x12 cabinet impulse response IR", "ir"],
    ["British high gain amplifier head", "amp"],
    ["complete full rig signal chain", "full-rig"],
  ] as const)("classifies %s", (description, expected) => {
    expect(detectCaptureType({ title: "Test", description, tags: [] })).toBe(expected);
  });

  it("uses token-aware detection and prioritizes an explicit provider type", () => {
    expect(detectCaptureType({ title: "Sample pack", description: "Reference recording", tags: [] })).toBe("unknown");
    expect(detectCaptureType({ title: "Full rig", description: "Complete chain", tags: [], declaredType: "effect" })).toBe("effect");
  });

  it("bypasses the template cabinet when a capture already contains an IR", () => {
    const adapted = adaptAuditionChain(testRigTemplates[0].blocks, "amp+ir");
    expect(adapted.find((block) => block.name === "IR Loader")?.autoBypassed).toBe(true);
    expect(adapted.find((block) => block.name === "Capture slot")?.effectiveEnabled).toBe(true);
  });

  it.each([
    ["amp", ["amp", "clone"]],
    ["amp+ir", ["amp", "clone", "cab", "ir"]],
    ["ir", ["cab", "ir"]],
  ] as const)("adapts %s captures without bypassing the reserved capture slot", (captureType, categories) => {
    const source = testRigTemplates[0].blocks.map((block, index) => ({ ...block, id: `${block.id}-${index}` }));
    const adapted = adaptAuditionChain(source, captureType);
    expect(adapted.find((block) => block.name === "Capture slot")).toMatchObject({ effectiveEnabled: true, autoBypassed: false });
    expect(adapted.filter((block) => block.name !== "Capture slot" && (categories as readonly string[]).includes(block.category)).every((block) => block.autoBypassed)).toBe(true);
  });

  it("keeps effect and unknown captures user-controlled", () => {
    for (const type of ["effect", "unknown"] as const) {
      const adapted = adaptAuditionChain(testRigTemplates[0].blocks, type);
      expect(adapted.every((block) => !block.autoBypassed)).toBe(true);
    }
  });

  it("validates capture slots, slot bounds, and duplicate positions", () => {
    expect(validateTestRig(testRigTemplates[0].blocks)).toMatchObject({ valid: true, captureSlot: 6 });

    const broken = testRigTemplates[0].blocks
      .filter((block) => block.name !== "Capture slot")
      .map((block, index) => ({ ...block, slot: index === 1 ? 0 : block.slot }));
    const result = validateTestRig(broken);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Add one Capture slot before auditioning.",
      "More than one block uses slot 1.",
    ]));
  });

  it("requires a file for enabled file-backed Test Rig blocks", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    const ir = blocks.find((block) => block.category === "ir")!;
    const file = ir.parameters.find((parameter) => parameter.deviceFile)!;
    file.value = "";
    expect(validateTestRig(blocks)).toMatchObject({ valid: false, errors: expect.arrayContaining([expect.stringMatching(/IR Loader requires a selected IR file/i)]) });
  });

  it("accepts an IR loader when one reflected alternative contains the selected file", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    const ir = blocks.find((block) => block.category === "ir")!;
    const selected = ir.parameters.find((parameter) => parameter.deviceFile)!;
    ir.parameters.unshift({ ...selected, id: "IR1024", sourceProperty: "IR1024", label: "IR file", value: "" });

    expect(selectedTestRigFile(ir.parameters)).toMatchObject({ id: "IR", value: expect.stringMatching(/\.wav$/i) });
    expect(validateTestRig(blocks)).toMatchObject({ valid: true, errors: [] });
  });

  it("does not treat device sentinel values as selected files", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    const ir = blocks.find((block) => block.category === "ir")!;
    ir.parameters.find((parameter) => parameter.deviceFile)!.value = "None";
    expect(validateTestRig(blocks).valid).toBe(false);
  });

  it("preserves a selected IR while refreshing an empty reflected loader schema", () => {
    const existing = structuredClone(testRigTemplates[0].blocks.find((block) => block.category === "ir")!.parameters);
    const selected = existing.find((parameter) => parameter.id === "IR")!;
    const reflected = [{ ...selected, value: "", deviceFile: undefined }, { ...selected, id: "Gain", sourceProperty: "Gain", label: "Gain", value: 2, deviceFile: undefined }];
    const merged = mergeTestRigParameters(existing, reflected);

    expect(merged.find((parameter) => parameter.id === "IR")).toMatchObject({ value: selected.value, deviceFile: selected.deviceFile });
    expect(merged.find((parameter) => parameter.id === "Gain")?.value).toBe(2);
  });

  it("allows a deliberately bypassed file block to remain unselected", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    const ir = blocks.find((block) => block.category === "ir")!;
    ir.enabled = false;
    ir.parameters.find((parameter) => parameter.deviceFile)!.value = "";
    expect(validateTestRig(blocks).valid).toBe(true);
  });

  it("deduplicates repeated validation errors", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    const ir = blocks.find((block) => block.category === "ir")!;
    const file = ir.parameters.find((parameter) => parameter.deviceFile)!;
    ir.parameters.push({ ...file, id: "IR-copy", value: "" });
    file.value = "";
    const errors = validateTestRig(blocks).errors.filter((error) => error.toLowerCase().includes("requires a selected ir file"));
    expect(errors).toHaveLength(1);
  });

  it("inserts general blocks in the first open unrestricted slot", () => {
    const source = structuredClone(testRigTemplates[0].blocks);
    const captureSlot = source.find((block) => block.name === "Capture slot")?.slot;
    const addition: RigBlock = { id: "new-eq", name: "Reference EQ", model: "Para EQ", category: "eq", color: "#fff", enabled: true, slot: 0, parameters: [] };
    const result = addBlockToTestRig(source, addition);

    expect(result.find((block) => block.id === addition.id)?.slot).toBe(2);
    expect(result.find((block) => block.name === "Capture slot")?.slot).toBe(captureSlot);
    expect(validateTestRig(result).valid).toBe(true);
  });

  it("refuses duplicate ids and additions beyond the 14-slot limit", () => {
    const full = Array.from({ length: TEST_RIG_MAX_SLOTS }, (_, slot): RigBlock => ({
      id: `block-${slot}`, name: slot === 1 ? "Capture slot" : `Block ${slot}`, model: "Test", category: slot === 0 ? "input" : slot === 13 ? "output" : "utility", color: "#fff", enabled: true, slot, parameters: [],
    }));
    expect(addBlockToTestRig(full, { ...full[2], id: "extra" })).toBe(full);
    const duplicateSource = full.slice(0, -1);
    expect(addBlockToTestRig(duplicateSource, { ...full[2] })).toBe(duplicateSource);
  });

  it("moves editable blocks into empty slots and swaps occupied effect slots", () => {
    const source = structuredClone(testRigTemplates[3].blocks);
    const delay = source.find((block) => block.category === "delay")!;
    const reverb = source.find((block) => block.category === "reverb")!;
    const moved = placeTestRigBlock(source, delay, 10);
    expect(moved.find((block) => block.id === delay.id)?.slot).toBe(10);

    const swapped = placeTestRigBlock(source, delay, reverb.slot);
    expect(swapped.find((block) => block.id === delay.id)?.slot).toBe(reverb.slot);
    expect(swapped.find((block) => block.id === reverb.id)?.slot).toBe(delay.slot);
    expect(validateTestRig(swapped).valid).toBe(true);
  });

  it("protects signal boundaries and the fixed NAM host", () => {
    const source = structuredClone(testRigTemplates[0].blocks);
    const input = source.find((block) => block.category === "input")!;
    const capture = source.find((block) => block.name === "Capture slot")!;
    expect(placeTestRigBlock(source, input, 8)).toBe(source);
    expect(placeTestRigBlock(source, capture, 8).find((block) => block.id === capture.id)?.slot).toBe(6);
  });

  it("enforces the three fixed Test Rig Studio roles while allowing ordered amp placement", () => {
    expect(TEST_RIG_SLOT_ROLES.map(({ slot, id }) => [slot, id])).toEqual([[3, "drive"], [6, "nam"], [7, "ir"]]);
    const drive = { name: "Tri Fuzz", model: "Tri Fuzz", category: "distortion" as const };
    const pedalClone = { name: "Pedal Clone", model: "Pedal Clone", category: "clone" as const };
    const amp = { name: "Reference Amp", model: "Amp", category: "amp" as const };
    const nam = { name: "Capture slot", model: "Neural Amp Modeler", category: "clone" as const };
    const ir = { name: "IR Loader", model: "IR", category: "ir" as const };
    const delay = { name: "Delay", model: "Tape Echo", category: "delay" as const };

    expect(testRigSlotAllowsBlock(3, drive)).toBe(true);
    expect(testRigSlotAllowsBlock(3, pedalClone)).toBe(true);
    expect(testRigSlotAllowsBlock(4, amp)).toBe(true);
    expect(testRigSlotAllowsBlock(5, amp)).toBe(true);
    expect(testRigSlotAllowsBlock(6, nam)).toBe(true);
    expect(testRigSlotAllowsBlock(7, ir)).toBe(true);
    expect(testRigSlotAllowsBlock(3, delay)).toBe(false);
    expect(testRigSlotAllowsBlock(5, delay)).toBe(true);
    expect(testRigSlotAllowsBlock(8, delay)).toBe(true);
    expect(testRigSlotAllowsBlock(5, drive)).toBe(false);
    expect(testRigSlotAllowsBlock(6, amp)).toBe(false);
    expect(testRigSlotAllowsBlock(7, nam)).toBe(false);
    expect(testRigSlotAllowsBlock(2, ir)).toBe(false);
  });

  it("migrates compact legacy chains without losing their block data", () => {
    const legacy = structuredClone(testRigTemplates[1].blocks).map((block, index) => ({ ...block, slot: index }));
    const migrated = normalizeTestRigSlots(legacy);
    expect(migrated).toHaveLength(legacy.length);
    expect(migrated.find((block) => block.category === "overdrive")?.slot).toBe(3);
    expect(migrated.find((block) => block.category === "amp")?.slot).toBe(4);
    expect(migrated.find((block) => block.category === "reverb")?.slot).toBe(8);
    expect(migrated.find((block) => block.name === "Capture slot")?.slot).toBe(6);
    expect(migrated.find((block) => block.category === "ir")?.slot).toBe(7);
    expect(migrated.find((block) => block.category === "input")?.slot).toBe(0);
    expect(migrated.find((block) => block.category === "output")?.slot).toBe(13);
    expect(validateTestRig(migrated).valid).toBe(true);
  });

  it("can repair an older database record without making the order a validation rule", () => {
    const stored = structuredClone(testRigTemplates.find((rig) => rig.id === "lead")!.blocks).map((block) => {
      if (block.category === "delay") return { ...block, slot: 2 };
      if (block.category === "reverb") return { ...block, slot: 4 };
      return block;
    });
    expect(validateTestRig(stored).valid).toBe(true);

    const repaired = normalizeTestRigEffectOrder(normalizeTestRigSlots(stored));
    const ir = repaired.find((block) => block.category === "ir")!;
    const delay = repaired.find((block) => block.category === "delay")!;
    const reverb = repaired.find((block) => block.category === "reverb")!;
    expect([ir.slot, delay.slot, reverb.slot]).toEqual([7, 8, 9]);
    expect(validateTestRig(repaired).valid).toBe(true);
  });

  it("ships six gain-staged sound profiles with writable reflected controls", () => {
    const expected = {
      clean: { amp: "67 Black Duo", ampSlot: 5, drive: undefined, lowCut: 65, highCut: 12000, slots: [0, 1, 5, 6, 7, 9, 13], order: ["input", "compressor", "amp", "clone", "ir", "reverb", "output"] },
      overdrive: { amp: "67 Black Duo", ampSlot: 5, drive: "B2 Drive", lowCut: 65, highCut: 12000, slots: [0, 1, 3, 5, 6, 7, 9, 13], order: ["input", "compressor", "overdrive", "amp", "clone", "ir", "reverb", "output"] },
      distortion: { amp: "67 Plexiglas Vari", ampSlot: 5, drive: "White Boost", lowCut: 65, highCut: 12000, slots: [0, 3, 5, 6, 7, 9, 13], order: ["input", "overdrive", "amp", "clone", "ir", "reverb", "output"] },
      lead: { amp: "82 Lead 800 100W", ampSlot: 5, drive: "S1 Drive", lowCut: 65, highCut: 12000, slots: [0, 3, 5, 6, 7, 8, 9, 13], order: ["input", "overdrive", "amp", "clone", "ir", "delay", "reverb", "output"] },
      rhythm: { amp: "85 M-2 Lead", ampSlot: 4, drive: "Green JRC-OD", lowCut: 65, highCut: 12000, slots: [0, 3, 4, 5, 6, 7, 13], order: ["input", "overdrive", "amp", "eq", "clone", "ir", "output"] },
      metal: { amp: "99 PV51 II Lead", ampSlot: 5, drive: "Green JRC-OD", lowCut: 65, highCut: 12000, slots: [0, 3, 5, 6, 7, 13], order: ["input", "overdrive", "amp", "clone", "ir", "output"] },
    } as const;

    for (const rig of testRigTemplates) {
      const profile = expected[rig.id as keyof typeof expected];
      const amp = rig.blocks.find((block) => block.category === "amp")!;
      const drive = rig.blocks.find((block) => ["drive", "overdrive", "distortion"].includes(block.category));
      const ir = rig.blocks.find((block) => block.category === "ir")!;
      expect(validateTestRig(rig.blocks).valid).toBe(true);
      expect(rig.blocks.map((block) => block.slot).sort((left, right) => left - right)).toEqual(profile.slots);
      expect([...rig.blocks].sort((left, right) => left.slot - right.slot).map((block) => block.category)).toEqual(profile.order);
      expect(amp.slot).toBe(profile.ampSlot);
      expect(rig.blocks.find((block) => block.name === "Capture slot")?.slot).toBe(6);
      expect(ir.slot).toBe(7);
      if (drive) expect(drive.slot).toBe(3);
      expect(amp.parameters.find((parameter) => parameter.id === "Type")?.value).toBe(profile.amp);
      expect(drive?.model).toBe(profile.drive);
      expect(ir.parameters.find((parameter) => parameter.id === "LoCut")?.value, `${rig.name} low cut`).toBe(profile.lowCut);
      expect(ir.parameters.find((parameter) => parameter.id === "HiCut")?.value, `${rig.name} high cut`).toBe(profile.highCut);
      expect(ir.parameters.find((parameter) => parameter.id === "Mix")?.value).toBe(10);
      expect(ir.parameters.some((parameter) => parameter.id === "IR" && typeof parameter.value === "string" && parameter.value.length > 0)).toBe(true);
      expect(rig.blocks.flatMap((block) => block.parameters).every((parameter) => parameter.writable !== false)).toBe(true);
    }
  });

  it("duplicates only editable effects into the next available plan position", () => {
    const source = structuredClone(testRigTemplates[3].blocks);
    const delay = source.find((block) => block.category === "delay")!;
    const duplicated = duplicateTestRigBlock(source, delay.id, "delay-copy");
    expect(duplicated.find((block) => block.id === "delay-copy")).toMatchObject({ model: delay.model, name: `${delay.name} copy` });
    expect(duplicateTestRigBlock(source, source.find((block) => block.name === "Capture slot")!.id, "capture-copy")).toBe(source);
  });

  it("adds, moves and duplicates independent NAM blocks outside the audition marker", () => {
    const source = structuredClone(testRigTemplates[0].blocks);
    const extra: RigBlock = { id: "stacked-nam", name: "Neural Amp Modeler 2", model: "Neural Amp Modeler 2", category: "clone", color: "#fff", enabled: true, slot: 2, parameters: [] };
    const added = addBlockToTestRig(source, extra);
    expect(added.find((block) => block.id === extra.id)?.slot).toBe(2);
    const moved = placeTestRigBlock(added, added.find((block) => block.id === extra.id)!, 8);
    expect(moved.find((block) => block.id === extra.id)?.slot).toBe(8);
    expect(validateTestRig(moved).valid).toBe(true);
    expect(duplicateTestRigBlock(moved, extra.id, "another-nam").find((block) => block.id === "another-nam")).toBeDefined();
    expect(adaptAuditionChain(moved, "amp").find((block) => block.id === extra.id)).toMatchObject({ autoBypassed: false, effectiveEnabled: true });
    expect(adaptAuditionChain(moved, "full-rig").find((block) => block.id === extra.id)?.autoBypassed).toBe(true);
  });

  it("reserves the configured audition slot while freeing the legacy NAM position", () => {
    const moved = normalizeTestRigSlots(structuredClone(testRigTemplates[0].blocks), 8);
    expect(moved.find((block) => block.name === "Capture slot")?.slot).toBe(8);
    expect(validateTestRig(moved, 8).valid).toBe(true);
    expect(testRigSlotAllowsBlock(6, { name: "Extra NAM", model: "Neural Amp Modeler", category: "clone" }, 8)).toBe(true);
    expect(testRigSlotAllowsBlock(8, { name: "Delay", model: "Tape Echo", category: "delay" }, 8)).toBe(false);
  });

  it("requires the user-owned second capture file only when audition host doubling is enabled", () => {
    const blocks = structuredClone(testRigTemplates[0].blocks);
    const capture = blocks.find((block) => block.name === "Capture slot")!;
    capture.parameters = capture.parameters.filter((parameter) => !["Doubling", "LoadedClone2"].includes(parameter.id));
    capture.parameters.push(
      { id: "Doubling", label: "Doubling", value: false },
      { id: "LoadedClone2", label: "Second NAM file", value: "", deviceFile: { fileType: 9, startPath: "Neural Amp Modeler" } },
    );
    expect(validateTestRig(blocks).valid).toBe(true);
    capture.parameters.find((parameter) => parameter.id === "Doubling")!.value = true;
    expect(validateTestRig(blocks).errors).toContainEqual(expect.stringMatching(/both doubled NAM lanes/));
    capture.parameters.find((parameter) => parameter.id === "LoadedClone2")!.value = "Neural Amp Modeler/second.nam";
    expect(validateTestRig(blocks).valid).toBe(true);
  });

  it("reports provider connection, capability, identifier, and login readiness", () => {
    const readyDevice = { ...demoDevice, status: "ready" as const };
    expect(toneProviderReadiness({ native: false, device: null, capabilities: null, subtree: null, source: "Tone3000" }).ready).toBe(true);
    expect(toneProviderReadiness({ native: true, device: null, capabilities: null, subtree: null, source: "Tone3000" }).reason).toMatch(/Connect/);
    expect(toneProviderReadiness({ native: true, device: { ...readyDevice, status: "syncing" }, capabilities: demoCapabilities, subtree: null, source: "Tone3000" }).reason).toMatch(/syncing/);
    expect(toneProviderReadiness({ native: true, device: readyDevice, capabilities: { ...demoCapabilities, flags: { ...demoCapabilities.flags, tone3000: false } }, subtree: null, source: "Tone3000" }).ready).toBe(false);
    expect(toneProviderReadiness({ native: true, device: readyDevice, capabilities: demoCapabilities, subtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: false }, meta: { properties: {} } } }, source: "Tone3000" }).reason).toMatch(/Sign in/);
    expect(toneProviderReadiness({ native: true, device: readyDevice, capabilities: demoCapabilities, subtree: null, source: "HeadRush Cloud" }).reason).toMatch(/identifier/);
    expect(toneProviderReadiness({ native: true, device: readyDevice, capabilities: demoCapabilities, subtree: { "/Evil/Cloud/Master": { value: { isloggedIn: true }, meta: { properties: {} } } }, source: "HeadRush Cloud", remoteId: "cloud-id" })).toEqual({ ready: true, authenticated: true, reason: null });
  });
});
