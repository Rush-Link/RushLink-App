import type { CaptureType, CloudTone, DeviceCapabilities, DeviceInfo, HeadRushSubtree, Parameter, RigBlock } from "./types";

type DetectableTone = Pick<CloudTone, "title" | "description" | "tags"> & { declaredType?: string };

export const TEST_RIG_MAX_SLOTS = 14;
export const CAPTURE_SLOT_NAME = "Capture slot";

export type TestRigSlotRoleId = "drive" | "nam" | "ir";

export interface TestRigSlotRole {
  id: TestRigSlotRoleId;
  /** Zero-based slot used by the application and device model. */
  slot: number;
  label: string;
  shortLabel: string;
  description: string;
}

/**
 * Stable ToneMod host positions. The UI presents these as slots 4, 7 and 8,
 * while the model deliberately remains zero-based. Amps remain movable so a
 * post-amp effect can be placed before the fixed NAM and IR hosts.
 */
export const TEST_RIG_SLOT_ROLES: readonly TestRigSlotRole[] = [
  { id: "drive", slot: 3, label: "Drive pedal", shortLabel: "DRIVE", description: "Overdrive, distortion, fuzz or Pedal Clone" },
  { id: "nam", slot: 6, label: "NAM host", shortLabel: "NAM", description: "Reserved Neural Amp Modeler audition host" },
  { id: "ir", slot: 7, label: "IR loader", shortLabel: "IR", description: "IR and IR (1024) loaders only" },
] as const;

export function testRigSlotRole(slot: number) {
  return TEST_RIG_SLOT_ROLES.find((role) => role.slot === slot) ?? null;
}

function testRigBlockRole(block: Pick<RigBlock, "name" | "model" | "category">): TestRigSlotRoleId | null {
  const identity = `${block.name} ${block.model}`.toLowerCase();
  if (block.name === CAPTURE_SLOT_NAME || /neural amp modeler|\bnam(?: clone| host)?\b/.test(identity)) return "nam";
  if (block.category === "ir" && /\bir\b|impulse/.test(identity)) return "ir";
  if (["drive", "overdrive", "distortion"].includes(block.category) || /pedal clone/.test(identity)) return "drive";
  return null;
}

export function reservedTestRigSlotForBlock(block: Pick<RigBlock, "name" | "model" | "category">) {
  const role = testRigBlockRole(block);
  return role ? TEST_RIG_SLOT_ROLES.find((candidate) => candidate.id === role)?.slot ?? null : null;
}

/** A single source of truth used by catalogue filtering, drag/drop and store actions. */
export function testRigSlotAllowsBlock(slot: number, block: Pick<RigBlock, "name" | "model" | "category">) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TEST_RIG_MAX_SLOTS) return false;
  const targetRole = testRigSlotRole(slot)?.id ?? null;
  return targetRole === testRigBlockRole(block);
}

export function canPlaceTestRigBlock(blocks: RigBlock[], block: RigBlock, targetSlot: number) {
  if (!testRigSlotAllowsBlock(targetSlot, block)) return false;
  const existing = blocks.find((item) => item.id === block.id);
  if (existing && ["input", "output"].includes(existing.category)) return false;
  const target = blocks.find((item) => item.slot === targetSlot && item.id !== block.id);
  if (target && ["input", "output"].includes(target.category)) return false;
  return !target || !existing || testRigSlotAllowsBlock(existing.slot, target);
}

/**
 * Canonical cabinet/time-effect order used by templates, persistence and
 * imported sync data: IR -> every delay -> every reverb -> output.
 */
export function normalizeTestRigEffectOrder(blocks: RigBlock[]): RigBlock[] {
  const sorted = [...blocks].sort((left, right) => left.slot - right.slot);
  const ir = sorted.find((block) => block.category === "ir");
  if (!ir) return sorted;
  const outputSlot = sorted.find((block) => block.category === "output")?.slot ?? TEST_RIG_MAX_SLOTS;
  const delays = sorted.filter((block) => block.category === "delay");
  const reverbs = sorted.filter((block) => block.category === "reverb");
  const orderedEffects = [...delays, ...reverbs];
  if (!orderedEffects.length) return sorted;

  const effectIds = new Set(orderedEffects.map((block) => block.id));
  const claimed = new Set(sorted.filter((block) => !effectIds.has(block.id)).map((block) => block.slot));
  const available = Array.from({ length: Math.max(0, outputSlot - ir.slot - 1) }, (_, offset) => ir.slot + offset + 1)
    .filter((slot) => !claimed.has(slot));
  if (available.length < orderedEffects.length) return sorted;

  const assigned = new Map<string, number>();
  let cursor = ir.slot + 1;
  for (const block of orderedEffects) {
    const slot = block.slot >= cursor && available.includes(block.slot) && !claimed.has(block.slot)
      ? block.slot
      : available.find((candidate) => candidate >= cursor && !claimed.has(candidate));
    if (slot === undefined) return sorted;
    assigned.set(block.id, slot);
    claimed.add(slot);
    cursor = slot + 1;
  }

  return sorted.map((block) => ({ ...block, slot: assigned.get(block.id) ?? block.slot }))
    .sort((left, right) => left.slot - right.slot);
}

/**
 * Migrates older compact Test Rig plans into the fixed studio layout. Existing
 * blocks and parameters are retained; only their visual plan slots change.
 */
export function normalizeTestRigSlots(blocks: RigBlock[]): RigBlock[] {
  const sorted = [...blocks].sort((left, right) => left.slot - right.slot);
  const claimed = new Set<number>();
  const assigned = new Map<string, number>();
  const roleOwners = new Set<TestRigSlotRoleId>();

  const input = sorted.find((block) => block.category === "input");
  const output = sorted.find((block) => block.category === "output");
  if (input) { assigned.set(input.id, 0); claimed.add(0); }
  if (output) { assigned.set(output.id, TEST_RIG_MAX_SLOTS - 1); claimed.add(TEST_RIG_MAX_SLOTS - 1); }

  // The protected capture marker wins the NAM host if malformed legacy data
  // also contains a separate NAM block.
  const prioritized = [...sorted].sort((left, right) => Number(right.name === CAPTURE_SLOT_NAME) - Number(left.name === CAPTURE_SLOT_NAME));
  for (const block of prioritized) {
    if (assigned.has(block.id)) continue;
    const role = testRigBlockRole(block);
    const slot = reservedTestRigSlotForBlock(block);
    if (!role || slot === null || roleOwners.has(role)) continue;
    assigned.set(block.id, slot);
    claimed.add(slot);
    roleOwners.add(role);
  }

  // Place unrestricted blocks between their nearest fixed neighbours. This
  // preserves musical order when a compact legacy chain expands around the
  // reserved Drive, NAM and IR positions.
  for (const [index, block] of sorted.entries()) {
    if (assigned.has(block.id)) continue;
    const previousSlot = [...sorted.slice(0, index)].reverse()
      .map((candidate) => assigned.get(candidate.id))
      .find((slot): slot is number => slot !== undefined) ?? -1;
    const nextSlot = sorted.slice(index + 1)
      .map((candidate) => assigned.get(candidate.id))
      .find((slot): slot is number => slot !== undefined) ?? TEST_RIG_MAX_SLOTS;
    const openSlots = Array.from({ length: Math.max(0, nextSlot - previousSlot - 1) }, (_, offset) => previousSlot + offset + 1)
      .filter((candidate) => !claimed.has(candidate) && testRigSlotAllowsBlock(candidate, block));
    const slot = openSlots.includes(block.slot) ? block.slot : openSlots[0];
    if (slot !== undefined) {
      assigned.set(block.id, slot);
      claimed.add(slot);
    }
  }

  // A duplicated role cannot fit into a single reserved slot. Keep it visible
  // in an unused position so validation explains the problem rather than
  // silently deleting user data.
  for (const block of sorted) {
    if (assigned.has(block.id)) continue;
    const slot = Array.from({ length: TEST_RIG_MAX_SLOTS }, (_, candidate) => candidate)
      .find((candidate) => !claimed.has(candidate) && !testRigSlotRole(candidate));
    if (slot !== undefined) {
      assigned.set(block.id, slot);
      claimed.add(slot);
    }
  }

  return sorted.map((block) => ({ ...block, slot: assigned.get(block.id) ?? block.slot }))
    .sort((left, right) => left.slot - right.slot);
}

export interface TestRigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  captureSlot: number | null;
}

export interface ToneProviderReadiness {
  ready: boolean;
  authenticated: boolean | null;
  reason: string | null;
}

export function detectCaptureType(tone: DetectableTone): Exclude<CaptureType, "auto"> {
  const declared = tone.declaredType?.trim().toLowerCase().replaceAll("_", "-");
  if (["amp", "effect", "amp+ir", "ir", "full-rig"].includes(declared ?? "")) return declared as Exclude<CaptureType, "auto" | "unknown">;
  const source = [tone.title, tone.description, ...tone.tags].filter(Boolean).join(" ").toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => {
    const pattern = term.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    return new RegExp(`(?:^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, "i").test(source);
  });
  if (has("full rig", "complete rig", "signal chain", "whole rig")) return "full-rig";
  if (has("amp+ir", "amp + ir", "amp and ir", "amp & ir", "with cabinet", "with cab")) return "amp+ir";
  if (has("impulse response", "cab ir", "cabinet ir") || /(^|\s)ir($|\s|,)/.test(source)) return "ir";
  if (has("overdrive", "distortion", "fuzz", "boost", "compressor", "chorus", "flanger", "phaser", "delay", "reverb", "pedal", "effect")) return "effect";
  if (has("amplifier", "amp", "head", "combo", "high gain", "clean channel", "crunch")) return "amp";
  return "unknown";
}

export function toneProviderReadiness(input: {
  native: boolean;
  device: DeviceInfo | null;
  capabilities: DeviceCapabilities | null;
  subtree: HeadRushSubtree | null;
  source: CloudTone["source"];
  remoteId?: string | number;
}): ToneProviderReadiness {
  if (!input.native) return { ready: true, authenticated: null, reason: null };
  if (!input.device) return { ready: false, authenticated: null, reason: "Connect Flex Prime before auditioning." };
  if (!["ready", "demo"].includes(input.device.status)) return { ready: false, authenticated: null, reason: input.device.status === "syncing" ? "Wait for the device to finish syncing." : "The device connection is not ready." };

  const capability = input.source === "Tone3000" ? "tone3000" : "cloud";
  if (input.capabilities?.flags[capability] === false) return { ready: false, authenticated: null, reason: `${input.source} is not available on this device.` };
  if (input.source === "HeadRush Cloud" && (input.remoteId === undefined || String(input.remoteId).trim() === "")) return { ready: false, authenticated: null, reason: "This HeadRush Cloud item has no usable device identifier." };

  const path = input.source === "Tone3000" ? "/Evil/API/Tone3000" : "/Evil/Cloud/Master";
  const property = input.source === "Tone3000" ? "isLoggedIn" : "isloggedIn";
  const value = input.subtree?.[path]?.value?.[property];
  const authenticated = typeof value === "boolean" ? value : null;
  if (authenticated === false) return { ready: false, authenticated, reason: `Sign in to ${input.source} on Flex Prime before auditioning.` };
  return { ready: true, authenticated, reason: null };
}

export function effectiveCaptureType(tone: DetectableTone, override: CaptureType): Exclude<CaptureType, "auto"> {
  return override === "auto" ? detectCaptureType(tone) : override;
}

export function adaptAuditionChain(blocks: RigBlock[], captureType: Exclude<CaptureType, "auto">) {
  return blocks.map((block) => {
    const isCapture = block.name === CAPTURE_SLOT_NAME;
    let autoBypassed = false;
    if (!isCapture) {
      if (captureType === "full-rig") autoBypassed = !["input", "output"].includes(block.category);
      if (captureType === "amp+ir") autoBypassed = ["amp", "cab", "ir", "clone"].includes(block.category);
      if (captureType === "amp") autoBypassed = ["amp", "clone"].includes(block.category);
      if (captureType === "ir") autoBypassed = ["cab", "ir"].includes(block.category);
    }
    return { ...block, effectiveEnabled: isCapture || (block.enabled && !autoBypassed), autoBypassed };
  });
}

function hasDeviceFileValue(parameter: Parameter): boolean {
  if (!parameter.deviceFile || typeof parameter.value !== "string") return false;
  const value = parameter.value.trim();
  return Boolean(value) && !/^(?:none|off|no file|not selected|<none>)$/i.test(value);
}

/**
 * Reflected loader schemas may expose multiple alternative file selectors.
 * A block is ready when at least one selector has a real file, rather than
 * requiring every alternative selector to be populated.
 */
export function selectedTestRigFile(parameters: Parameter[]): Parameter | null {
  return parameters.find(hasDeviceFileValue) ?? null;
}

/** Preserves an audition file when refreshing a block's reflected schema. */
export function mergeTestRigParameters(existing: Parameter[], reflected: Parameter[]): Parameter[] {
  const match = (parameter: Parameter) => existing.find((candidate) =>
    candidate.id === parameter.id
    || Boolean(parameter.sourceProperty && candidate.sourceProperty === parameter.sourceProperty));
  const merged = reflected.map((parameter) => {
    const previous = match(parameter);
    if (!parameter.deviceFile && !previous?.deviceFile) return parameter;
    return {
      ...parameter,
      sourceProperty: parameter.sourceProperty ?? previous?.sourceProperty,
      deviceFile: parameter.deviceFile ?? previous?.deviceFile,
      value: hasDeviceFileValue(parameter) ? parameter.value
        : previous && hasDeviceFileValue(previous) ? previous.value
          : parameter.value,
    };
  });
  const reflectedKeys = new Set(reflected.flatMap((parameter) => [parameter.id, parameter.sourceProperty].filter(Boolean)));
  for (const parameter of existing) {
    if (parameter.deviceFile && !reflectedKeys.has(parameter.id) && !reflectedKeys.has(parameter.sourceProperty)) merged.push(parameter);
  }
  return merged;
}

export function validateTestRig(blocks: RigBlock[]): TestRigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const captureBlocks = blocks.filter((block) => block.name === CAPTURE_SLOT_NAME);
  const ids = new Set<string>();
  const slots = new Set<number>();

  if (blocks.length > TEST_RIG_MAX_SLOTS) errors.push(`A test rig can contain at most ${TEST_RIG_MAX_SLOTS} blocks.`);
  if (captureBlocks.length !== 1) errors.push(captureBlocks.length ? "Keep exactly one Capture slot in the template." : "Add one Capture slot before auditioning.");
  if (!blocks.some((block) => block.category === "input")) warnings.push("No input reference block is present.");
  if (!blocks.some((block) => block.category === "output")) warnings.push("No output reference block is present.");

  for (const block of blocks) {
    if (ids.has(block.id)) errors.push(`Duplicate block id: ${block.id}.`);
    ids.add(block.id);
    if (!Number.isInteger(block.slot) || block.slot < 0 || block.slot >= TEST_RIG_MAX_SLOTS) errors.push(`${block.name} has an invalid slot.`);
    else if (slots.has(block.slot)) errors.push(`More than one block uses slot ${block.slot + 1}.`);
    else slots.add(block.slot);
    if (Number.isInteger(block.slot) && !testRigSlotAllowsBlock(block.slot, block)) {
      const reservedSlot = reservedTestRigSlotForBlock(block);
      const targetRole = testRigSlotRole(block.slot);
      errors.push(reservedSlot !== null
        ? `${block.name} is reserved for slot ${reservedSlot + 1}.`
        : `Slot ${block.slot + 1} accepts ${targetRole?.description ?? "a compatible block"} only.`);
    }
    const fileParameters = block.parameters.filter((parameter) => parameter.deviceFile);
    if (block.enabled && fileParameters.length && !selectedTestRigFile(fileParameters)) {
      errors.push(`${block.name} requires a selected ${fileParameters[0].label.toLocaleLowerCase()} before auditioning.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    captureSlot: captureBlocks.length === 1 && Number.isInteger(captureBlocks[0].slot) ? captureBlocks[0].slot : null,
  };
}

export function addBlockToTestRig(blocks: RigBlock[], block: RigBlock): RigBlock[] {
  if (blocks.length >= TEST_RIG_MAX_SLOTS || blocks.some((item) => item.id === block.id)) return blocks;
  const used = new Set(blocks.map((item) => item.slot));
  const reservedSlot = reservedTestRigSlotForBlock(block);
  const slot = reservedSlot !== null && !used.has(reservedSlot)
    ? reservedSlot
    : Array.from({ length: TEST_RIG_MAX_SLOTS }, (_, index) => index)
      .find((candidate) => !used.has(candidate) && testRigSlotAllowsBlock(candidate, block)) ?? -1;
  if (slot < 0) return blocks;
  return [...blocks, { ...block, slot }].sort((left, right) => left.slot - right.slot);
}

/** Places a block in an exact visual slot. Occupied editable slots are swapped. */
export function placeTestRigBlock(blocks: RigBlock[], block: RigBlock, targetSlot: number): RigBlock[] {
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= TEST_RIG_MAX_SLOTS || !canPlaceTestRigBlock(blocks, block, targetSlot)) return blocks;
  const existing = blocks.find((item) => item.id === block.id);
  if (!existing && blocks.length >= TEST_RIG_MAX_SLOTS) return blocks;
  const target = blocks.find((item) => item.slot === targetSlot && item.id !== block.id);

  if (existing) {
    return blocks.map((item) => {
      if (item.id === existing.id) return { ...item, slot: targetSlot };
      if (target && item.id === target.id) return { ...item, slot: existing.slot };
      return item;
    }).sort((left, right) => left.slot - right.slot);
  }

  if (target) return blocks.map((item) => item.id === target.id ? { ...block, slot: targetSlot } : item).sort((left, right) => left.slot - right.slot);
  return [...blocks, { ...block, slot: targetSlot }].sort((left, right) => left.slot - right.slot);
}

export function duplicateTestRigBlock(blocks: RigBlock[], blockId: string, nextId: string): RigBlock[] {
  const source = blocks.find((block) => block.id === blockId);
  if (!source || source.name === CAPTURE_SLOT_NAME || ["input", "output"].includes(source.category)) return blocks;
  return addBlockToTestRig(blocks, { ...structuredClone(source), id: nextId, name: `${source.name} copy` });
}
