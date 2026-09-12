import type { BlockCategory, CloudTone, HeadRushObject, Parameter, RigBlock } from "./types";
import { CAPTURE_SLOT_NAME, adaptAuditionChain } from "./tone-analysis";
import { parameterDeviceValue, parametersForObject } from "./headrush-reflection";

export interface TestRigDeviceAssignment {
  slot: number;
  moduleTypeId: number;
  moduleName: string;
  block: RigBlock;
  enabled: boolean;
  capture: boolean;
}

export interface TestRigDevicePlan {
  assignments: TestRigDeviceAssignment[];
  clearSlots: number[];
  captureSlot: number | null;
  applied: boolean;
  complete: boolean;
  skippedBlocks: string[];
  message: string;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
const baseModuleName = (value: string) => value.replace(/ 2$/, "");
const modulePath = (name: string) => `/Evil/Engine/Patch/${name.replaceAll(" ", "_")}`;

const CATEGORY_FALLBACK: Partial<Record<BlockCategory, string[]>> = {
  amp: ["Amp"], cab: ["Cab", "IR"], ir: ["IR", "Cab"], clone: ["Amp Clone", "Neural Amp Modeler"],
  overdrive: ["Green JRC-OD"], distortion: ["D1 Dist"], delay: ["Tape Echo", "AIR Delay"],
  reverb: ["AIR Reverb", "Eleven Reverb"], eq: ["Para EQ", "Graphic EQ"], compressor: ["Gray Comp"],
  chorus: ["Chorus"], phaser: ["Orange Phaser"], filter: ["AIR Filter"], pitch: ["Wham"],
  dynamics: ["Volume"], utility: ["Noise Filter"], "fx-loop": ["FX-Loop"],
};

function moduleId(moduleTypes: string[], candidates: string[], unavailable = new Set<number>()): number | null {
  for (const candidate of candidates) {
    const exact = moduleTypes.findIndex((name) => normalize(name) === normalize(candidate));
    if (exact > 0 && !unavailable.has(exact)) return exact;
  }
  // Flex Prime exposes a second DSP instance as a separate module type
  // (for example IR 2 or Dyn Delay 2) and a matching reflected object path.
  for (const candidate of candidates) {
    const second = moduleTypes.findIndex((name) => normalize(name) === normalize(`${baseModuleName(candidate)} 2`));
    if (second > 0 && !unavailable.has(second)) return second;
  }
  return null;
}

function isCaptureModule(name: string, source: CloudTone["source"], remoteKind: CloudTone["remoteKind"] | undefined, captureType: Parameters<typeof adaptAuditionChain>[1]): boolean {
  const base = baseModuleName(name);
  if (captureType === "ir") return /^(?:IR(?: \(1024\))?|ReValver Cab)$/.test(base);
  if (source === "Tone3000") return base === "Neural Amp Modeler";
  if (remoteKind === "clone") return ["Amp Clone", "Pedal Clone", "SuperClone"].includes(base);
  return /Clone|Neural Amp Modeler/.test(base);
}

function isCabModule(name: string): boolean {
  return /^(?:IR(?: \(1024\))?|Cab|ReValver Cab)(?: 2)?$/.test(name);
}

/**
 * Resolves the provider-created host, then rebuilds the temporary device chain
 * at the exact 14-slot positions saved by Test Rig Studio. Input/output cards
 * remain visual boundaries and are not device modules.
 */
export function buildTestRigDevicePlan(input: {
  blocks: RigBlock[];
  captureType: Parameters<typeof adaptAuditionChain>[1];
  source: CloudTone["source"];
  remoteKind?: CloudTone["remoteKind"];
  moduleTypes: string[];
  currentModuleTypeIds: number[];
  previousModuleTypeIds?: number[];
}): TestRigDevicePlan {
  const current = Array.from({ length: 14 }, (_, slot) => input.currentModuleTypeIds[slot] ?? 0);
  if (input.source === "HeadRush Cloud" && input.remoteKind !== "clone" && input.captureType !== "ir") {
    return { assignments: [], clearSlots: [], captureSlot: null, applied: false, complete: true, skippedBlocks: [], message: "The HeadRush Cloud rig supplies its complete temporary signal chain." };
  }

  const captureCandidates = current.flatMap((id, slot) => {
    const name = input.moduleTypes[id] ?? "";
    if (!id || !isCaptureModule(name, input.source, input.remoteKind, input.captureType)) return [];
    const changed = input.previousModuleTypeIds?.[slot] !== id;
    return [{ slot, id, name, changed }];
  }).sort((left, right) => Number(right.changed) - Number(left.changed) || left.slot - right.slot);
  const capture = captureCandidates[0];
  if (!capture) return { assignments: [], clearSlots: [], captureSlot: null, applied: false, complete: false, skippedBlocks: [], message: "The temporary NAM or IR host did not appear in the device chain." };

  const adapted = adaptAuditionChain(input.blocks, input.captureType)
    .filter((block) => !["input", "output"].includes(block.category))
    .sort((left, right) => left.slot - right.slot);
  const captureBlock = adapted.find((block) => block.name === CAPTURE_SLOT_NAME);
  if (!captureBlock) return { assignments: [], clearSlots: [], captureSlot: capture.slot, applied: false, complete: false, skippedBlocks: [], message: "The Test Rig has no capture marker." };

  const companion = current.flatMap((id, slot) => {
    const name = input.moduleTypes[id] ?? "";
    return id && slot > capture.slot && isCabModule(name) ? [{ slot, id, name }] : [];
  }).sort((left, right) => left.slot - right.slot)[0];

  const assignments: TestRigDeviceAssignment[] = [];
  const skipped: string[] = [];
  const claimedModuleTypes = new Set<number>([capture.id]);
  for (const block of adapted) {
    const slot = block.slot;
    if (slot < 0 || slot >= 14) { skipped.push(block.name); continue; }
    if (block.name === CAPTURE_SLOT_NAME) {
      assignments.push({ slot, moduleTypeId: capture.id, moduleName: capture.name, block, enabled: true, capture: true });
      continue;
    }
    let resolvedId: number | null = null;
    if (["cab", "ir"].includes(block.category) && companion && !claimedModuleTypes.has(companion.id)) resolvedId = companion.id;
    resolvedId ??= moduleId(input.moduleTypes, [block.model, block.name, ...(CATEGORY_FALLBACK[block.category] ?? [])], claimedModuleTypes);
    if (!resolvedId) { skipped.push(block.name); continue; }
    claimedModuleTypes.add(resolvedId);
    assignments.push({
      slot,
      moduleTypeId: resolvedId,
      moduleName: input.moduleTypes[resolvedId],
      block,
      enabled: Boolean((block as RigBlock & { effectiveEnabled?: boolean }).effectiveEnabled),
      capture: false,
    });
  }

  const occupied = new Set(assignments.map((assignment) => assignment.slot));
  const clearSlots = current.flatMap((id, slot) => id && !occupied.has(slot) ? [slot] : []);
  const hasSurroundingFx = assignments.some((assignment) => !assignment.capture);
  const complete = skipped.length === 0;
  const applied = assignments.length > 0 && complete;
  const suffix = skipped.length ? ` Skipped unsupported blocks: ${skipped.join(", ")}.` : "";
  return {
    assignments,
    clearSlots,
    captureSlot: captureBlock.slot,
    applied,
    complete,
    skippedBlocks: skipped,
    message: applied ? hasSurroundingFx ? `Applied ${assignments.filter((assignment) => !assignment.capture).length} Test Rig FX in their saved positions around slot ${captureBlock.slot + 1}.` : `Applied the Test Rig capture and its settings in slot ${captureBlock.slot + 1}.` : `The complete Test Rig could not be resolved.${suffix}`,
  };
}

/** Confirms the 14 reflected device slots exactly match the temporary plan. */
export function testRigPlanMismatches(plan: TestRigDevicePlan, moduleTypeIds: number[]): number[] {
  const expected = Array<number>(14).fill(0);
  for (const assignment of plan.assignments) expected[assignment.slot] = assignment.moduleTypeId;
  return expected.flatMap((moduleTypeId, slot) => Number(moduleTypeIds[slot] ?? 0) === moduleTypeId ? [] : [slot]);
}

function compatibleParameter(block: RigBlock, source: Parameter, target: Parameter): boolean {
  if (normalize(source.id) === normalize(target.id)) return true;
  // Slot EQ/routing controls often reuse labels such as "Mix". They must only
  // bind to their exact reflected Slt* property, never to the effect's main knob.
  if (/^slt/i.test(source.id)) return false;
  if (normalize(source.label) === normalize(target.label)) return true;
  const aliases: Record<string, string[]> = {
    mid: ["middle"],
    time: block.category === "delay" ? ["delay"] : ["time"],
  };
  return (aliases[normalize(source.id)] ?? []).includes(normalize(target.id));
}

function displayValue(source: Parameter, target: Parameter): Parameter["value"] {
  if (typeof source.value !== "number" || typeof target.value !== "number") return source.value;
  const value = source.value;
  if (source.min === 0 && source.max === 10 && target.min === 0 && target.max === 100) return value * 10;
  return Math.min(target.max ?? value, Math.max(target.min ?? value, value));
}

function hasSelectedDeviceFile(parameter: Parameter): boolean {
  if (!parameter.deviceFile || typeof parameter.value !== "string") return false;
  const value = parameter.value.trim();
  return Boolean(value) && !/^(?:none|off|no file|not selected|<none>)$/i.test(value);
}

function exactReflectedParameter(source: Parameter, target: Parameter): boolean {
  const sourceKeys = [source.id, source.sourceProperty].filter((value): value is string => Boolean(value)).map(normalize);
  const targetKeys = [target.id, target.sourceProperty].filter((value): value is string => Boolean(value)).map(normalize);
  return sourceKeys.some((key) => targetKeys.includes(key));
}

/** Produces only properties confirmed by the reflected module schema. */
export function testRigBlockProperties(block: RigBlock, object: HeadRushObject | undefined, enabled: boolean): Record<string, unknown> {
  const reflectedProperties = Object.keys(object?.meta?.properties ?? {});
  const targetParameters = parametersForObject(object, reflectedProperties);
  const properties: Record<string, unknown> = { On: enabled };
  for (const source of block.parameters.filter((parameter) => parameter.writable !== false)) {
    // The provider demo owns the temporary capture file. Test Rig Studio may
    // shape a NAM host, but must never replace its LoadedClone selection.
    if (block.name === CAPTURE_SLOT_NAME && (source.deviceFile || /^(?:LoadedClone|FileMissing)\d*$/i.test(source.sourceProperty || source.id))) continue;
    // Firmware can reflect multiple alternative selectors for one loader
    // (IR/IR2, IR/IR1024, LoadedClone/LoadedClone2). An empty alternative is
    // not an instruction to clear the file that is already selected in the
    // other field, so only populated device-file controls enter the payload.
    if (source.deviceFile && !hasSelectedDeviceFile(source)) continue;
    const target = targetParameters.find((candidate) => exactReflectedParameter(source, candidate))
      ?? targetParameters.find((candidate) => compatibleParameter(block, source, candidate));
    if (!target) continue;
    const value = displayValue(source, target);
    properties[target.sourceProperty ?? target.id] = parameterDeviceValue(target, value);
  }
  return properties;
}

export function testRigModulePath(name: string): string {
  return modulePath(name);
}
