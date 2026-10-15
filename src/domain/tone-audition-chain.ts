import type { BlockCategory, CloudTone, HeadRushObject, NamPreference, Parameter, RigBlock } from "./types";
import { CAPTURE_SLOT_NAME, adaptAuditionChain } from "./tone-analysis";
import { parameterDeviceValue, parametersForObject } from "./headrush-reflection";
import { allocateModuleType, baseModuleName, isNamBlock, isNamModule, namModules, namParameterValue, validateNamCapacity } from "./nam";

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
  /** Provider host read before creating or clearing any planned DSP host. */
  captureSourceModuleName?: string;
  captureSourceModuleTypeId?: number;
  applied: boolean;
  complete: boolean;
  skippedBlocks: string[];
  message: string;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
const modulePath = (name: string) => `/Evil/Engine/Patch/${name.replaceAll(" ", "_")}`;

const CATEGORY_FALLBACK: Partial<Record<BlockCategory, string[]>> = {
  amp: ["Amp"], cab: ["Cab", "IR"], ir: ["IR", "Cab"], clone: ["Amp Clone", "Neural Amp Modeler"],
  overdrive: ["Green JRC-OD"], distortion: ["D1 Dist"], delay: ["Tape Echo", "AIR Delay"],
  reverb: ["AIR Reverb", "Eleven Reverb"], eq: ["Para EQ", "Graphic EQ"], compressor: ["Gray Comp"],
  chorus: ["Chorus"], phaser: ["Orange Phaser"], filter: ["AIR Filter"], pitch: ["Wham"],
  dynamics: ["Volume"], utility: ["Noise Filter"], "fx-loop": ["FX-Loop"],
};

function isCaptureModule(name: string, source: CloudTone["source"], remoteKind: CloudTone["remoteKind"] | undefined, captureType: Parameters<typeof adaptAuditionChain>[1]): boolean {
  const base = baseModuleName(name);
  if (captureType === "ir") return /^(?:IR(?: \(1024\))?|ReValver Cab)$/.test(base);
  if (source === "Tone3000") return isNamModule(name);
  if (remoteKind === "clone") return ["Amp Clone", "Pedal Clone", "SuperClone"].includes(base);
  return /Clone|Neural Amp Modeler/.test(base);
}

function isCabModule(name: string): boolean {
  return /^(?:IR(?: \(1024\))?|Cab|ReValver Cab)$/.test(baseModuleName(name));
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
  captureSlot?: number;
  namInstance?: number;
  namPreference?: NamPreference;
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

  const adapted = adaptAuditionChain(input.blocks.map((block) => {
    if (block.name !== CAPTURE_SLOT_NAME) return block;
    const lite = input.namPreference === "nam2-lite" ? true : input.namPreference === "nam2" ? false : undefined;
    const parameters = lite === undefined ? block.parameters : [
      ...block.parameters.filter((parameter) => (parameter.sourceProperty ?? parameter.id) !== "LightMode"),
      { id: "LightMode", sourceProperty: "LightMode", label: "Lite mode", value: lite, writable: true },
    ];
    return { ...block, slot: input.captureSlot ?? block.slot, parameters };
  }), input.captureType)
    .filter((block) => !["input", "output"].includes(block.category))
    .sort((left, right) => left.slot - right.slot);
  const captureBlock = adapted.find((block) => block.name === CAPTURE_SLOT_NAME);
  if (!captureBlock) return { assignments: [], clearSlots: [], captureSlot: capture.slot, applied: false, complete: false, skippedBlocks: [], message: "The Test Rig has no capture marker." };

  const selectedHost = input.source === "Tone3000" && input.captureType !== "ir" && input.namInstance !== undefined
    ? namModules(input.moduleTypes).find((module) => module.instance === input.namInstance) : undefined;
  if (input.source === "Tone3000" && input.captureType !== "ir" && input.namInstance !== undefined && !selectedHost) {
    return { assignments: [], clearSlots: [], captureSlot: captureBlock.slot, applied: false, complete: false, skippedBlocks: [], message: `NAM host ${input.namInstance} is not exposed by the connected device.` };
  }
  const targetCapture = selectedHost ? { id: selectedHost.moduleTypeId, name: selectedHost.name } : capture;

  const companion = current.flatMap((id, slot) => {
    const name = input.moduleTypes[id] ?? "";
    return id && slot > capture.slot && isCabModule(name) ? [{ slot, id, name }] : [];
  }).sort((left, right) => left.slot - right.slot)[0];

  const assignments: TestRigDeviceAssignment[] = [];
  const skipped: string[] = [];
  const claimedModuleTypes = new Set<number>([targetCapture.id]);
  for (const block of adapted) {
    const slot = block.slot;
    if (slot < 0 || slot >= 14) { skipped.push(block.name); continue; }
    if (block.name === CAPTURE_SLOT_NAME) {
      assignments.push({ slot, moduleTypeId: targetCapture.id, moduleName: targetCapture.name, block, enabled: true, capture: true });
      continue;
    }
    let resolvedId: number | null = null;
    if (["cab", "ir"].includes(block.category) && companion && !claimedModuleTypes.has(companion.id)) resolvedId = companion.id;
    const reflectedName = block.moduleTypeId ? input.moduleTypes[block.moduleTypeId] : undefined;
    const candidates = [block.model, block.name, ...(reflectedName ? [reflectedName] : []),
      ...(isNamBlock(block) ? ["Neural Amp Modeler"] : CATEGORY_FALLBACK[block.category] ?? [])];
    resolvedId ??= allocateModuleType(input.moduleTypes, candidates, claimedModuleTypes);
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

  // 5.2 automatically makes every A2 lane Lite above two files. Its raw API
  // still accepts writes to disabled LightMode controls, so enforce this in
  // the plan as well instead of sending an unsafe saved Full preference.
  const namAssignments = assignments.filter((assignment) => isNamModule(assignment.moduleName));
  const capacity = validateNamCapacity(namAssignments.map((assignment) => ({ ...assignment.block, model: assignment.moduleName })), input.moduleTypes);
  if (!capacity.valid) return { assignments: [], clearSlots: [], captureSlot: captureBlock.slot,
    captureSourceModuleName: capture.name, captureSourceModuleTypeId: capture.id,
    applied: false, complete: false, skippedBlocks: [], message: capacity.errors.join(" ") };
  const namFileLanes = namAssignments.reduce((count, assignment) => count + (namParameterValue(assignment.block.parameters, "Doubling") === true ? 2 : 1), 0);
  const forcedLite = namFileLanes > 2;
  if (forcedLite) {
    for (const assignment of namAssignments) {
      const lanes = namParameterValue(assignment.block.parameters, "Doubling") === true ? ["LightMode", "LightMode2"] : ["LightMode"];
      assignment.block = { ...assignment.block, parameters: [
        ...assignment.block.parameters.filter((parameter) => !lanes.includes(parameter.sourceProperty ?? parameter.id)),
        ...lanes.map((property) => ({ id: property, sourceProperty: property, label: "Lite mode", value: true, writable: true })),
      ] };
    }
  }

  const occupied = new Set(assignments.map((assignment) => assignment.slot));
  const clearSlots = current.flatMap((id, slot) => id && !occupied.has(slot) ? [slot] : []);
  const hasSurroundingFx = assignments.some((assignment) => !assignment.capture);
  const complete = skipped.length === 0;
  const applied = assignments.length > 0 && complete;
  const suffix = skipped.length ? ` Skipped unsupported blocks: ${skipped.join(", ")}.` : "";
  const modeNotice = forcedLite ? ` All ${namFileLanes} NAM lanes use Lite mode, as required when more than two captures are loaded.` : "";
  return {
    assignments,
    clearSlots,
    captureSlot: captureBlock.slot,
    captureSourceModuleName: capture.name,
    captureSourceModuleTypeId: capture.id,
    applied,
    complete,
    skippedBlocks: skipped,
    message: (applied ? hasSurroundingFx ? `Applied ${assignments.filter((assignment) => !assignment.capture).length} Test Rig FX in their saved positions around slot ${captureBlock.slot + 1}.` : `Applied the Test Rig capture and its settings in slot ${captureBlock.slot + 1}.` : `The complete Test Rig could not be resolved.${suffix}`) + modeNotice,
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
  if (source.choices && typeof target.value !== "string") {
    const raw = parameterDeviceValue(source, source.value);
    if (typeof raw === "boolean" || typeof raw === "number") return raw;
  }
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

/** User-owned NAM files to load before refreshing architecture-dependent controls. */
export function testRigNamFileBindings(block: RigBlock, object?: HeadRushObject): Partial<Record<"LoadedClone" | "LoadedClone2", string>> {
  const bindings: Partial<Record<"LoadedClone" | "LoadedClone2", string>> = {};
  const doubled = namParameterValue(block.parameters, "Doubling") === true;
  for (const parameter of block.parameters) {
    const property = parameter.sourceProperty ?? parameter.id;
    if (property !== "LoadedClone" && property !== "LoadedClone2") continue;
    if (block.name === CAPTURE_SLOT_NAME && property === "LoadedClone") continue;
    if (property === "LoadedClone2" && !doubled) continue;
    if (object && (!object.meta?.properties?.[property] || object.meta.properties[property].readOnly)) continue;
    if (typeof parameter.value !== "string" || !parameter.value.trim() || /^(?:none|off|no file|not selected|<none>)$/i.test(parameter.value.trim())) continue;
    bindings[property] = parameter.value;
  }
  return bindings;
}

/** Produces only properties confirmed by the reflected module schema. */
export function testRigBlockProperties(block: RigBlock, object: HeadRushObject | undefined, enabled: boolean): Record<string, unknown> {
  const disabled = new Set(Array.isArray(object?.value?.disabled) ? object.value.disabled : []);
  const reflectedProperties = Object.keys(object?.meta?.properties ?? {})
    .filter((property) => !disabled.has(property) && !object?.meta?.properties?.[property]?.readOnly);
  const targetParameters = parametersForObject(object, reflectedProperties);
  const properties: Record<string, unknown> = { On: enabled };
  const nam = isNamBlock(block) || block.name === CAPTURE_SLOT_NAME;
  const doubling = namParameterValue(block.parameters, "Doubling") === true;
  for (const source of block.parameters.filter((parameter) => parameter.writable !== false)) {
    // The provider owns lane 1. A doubled NAM's second lane belongs to the user.
    const sourceProperty = source.sourceProperty || source.id;
    if (nam && !doubling && /^(?:LoadedClone|FileMissing|Input|Output|LightMode|CalibrateInput|OutputMode|Normalize)2$/.test(sourceProperty)) continue;
    if (block.name === CAPTURE_SLOT_NAME && ((source.deviceFile && sourceProperty !== "LoadedClone2") || /^(?:LoadedClone|FileMissing)$/i.test(sourceProperty))) continue;
    // 5.2 replaced Normalize with OutputMode. Translate older saved templates
    // only when they do not already carry an explicit new-mode selection.
    if (sourceProperty === "Normalize" && reflectedProperties.includes("OutputMode") && !reflectedProperties.includes("Normalize")) {
      if (!block.parameters.some((parameter) => (parameter.sourceProperty ?? parameter.id) === "OutputMode")) properties.OutputMode = namParameterValue([source], "Normalize") === true ? 2 : 0;
      continue;
    }
    if (sourceProperty === "OutputMode" && !reflectedProperties.includes("OutputMode") && reflectedProperties.includes("Normalize")) {
      if (!block.parameters.some((parameter) => (parameter.sourceProperty ?? parameter.id) === "Normalize")) {
        properties.Normalize = source.value === 2 || String(source.value).toLowerCase() === "normalize";
      }
      continue;
    }
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
