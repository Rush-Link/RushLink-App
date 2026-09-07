import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedPersistStorage } from "./buffered-persist-storage";
import { cloudTones, defaultLiveLayout, defaultLiveStage, demoRigs, demoSetlists, demoSnapshots, testRigNamControls, testRigTemplates } from "../data/demo-data";
import type { CaptureType, CloudTone, DeviceCapabilities, DeviceInfo, DiagnosticEvent, HeadRushSubtree, LiveActionType, LiveButton, LiveControlPreset, LiveDeviceSnapshot, LiveGesture, LiveLayout, LiveStage, LiveStageSpacing, MidiCommand, PendingWrite, Rig, RigBlock, RigHistoryEntry, Setlist, Snapshot, TestRigTemplate, ToneModel, WriteMode } from "../domain/types";
import { DEFAULT_TONE3000_FILTERS, deviceApi, tone3000ModelFilename, type Tone3000SearchFilters } from "../services/device-api";
import { DEVICE_FIRST_ROW_COLUMNS, normalizeLiveDimensions, normalizeLiveMidiCommand, normalizeLiveStageSpacing, resizeLiveLayout } from "../domain/live-layout";
import { addBlockToTestRig, CAPTURE_SLOT_NAME, detectCaptureType, duplicateTestRigBlock, effectiveCaptureType, mergeTestRigParameters, normalizeTestRigEffectOrder, normalizeTestRigSlots, placeTestRigBlock, testRigSlotAllowsBlock, toneProviderReadiness, validateTestRig } from "../domain/tone-analysis";
import { parameterDeviceValue, parseHeadRushSubtree } from "../domain/headrush-reflection";
import { mergeSnapshots, type RushLinkArchive } from "../domain/backup";
import { flexPrimeMidiCommand } from "../domain/headrush-midi";
import type { SavedWorkflow } from "../domain/rushlink-sync";
import { canonicalLiveSwitchType, resolveLiveButtonGesture } from "../domain/stage-gestures";
import { equalDeviceValue, mergeReflectedTree } from "../services/reflected-tree-merge";
import { buildTestRigDevicePlan, testRigBlockProperties, testRigModulePath, testRigPlanMismatches, type TestRigDevicePlan } from "../domain/tone-audition-chain";
import { deviceErrorDetail, deviceErrorMessage } from "../services/device-errors";

interface Preferences {
  address: string;
  writeMode: WriteMode;
  firstWriteResolved: boolean;
  density: "comfortable" | "compact" | "stage";
  reduceMotion: boolean;
  highContrast: boolean;
  keepAwake: boolean;
  autoBackup: boolean;
  autoDiscovery: boolean;
  autoReconnect: boolean;
  confirmRigReplacement: boolean;
  keepHistory: boolean;
}

interface ToneTestSet {
  id: string;
  name: string;
  rigIds: string[];
}

const normalizedDeviceFile = (value: string) => value.replaceAll("\\", "/").trim().toLocaleLowerCase();

function deviceFileMatches(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== "string" || typeof expected !== "string" || !actual.trim() || !expected.trim()) return false;
  const normalizedActual = normalizedDeviceFile(actual);
  const normalizedExpected = normalizedDeviceFile(expected);
  return normalizedActual === normalizedExpected || normalizedActual.endsWith(`/${normalizedExpected.split("/").at(-1)}`);
}

const missingPropertyForCapture = (property: TestRigCaptureFile["property"]) => property.endsWith("2") ? "FileMissing2" : "FileMissing";

async function bindAndVerifyDurableCapture(
  captureFile: TestRigCaptureFile,
  durablePath: string,
  label: string,
): Promise<TestRigCaptureFile> {
  const response = await deviceApi.setProperties(captureFile.path, { [captureFile.property]: durablePath });
  assertDeviceMutation(response.status, `Binding ${label} to the Test Rig`);
  const missingProperty = missingPropertyForCapture(captureFile.property);
  let lastMissing = "";
  for (const delay of AUDITION_SETTLE_DELAYS) {
    await auditionDelay(delay);
    const host = await deviceApi.properties(captureFile.path);
    const missing = typeof host[missingProperty] === "string" ? host[missingProperty].trim() : "";
    lastMissing = missing;
    const loaded = typeof host[captureFile.property] === "string" ? String(host[captureFile.property]).trim() : "";
    if (loaded && normalizedDeviceFile(loaded) === normalizedDeviceFile(durablePath) && !missing) {
      return { ...captureFile, value: String(host[captureFile.property]).trim() };
    }
  }
  const reason = lastMissing ? ` The device reported: ${lastMissing}.` : "";
  throw new Error(`${label} was downloaded, but its permanent device file could not be loaded into the active Test Rig.${reason} The rig was not saved.`);
}

const deviceFilename = (value: string) => value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
const deviceFileStem = (value: string) => deviceFilename(value).replace(/\.[^.]+$/, "").trim().toLocaleLowerCase();

function availableCloudCloneName(requestedName: string, entries: string[]): string {
  const base = (sanitizeHeadRushRigName(requestedName) || "TonePilot clone").slice(0, 160);
  const used = new Set(entries.map(deviceFileStem));
  for (let suffix = 0; suffix < 100; suffix++) {
    const addition = suffix ? ` ${suffix + 1}` : "";
    const candidate = `${base.slice(0, Math.max(1, 160 - addition.length))}${addition}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("HeadRush Cloud clone storage has too many items with this name. Choose another rig name.");
}

async function waitForCloudCloneFile(folder: string, downloadName: string): Promise<string> {
  for (const delay of AUDITION_SETTLE_DELAYS) {
    await auditionDelay(delay);
    const files = await deviceApi.listDeviceFiles(folder, "clone");
    const matching = files.filter((file) => deviceFileStem(file) === downloadName.toLocaleLowerCase());
    if (matching.length === 1) return `${folder}/${deviceFilename(matching[0])}`;
    if (matching.length > 1) throw new Error(`HeadRush returned more than one downloaded clone named "${downloadName}". The active Test Rig was not rebound or saved.`);
  }
  throw new Error(`HeadRush Cloud reported that "${downloadName}" downloaded, but its device file could not be verified. The active Test Rig was not saved.`);
}

async function ensureDurableAuditionSource(
  audition: TonePilotAuditionIdentity,
  requestedRigName: string,
): Promise<TestRigCaptureFile | undefined> {
  if (audition.tone.source === "Tone3000") {
    if (!audition.model) throw new Error("The exact Tone3000 model used for this audition is no longer known. Restart the audition before saving.");
    if (!audition.captureFile) throw new Error("The active Tone3000 file is not attached to a verified Test Rig host. Refresh the Test Rig before saving.");
    const filename = tone3000ModelFilename(audition.model);
    await deviceApi.downloadTone(audition.tone, audition.model);
    return bindAndVerifyDurableCapture(
      audition.captureFile,
      `Neural Amp Modeler/Tone 3000/${filename}`,
      `Tone3000 model "${audition.model.name}"`,
    );
  }

  if (audition.tone.remoteKind !== "clone") {
    // The official HeadRush client exposes downloadRig as the durable operation
    // for a cloud rig. Its reflected return is validated by deviceApi.
    await deviceApi.downloadTone(audition.tone, undefined, requestedRigName);
    return audition.captureFile;
  }

  if (!audition.captureFile) {
    throw new Error("The active HeadRush Cloud clone is not attached to a verified Test Rig host. Refresh the Test Rig before saving.");
  }
  const cloneType = `${audition.tone.gear ?? ""} ${audition.tone.metadata?.clone_type ?? ""} ${audition.captureFile.path}`.toLocaleUpperCase();
  const folder = cloneType.includes("SUPERCLONE") ? "SuperClones/HeadRush Cloud" : "Amp Clones/HeadRush Cloud";
  const existingFiles = await deviceApi.listDeviceFiles(folder, "clone");
  const downloadName = availableCloudCloneName(requestedRigName, existingFiles);
  await deviceApi.downloadTone(audition.tone, undefined, downloadName);
  const durablePath = await waitForCloudCloneFile(folder, downloadName);
  return bindAndVerifyDurableCapture(audition.captureFile, durablePath, `HeadRush Cloud clone "${audition.tone.title}"`);
}

interface TonePilotAuditionIdentity {
  /** Immutable provider identity captured when the audition starts. */
  tone: CloudTone;
  /** Exact Tone3000 model used by startDemo; deliberately not inferred from later selection. */
  model?: ToneModel;
  /** Exact host and property carrying the provider file in the rebuilt Test Rig. */
  captureFile?: TestRigCaptureFile;
}

interface TonePilotReturnTarget {
  id: string;
  name: string;
  srId?: string;
  snapshotId?: string;
  auditionSource?: CloudTone["source"];
  testRigApplied?: boolean;
  testRigMessage?: string;
  audition?: TonePilotAuditionIdentity;
}

export interface AuditionRigSaveOptions {
  name: string;
  /** Empty or omitted keeps the new rig out of setlists. */
  setlistId?: string;
  /** HeadRush stores the nine rig colours as values 1 through 9. */
  color: number;
  tempoMode: "current" | "fixed";
  tempoBpm: number;
  /** HeadRush stores Off as -1 and displayed programs 1-128 as 0-127. */
  programChange: number;
  overwrite?: boolean;
}

export interface AuditionRigSaveResult {
  rigId: string;
  name: string;
  setlistName?: string;
  warning?: string;
}

export class AuditionRigNameConflictError extends Error {
  readonly code = "audition-rig-name-conflict";
  constructor(readonly rigName: string) {
    super(`A rig named “${rigName}” already exists. Confirm replacement to continue.`);
    this.name = "AuditionRigNameConflictError";
  }
}

const SEEDED_TEST_RIG_BLOCK_SUFFIXES = new Set(["input", "compressor", "drive", "amp", "capture", "ir", "delay", "eq", "verb", "output"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const sanitizeHeadRushRigName = (name: string) => name.replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 200);
const headRushDocumentId = () => globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
  const random = Math.floor(Math.random() * 16);
  return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
});

interface HeadRushSetlistDocument extends Record<string, unknown> {
  id: string;
  name: string;
  data: Array<Record<string, unknown>>;
}

/**
 * Builds the exact flat or song-view payload accepted by the reflected
 * Setlists.saveSetlist method. The source document is always fetched from the
 * pedal so placeholder rows in RushLink can never erase unseen setlist items.
 */
export function appendRigToHeadRushSetlist(
  value: unknown,
  setlistId: string,
  setlistName: string,
  rigId: string,
  rigName: string,
  songId = headRushDocumentId(),
): HeadRushSetlistDocument {
  const context = setlistName.trim() || setlistId;
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) as unknown : value; }
  catch { throw new Error(`HeadRush returned unreadable data for “${context}”. The setlist was not changed.`); }
  if (!isRecord(parsed)) throw new Error(`HeadRush returned invalid data for “${context}”. The setlist was not changed.`);
  const detail = parsed;
  const invalid = (reason: string): never => { throw new Error(`HeadRush returned an invalid “${context}” setlist (${reason}). The setlist was not changed.`); };
  if (typeof detail.id !== "string" || !detail.id.trim()) invalid("missing ID");
  if (detail.id !== setlistId) invalid("device ID did not match the selected setlist");
  if (typeof detail.name !== "string") invalid("missing name");
  if (typeof detail.author !== "string") invalid("missing author");
  if (typeof detail.readonly !== "boolean") invalid("missing read-only state");
  if (typeof detail.version !== "string") invalid("missing version");
  if (detail.readonly) throw new Error(`“${detail.name || context}” is read-only on the HeadRush. The saved rig was not added to it.`);
  const documentName = detail.name as string;

  if ("songs" in detail) {
    if (!Array.isArray(detail.songs)) invalid("songs was not a list");
    const songs = detail.songs as unknown[];
    const data: Array<Record<string, unknown>> = [];
    for (const rawSong of songs) {
      const song = isRecord(rawSong) ? rawSong : invalid("a song row was not an object");
      if (typeof song.song_id !== "string" || typeof song.song_name !== "string") invalid("a song row had no ID or name");
      const rawRigIds = song.rigs;
      const rawRigNames = song.rig_names;
      const rigIds = Array.isArray(rawRigIds) && rawRigIds.every((id: unknown) => typeof id === "string")
        ? rawRigIds as string[]
        : invalid(`song “${song.song_name}” had invalid rig IDs`);
      const rigNames = Array.isArray(rawRigNames) && rawRigNames.every((name: unknown) => typeof name === "string")
        ? rawRigNames as string[]
        : invalid(`song “${song.song_name}” had invalid rig names`);
      if (rigIds.length !== rigNames.length) invalid(`song “${song.song_name}” had mismatched rig data`);
      const existingSongId = song.song_id as string;
      const existingSongName = song.song_name as string;
      if (!rigIds.length) {
        data.push({ song_id: existingSongId, song_name: existingSongName, rig_id: "", rig_name: "", empty_song: true });
        continue;
      }
      rigIds.forEach((existingRigId, index) => data.push({
        song_id: existingSongId,
        song_name: existingSongName,
        rig_id: existingRigId,
        rig_name: rigNames[index] ?? "[Empty]",
        empty_song: false,
      }));
    }
    data.push({ song_id: songId, song_name: rigName, rig_id: rigId, rig_name: rigName, empty_song: false });
    return { id: setlistId, name: documentName, data };
  }

  const hasRigs = "rigs" in detail;
  const hasRigNames = "rig_names" in detail;
  if (hasRigs !== hasRigNames) invalid("rig IDs and names were incomplete");
  if (hasRigs && (!Array.isArray(detail.rigs) || !detail.rigs.every((id) => typeof id === "string"))) invalid("rig IDs were invalid");
  if (hasRigNames && (!Array.isArray(detail.rig_names) || !detail.rig_names.every((name) => typeof name === "string"))) invalid("rig names were invalid");
  const rigIds = hasRigs ? detail.rigs as string[] : [];
  const rigNames = hasRigNames ? detail.rig_names as string[] : [];
  if (rigIds.length !== rigNames.length) invalid("rig IDs and names had different lengths");
  const nextRigIds = [...rigIds, rigId];
  return { id: setlistId, name: documentName, data: nextRigIds.map((id, order) => ({ id, order })) };
}

function migrateSeededTestRigSounds(rigs: TestRigTemplate[]): TestRigTemplate[] {
  return rigs.map((rig) => {
    const reference = testRigTemplates.find((candidate) => candidate.id === rig.id);
    const legacyAmp = rig.blocks.find((block) => block.id === `${rig.id}-amp`);
    const isLegacySeed = Boolean(reference && (legacyAmp?.name === "Reference Amp" || legacyAmp?.parameters.some((parameter) => parameter.id === "gain")));
    if (!reference || !isLegacySeed) return { ...rig, blocks: normalizeTestRigSlots(rig.blocks) };

    const customBlocks = rig.blocks.filter((block) => {
      const prefix = `${rig.id}-`;
      return !block.id.startsWith(prefix) || !SEEDED_TEST_RIG_BLOCK_SUFFIXES.has(block.id.slice(prefix.length));
    });
    const seededBlocks = structuredClone(reference.blocks).map((block) => {
      const previous = rig.blocks.find((candidate) => candidate.id === block.id);
      return previous ? { ...block, enabled: previous.enabled } : block;
    });
    return { ...rig, blocks: normalizeTestRigSlots([...seededBlocks, ...customBlocks]) };
  });
}

/**
 * Repairs Test Rig records created before IR file parameters were persisted.
 * A non-empty user-selected IR is deliberately retained; only missing/blank
 * seeded IR values receive the template default.
 */
export function migratePersistedTestRigIrFiles(rigs: TestRigTemplate[]): TestRigTemplate[] {
  return rigs.map((rig) => {
    const reference = testRigTemplates.find((candidate) => candidate.id === rig.id);
    const referenceIr = reference?.blocks.find((block) => block.id === `${rig.id}-ir`);
    const referenceFile = referenceIr?.parameters.find((parameter) => parameter.id === "IR");
    if (!referenceIr || !referenceFile || typeof referenceFile.value !== "string" || !referenceFile.value.trim()) return rig;
    return {
      ...rig,
      blocks: rig.blocks.map((block) => {
        if (block.category !== "ir") return block;
        const fileIndex = block.parameters.findIndex((parameter) => parameter.id === "IR" || parameter.sourceProperty === "IR");
        if (fileIndex < 0) return { ...block, parameters: [structuredClone(referenceFile), ...block.parameters] };
        const existing = block.parameters[fileIndex];
        const existingValue = typeof existing.value === "string" ? existing.value.trim().replace(/\\/g, "/") : "";
        const startPath = referenceFile.deviceFile?.startPath ?? "Impulse Responses";
        const referenceValue = String(referenceFile.value).trim().replace(/\\/g, "/");
        const existingLeaf = existingValue.split("/").at(-1)?.toLocaleLowerCase();
        const referenceLeaf = referenceValue.split("/").at(-1)?.toLocaleLowerCase();
        const isLegacySeedPath = existingLeaf === referenceLeaf
          && (!existingValue.includes("/") || existingValue.toLocaleLowerCase() === `${startPath}/${existingLeaf}`.toLocaleLowerCase());
        const normalizedValue = !existingValue || isLegacySeedPath
          ? referenceValue
          : existingValue.includes("/") ? existingValue : `${startPath}/${existingValue}`;
        const parameters = [...block.parameters];
        parameters[fileIndex] = {
          ...structuredClone(referenceFile),
          ...existing,
          sourceProperty: existing.sourceProperty || referenceFile.sourceProperty,
          value: normalizedValue,
          writable: existing.writable ?? referenceFile.writable,
          deviceFile: structuredClone(referenceFile.deviceFile),
        };
        const unchanged = existing.value === parameters[fileIndex].value
          && existing.sourceProperty === parameters[fileIndex].sourceProperty
          && existing.writable === parameters[fileIndex].writable
          && existing.deviceFile?.fileType === parameters[fileIndex].deviceFile?.fileType
          && existing.deviceFile?.startPath === parameters[fileIndex].deviceFile?.startPath;
        if (unchanged) return block;
        return { ...block, parameters };
      }),
    };
  });
}

const LEGACY_CAPTURE_CONTROL_IDS = new Set(["mix", "level", "tone"]);
const captureParameterKey = (parameter: { id: string; sourceProperty?: string }) => (parameter.sourceProperty || parameter.id).toLocaleLowerCase();
const isProtectedCaptureFileParameter = (parameter: { id: string; sourceProperty?: string; deviceFile?: unknown }) => Boolean(parameter.deviceFile)
  || /^(?:loadedclone|filemissing)\d*$/i.test(parameter.sourceProperty || parameter.id);

/**
 * Upgrades persisted Test Rigs from the old generic Capture marker controls to
 * the real Neural Amp Modeler schema. Existing sound values are retained, while
 * provider-owned NAM file selectors are removed from RushLink's editable plan.
 */
export function migratePersistedTestRigNamControls(rigs: TestRigTemplate[]): TestRigTemplate[] {
  const defaults = testRigNamControls();
  const defaultKeys = new Set(defaults.map(captureParameterKey));
  return rigs.map((rig) => ({
    ...rig,
    blocks: rig.blocks.map((block) => {
      if (block.name !== CAPTURE_SLOT_NAME) return block;
      const safeExisting = block.parameters.filter((parameter) => !isProtectedCaptureFileParameter(parameter)
        && !LEGACY_CAPTURE_CONTROL_IDS.has(captureParameterKey(parameter)));
      const existingByKey = new Map(safeExisting.map((parameter) => [captureParameterKey(parameter), parameter]));
      const parameters = defaults.map((fallback) => {
        const previous = existingByKey.get(captureParameterKey(fallback));
        if (!previous) return structuredClone(fallback);
        const { deviceFile: _deviceFile, ...safePrevious } = previous;
        return { ...structuredClone(fallback), ...safePrevious, id: fallback.id, sourceProperty: fallback.sourceProperty };
      });
      for (const parameter of safeExisting) {
        if (defaultKeys.has(captureParameterKey(parameter))) continue;
        const { deviceFile: _deviceFile, ...safeParameter } = parameter;
        parameters.push(safeParameter);
      }
      return { ...block, model: "Neural Amp Modeler", enabled: true, parameters };
    }),
  }));
}

const repairPersistedTestRigs = (rigs: TestRigTemplate[]) => migratePersistedTestRigNamControls(migratePersistedTestRigIrFiles(rigs));

const LEGACY_TEST_RIG_IR_CUTS: Record<string, { low: number; high: number }> = {
  clean: { low: 75, high: 8500 },
  overdrive: { low: 80, high: 7500 },
  distortion: { low: 80, high: 7200 },
  lead: { low: 85, high: 6800 },
  rhythm: { low: 90, high: 6500 },
  metal: { low: 85, high: 6200 },
};

/** Applies the revised neutral IR bandwidth once to untouched seeded values. */
export function migratePersistedTestRigIrCuts(rigs: TestRigTemplate[]): TestRigTemplate[] {
  return rigs.map((rig) => {
    const legacy = LEGACY_TEST_RIG_IR_CUTS[rig.id];
    if (!legacy) return rig;
    return {
      ...rig,
      blocks: rig.blocks.map((block) => block.id !== `${rig.id}-ir` ? block : {
        ...block,
        parameters: block.parameters.map((parameter) => {
          const property = parameter.sourceProperty || parameter.id;
          if (property === "LoCut" && parameter.value === legacy.low) return { ...parameter, value: 65 };
          if (property === "HiCut" && parameter.value === legacy.high) return { ...parameter, value: 12000 };
          return parameter;
        }),
      }),
    };
  });
}

export const APP_STATE_VERSION = 6;

export function migratePersistedAppState(persistedState: unknown, persistedVersion: number): Partial<AppState> {
  if (!isRecord(persistedState)) return {};
  const saved = persistedState as Partial<AppState>;
  if (!Array.isArray(saved.testRigs) || !saved.testRigs.length) return saved;
  let testRigs = saved.testRigs;
  if (persistedVersion < 2) testRigs = migratePersistedTestRigOrder(testRigs);
  // Version 4 also repairs non-empty legacy file controls that were missing
  // reflection metadata or stored only a bare IR filename.
  if (persistedVersion < 4) testRigs = migratePersistedTestRigIrFiles(testRigs);
  if (persistedVersion < 5) testRigs = migratePersistedTestRigNamControls(testRigs);
  if (persistedVersion < 6) testRigs = migratePersistedTestRigIrCuts(testRigs);
  return { ...saved, testRigs };
}

export function migratePersistedTestRigOrder(rigs: TestRigTemplate[]): TestRigTemplate[] {
  return rigs.map((rig) => {
    const reference = testRigTemplates.find((candidate) => candidate.id === rig.id);
    const hasPreviousRhythmOrder = rig.id === "rhythm"
      && rig.blocks.find((block) => block.id === "rhythm-amp")?.slot === 5
      && rig.blocks.find((block) => block.id === "rhythm-eq")?.slot === 8
      && rig.blocks.find((block) => block.id === "rhythm-capture")?.slot === 6
      && rig.blocks.find((block) => block.id === "rhythm-ir")?.slot === 7;
    const corrected = hasPreviousRhythmOrder && reference ? rig.blocks.map((block) => {
      if (block.id !== "rhythm-amp" && block.id !== "rhythm-eq") return block;
      const updated = reference.blocks.find((candidate) => candidate.id === block.id);
      return updated ? { ...block, slot: updated.slot } : block;
    }) : rig.blocks;
    return { ...rig, blocks: normalizeTestRigEffectOrder(normalizeTestRigSlots(corrected)) };
  });
}

export interface AppState {
  page: string;
  sidebarCollapsed: boolean;
  device: DeviceInfo | null;
  capabilities: DeviceCapabilities | null;
  connectionBusy: boolean;
  connectionError: string | null;
  liveSubtree: HeadRushSubtree | null;
  liveSnapshot: LiveDeviceSnapshot | null;
  syncBusy: boolean;
  lastSyncSource: "connect" | "websocket" | "poll" | "manual" | null;
  performanceTunerActive: boolean;
  preferences: Preferences;
  rigs: Rig[];
  favoriteRigIds: string[];
  selectedRigId: string;
  selectedBlockId: string | null;
  setlists: Setlist[];
  selectedSetlistId: string;
  liveLayout: LiveLayout;
  liveStages: LiveStage[];
  selectedLiveStageId: string;
  favoriteLiveControlKeys: string[];
  liveControlPresets: LiveControlPreset[];
  tones: CloudTone[];
  toneModels: Record<string, ToneModel[]>;
  toneLoading: boolean;
  toneLoadingMore: boolean;
  toneLoadingMoreSource: CloudTone["source"] | null;
  tonePrefetchingSource: CloudTone["source"] | null;
  toneError: string | null;
  toneTotals: { tone3000: number | null; headRushCloud: number | null };
  toneHasMore: boolean;
  toneHasMoreBySource: { tone3000: boolean; headRushCloud: boolean };
  toneQuery: string;
  toneUpdatedAt: number | null;
  toneUpdatedAtBySource: { tone3000: number | null; headRushCloud: number | null };
  toneFromCache: boolean;
  toneCursor: ToneCatalogueCursor;
  toneModelLoading: boolean;
  toneModelError: string | null;
  favoriteToneIds: string[];
  favoriteBlockNames: string[];
  savedWorkflows: SavedWorkflow[];
  selectedToneId: string | null;
  selectedToneModelId: string | null;
  auditioningToneId: string | null;
  auditionBusy: boolean;
  auditionError: string | null;
  captureOverride: CaptureType;
  testRigs: TestRigTemplate[];
  selectedTestRigId: string;
  testRigSets: ToneTestSet[];
  selectedTestRigSetId: string;
  testRigReturn: TonePilotReturnTarget | null;
  testRigSyncBusy: boolean;
  testRigSyncError: string | null;
  testRigSyncedAt: number | null;
  pendingWrites: PendingWrite[];
  snapshots: Snapshot[];
  diagnostics: DiagnosticEvent[];
  undoStack: PendingWrite[];
  rigHistory: Record<string, RigHistoryEntry[]>;
  historyPreview: { rigId: string; entryId: string; side: "before" | "after"; returnState: Rig; previewState: Rig } | null;
  setPage: (page: string) => void;
  toggleSidebar: () => void;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  setPerformanceTunerActive: (active: boolean) => void;
  connect: (address?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshFull: (source?: AppState["lastSyncSource"]) => Promise<void>;
  refreshPage: (page?: string, source?: AppState["lastSyncSource"]) => Promise<void>;
  refreshToneServices: (query?: string, force?: boolean, tone3000Filters?: Tone3000SearchFilters, source?: CloudTone["source"], background?: boolean) => Promise<void>;
  prefetchToneService: (source: CloudTone["source"], query?: string, tone3000Filters?: Tone3000SearchFilters) => Promise<void>;
  loadMoreTones: (source: CloudTone["source"]) => Promise<void>;
  selectRig: (id: string) => void;
  loadRig: (id: string, srId?: string) => Promise<void>;
  saveCurrentRig: () => Promise<void>;
  createRig: (name?: string) => Promise<void>;
  renameRig: (id: string, name: string) => Promise<void>;
  deleteRig: (id: string) => Promise<void>;
  duplicateRig: (name: string) => Promise<void>;
  toggleFavoriteRig: (id: string) => void;
  selectBlock: (id: string | null) => void;
  updateParameter: (blockId: string, parameterId: string, value: string | number | boolean) => void;
  toggleBlock: (blockId: string) => Promise<boolean>;
  moveBlock: (from: number, to: number) => Promise<void>;
  addBlock: (block: RigBlock) => Promise<void>;
  removeBlock: (blockId: string) => Promise<void>;
  loadBlockPreset: (blockId: string, presetName: string) => Promise<void>;
  updateRouting: (properties: Record<string, unknown>) => Promise<void>;
  updateFootswitch: (number: number, properties: Record<string, unknown>) => Promise<void>;
  restoreHistory: (entryId: string, side: "before" | "after") => Promise<void>;
  returnFromHistory: () => Promise<void>;
  overwriteFromHistory: () => Promise<void>;
  restoreRigSnapshot: (snapshot: Rig, description: string, recordHistory?: boolean) => Promise<void>;
  toggleHistorySaved: (entryId: string) => void;
  selectSetlist: (id: string) => void;
  moveSetlistItem: (from: number, to: number) => void;
  saveSelectedSetlist: () => Promise<void>;
  createSetlist: (name: string) => Promise<void>;
  renameSetlist: (id: string, name: string) => Promise<void>;
  deleteSetlist: (id: string) => Promise<void>;
  addRigToSetlist: (rigId: string) => void;
  removeSetlistItem: (itemId: string) => void;
  selectLiveStage: (id: string) => void;
  createLiveStage: (name?: string) => void;
  duplicateLiveStage: () => void;
  renameLiveStage: (name: string) => void;
  deleteLiveStage: () => void;
  attachLiveStageToRig: (rigId?: string) => void;
  setLiveDimensions: (rows: number, columns: number, firstRowColumns: number) => void;
  setLiveModel: (model: LiveLayout["model"]) => void;
  setLiveSpacing: (spacing: Partial<LiveStageSpacing>) => void;
  setLiveLocked: (locked: boolean) => void;
  moveLiveButton: (from: number, to: number) => void;
  addLiveButton: (button: LiveButton, index?: number) => void;
  removeLiveButton: (id: string) => void;
  updateLiveButton: (id: string, patch: Partial<LiveButton>) => void;
  toggleFavoriteLiveControl: (key: string) => void;
  saveLiveControlPreset: (name: string, button: LiveButton) => void;
  deleteLiveControlPreset: (id: string) => void;
  triggerLiveButton: (id: string, gesture?: LiveGesture, targetOverride?: string) => Promise<boolean>;
  updateMidi: (id: string, midi: MidiCommand) => void;
  selectTone: (id: string | null) => void;
  loadToneModels: (tone: CloudTone, force?: boolean) => Promise<void>;
  toggleFavoriteTone: (id: string) => void;
  toggleFavoriteBlock: (name: string) => void;
  saveWorkflow: (workflow: SavedWorkflow) => void;
  deleteWorkflow: (id: string) => void;
  selectToneModel: (id: string | null) => void;
  setCaptureOverride: (capture: CaptureType) => void;
  selectTestRig: (id: string) => void;
  updateTestRigDetails: (patch: Partial<Pick<TestRigTemplate, "name" | "description">>) => void;
  toggleTestRigBlock: (blockId: string) => void;
  updateTestRigBlock: (blockId: string, patch: Partial<Omit<RigBlock, "id" | "slot">>) => void;
  updateTestRigParameter: (blockId: string, parameterId: string, value: string | number | boolean) => void;
  addTestRigBlock: (block: RigBlock, targetSlot?: number) => void;
  moveTestRigBlock: (blockId: string, targetSlot: number) => void;
  duplicateTestRigBlock: (blockId: string) => void;
  removeTestRigBlock: (blockId: string) => void;
  syncActiveTestRig: () => Promise<void>;
  createTestRigSet: (name: string) => void;
  renameTestRigSet: (name: string) => void;
  deleteTestRigSet: () => void;
  selectTestRigSet: (id: string) => void;
  addTestRigToSetlist: (rigId: string) => void;
  removeTestRigFromSetlist: (rigId: string) => void;
  moveTestRigInSetlist: (from: number, to: number) => void;
  auditionTone: (tone: CloudTone) => Promise<void>;
  stopAudition: () => Promise<void>;
  saveAuditionRig: (options: AuditionRigSaveOptions) => Promise<AuditionRigSaveResult>;
  finishToneTestSession: () => Promise<void>;
  applyPending: () => Promise<void>;
  discardPending: () => void;
  resolveFirstWrite: (mode: Exclude<WriteMode, "ask">) => void;
  createSnapshot: (name?: string) => Promise<void>;
  restoreSnapshot: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => void;
  importBackupArchive: (archive: RushLinkArchive, restoreWorkspace?: boolean) => number;
  clearDiagnostics: () => void;
  addDiagnostic: (event: Omit<DiagnosticEvent, "id" | "time">) => void;
}

const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const timestamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const errorMessage = (error: unknown) => deviceErrorMessage(error);

const currentRig = (state: AppState) => state.rigs.find((rig) => rig.id === state.selectedRigId) ?? state.rigs[0];
const cloneRig = (rig: Rig): Rig => structuredClone(rig);
const activeLiveStage = (state: Pick<AppState, "liveStages" | "selectedLiveStageId">) => state.liveStages.find((stage) => stage.id === state.selectedLiveStageId) ?? state.liveStages[0];
const activeLayoutPatch = (state: Pick<AppState, "liveStages" | "selectedLiveStageId">, liveLayout: LiveLayout) => ({
  liveLayout,
  liveStages: state.liveStages.map((stage) => stage.id === state.selectedLiveStageId ? { ...stage, layout: liveLayout } : stage),
});
const stagePatchForChangedRig = (state: Pick<AppState, "liveStages" | "liveSnapshot">, rigId: string) => {
  if (state.liveSnapshot?.rig.id === rigId) return {};
  const stage = state.liveStages.find((candidate) => candidate.rigId === rigId);
  return stage ? { selectedLiveStageId: stage.id, liveLayout: stage.layout } : {};
};
const migrateLegacyStageMidi = (button: LiveButton): LiveButton => {
  const midi = button.midi;
  if (button.action === "rig-prev" && midi.type === "pc" && midi.number === 0) return { ...button, midi: flexPrimeMidiCommand("rig-prev") };
  if (button.action === "rig-next" && midi.type === "pc" && midi.number === 1) return { ...button, midi: flexPrimeMidiCommand("rig-next") };
  if (button.action === "scene" && midi.type === "cc" && midi.number === 70) return { ...button, midi: flexPrimeMidiCommand("scene", button.target) };
  if (button.action === "tuner" && midi.type === "cc" && midi.number === 69) return { ...button, midi: flexPrimeMidiCommand("tuner") };
  if (button.action === "drums" && midi.type === "cc" && midi.number >= 61 && midi.number <= 67) return { ...button, midi: flexPrimeMidiCommand("drums", button.target) };
  const defaultBlockSlots: Record<string, number> = { "live-7": 1, "live-8": 5, "live-9": 6 };
  const reflectedSlot = /^slot-(\d+)$/.exec(button.target ?? ""); const slot = reflectedSlot ? Number(reflectedSlot[1]) - 1 : defaultBlockSlots[button.id];
  if (button.action === "block-toggle" && slot !== undefined && midi.type === "cc" && midi.number < 75) return { ...button, midi: flexPrimeMidiCommand("block-toggle", undefined, slot) };
  return button;
};
const migrateStageTunerGesture = (button: LiveButton): LiveButton => button.action === "tuner" && button.target !== "mute"
  ? { ...button, switchType: "multi", holdMs: button.holdMs ?? 650, holdBinding: { action: "tuner", target: "mute", label: "Tuner mute" }, subtitle: button.widget === "tuner" ? "Tap tuner · hold mute · live display · 1×2" : "Tap tuner · hold mute" }
  : button;
const historyDrafts = new Map<string, { before: Rig; description: string }>();
const historyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function retainedHistory(entries: RigHistoryEntry[]): RigHistoryEntry[] {
  const recent = entries.slice(0, 120);
  const recentIds = new Set(recent.map((entry) => entry.id));
  const pinned = entries.filter((entry) => entry.saved && !recentIds.has(entry.id)).slice(0, 40);
  return [...recent, ...pinned];
}

function appendHistory(set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void, rigId: string, before: Rig, after: Rig, description: string) {
  if (JSON.stringify(before.blocks) === JSON.stringify(after.blocks)) return;
  const entry: RigHistoryEntry = { id: id(), rigId, createdAt: new Date().toISOString(), description, before: cloneRig(before), after: cloneRig(after), saved: false };
  set((state) => ({ rigHistory: { ...state.rigHistory, [rigId]: retainedHistory([entry, ...(state.rigHistory[rigId] ?? [])]) } }));
}

function scheduleHistory(get: () => AppState, set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void, before: Rig, description: string) {
  // Persisted preferences from builds predating keepHistory do not contain the
  // key. Only an explicit opt-out should disable the recorder.
  if (get().preferences.keepHistory === false) return;
  const rigId = before.id;
  if (!historyDrafts.has(rigId)) historyDrafts.set(rigId, { before: cloneRig(before), description });
  const prior = historyTimers.get(rigId); if (prior) clearTimeout(prior);
  historyTimers.set(rigId, setTimeout(() => {
    historyTimers.delete(rigId); const draft = historyDrafts.get(rigId); historyDrafts.delete(rigId); if (!draft) return;
    const after = get().liveSnapshot?.rig.id === rigId ? get().liveSnapshot!.rig : currentRig(get());
    appendHistory(set, rigId, draft.before, after, draft.description);
  }, 550));
}

const PAGE_PATHS: Record<string, string[]> = {
  dashboard: ["/Evil/Gui", "/Evil/Engine/Patch/Rig", "/Evil/Engine/Patch/Chain", "/Evil/Engine/FootSwitch", "/Evil/Engine/CPUMeter", "/Evil/Engine/DrumsCtrl", "/Evil/Engine/Settings/StorageInfo", "/Evil/API/Rigs", "/Evil/API/Setlists", "/Evil/API/Tone3000", "/Evil/Cloud/Master"],
  editor: ["/Evil/Engine/Patch/Rig", "/Evil/Engine/Patch/Chain", "/Evil/Engine/Patch/Input", "/Evil/Engine/Patch/Mix", "/Evil/Engine/Patch/Output", "/Evil/Engine/FootSwitch", "/Evil/Engine/Pedal1", "/Evil/Engine/Pedal2", "/Evil/Engine/Settings/ExpressionPedal", "/Evil/API/Blocks"],
  rigs: ["/Evil/API/Rigs", "/Evil/Engine/Patch/Rig", "/Evil/Engine/Patch/Chain"],
  setlists: ["/Evil/API/Setlists", "/Evil/API/Rigs", "/Evil/Engine/Patch/Rig"],
  live: ["/Evil/Engine/Patch/Rig", "/Evil/Engine/Patch/Chain", "/Evil/Engine/FootSwitch", "/Evil/Engine/DrumsCtrl", "/Evil/Engine/AudioCtrl/Input", "/Evil/Engine/AudioCtrl/Tuner", "/Evil/Engine/FFTCtrl", "/Evil/Engine/Tempo"],
  "tone-cloud": ["/Evil/API/Tone3000", "/Evil/Cloud/Master", "/Evil/Engine/Patch/Rig", "/Evil/Engine/Patch/Chain"],
  assignments: ["/Evil/Engine/FootSwitch", "/Evil/Engine/Patch/Chain", "/Evil/Engine/Pedal1", "/Evil/Engine/Pedal2", "/Evil/Engine/MIDIOutCtrl", "/Evil/Engine/Settings/ExpressionPedal", "/Evil/Engine/Settings/Midi"],
  tools: ["/Evil/Engine/DrumsCtrl", "/Evil/Engine/AudioCtrl/Input", "/Evil/Engine/AudioCtrl/Tuner", "/Evil/Engine/FFTCtrl", "/Evil/Engine/CPUMeter", "/Evil/Engine/Tempo", "/Evil/Engine/GlobalEQMain", "/Evil/Engine/GlobalEQAmp", "/Evil/Engine/Settings/General", "/Evil/Engine/Settings/Midi", "/Evil/Engine/Settings/ExpressionPedal"],
  library: ["/Evil/API/Rigs", "/Evil/API/Setlists", "/Evil/Engine/Settings/StorageInfo"],
  settings: ["/Evil/Gui", "/Evil/Engine/Settings/Audio", "/Evil/Engine/Settings/General", "/Evil/Engine/Settings/Midi", "/Evil/Engine/MIDIOutCtrl", "/Evil/Engine/Settings/ExpressionPedal", "/Evil/Engine/Settings/StorageInfo", "/Evil/API/Tone3000", "/Evil/Cloud/Master"],
};

let scopedRefresh: Promise<void> | null = null;
const toneRequestSerial = { tone3000: 0, headRushCloud: 0 };
let toneModelRequestSerial = 0;
interface ToneCatalogueCursor {
  tone3000: { query: string; nextPage: number | null; filters: Tone3000SearchFilters };
  headRushCloud: { query: string; nextToken: string | null };
}
interface ToneCatalogueCacheEntry { source: CloudTone["source"]; tones: CloudTone[]; total: number | null; nextPage: number | string | null; query: string; filters: Tone3000SearchFilters; updatedAt: number }
const TONE_CACHE_TTL = 15 * 60_000;
export const TONE_PAGE_SIZE = 50;
const TONE3000_PROVIDER_PAGE_SIZE = 25;
const TONE3000_BATCH_PAGES = Math.ceil(TONE_PAGE_SIZE / TONE3000_PROVIDER_PAGE_SIZE);
const AUDITION_SETTLE_DELAYS = [0, 90, 160, 280, 450, 700, 1_000];
const TEST_RIG_CHAIN_PATH = "/Evil/Engine/Patch/Chain";
const TEST_RIG_ROUTING = 0;
const toneCatalogueCache = new Map<string, ToneCatalogueCacheEntry>();
const parameterWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
let testRigSyncTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveSyncFailures = 0;
const SYNC_FAILURE_LIMIT = 3;
let testRigSyncPromise: Promise<void> | null = null;
let testRigSyncQueued = false;

function scheduleTestRigSync(get: () => AppState, delay = 360) {
  if (testRigSyncTimer) clearTimeout(testRigSyncTimer);
  if (!deviceApi.isNative() || !get().auditioningToneId) return;
  testRigSyncTimer = setTimeout(() => {
    testRigSyncTimer = null;
    void get().syncActiveTestRig().catch(() => undefined);
  }, delay);
}

/**
 * Saving must never overtake the debounced live editor. Drain any queued write,
 * then run one final device sync from the latest in-memory Test Rig.
 */
async function flushActiveTestRigSync(get: () => AppState): Promise<void> {
  let finalSyncRequired = true;
  for (let pass = 0; pass < 8; pass += 1) {
    if (testRigSyncTimer) {
      clearTimeout(testRigSyncTimer);
      testRigSyncTimer = null;
      finalSyncRequired = true;
    }
    if (testRigSyncPromise) {
      await testRigSyncPromise;
      finalSyncRequired = true;
      continue;
    }
    if (testRigSyncQueued) {
      testRigSyncQueued = false;
      finalSyncRequired = true;
    }
    if (finalSyncRequired) {
      finalSyncRequired = false;
      await get().syncActiveTestRig();
      continue;
    }
    return;
  }
  throw new Error("The Test Rig kept changing while RushLink was preparing it. Let the last control settle, then save again.");
}

const normalizedTone3000Filters = (filters?: Tone3000SearchFilters): Tone3000SearchFilters => {
  const saved: Record<string, unknown> = isRecord(filters) ? filters : {};
  const strings = (value: unknown, fallback: string[]) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").sort() : [...fallback];
  return {
    ...DEFAULT_TONE3000_FILTERS,
    ...saved,
    gear: strings(saved.gear, DEFAULT_TONE3000_FILTERS.gear),
    sizes: strings(saved.sizes, DEFAULT_TONE3000_FILTERS.sizes),
    tags: strings(saved.tags, DEFAULT_TONE3000_FILTERS.tags),
    makes: strings(saved.makes, DEFAULT_TONE3000_FILTERS.makes),
    creators: strings(saved.creators, DEFAULT_TONE3000_FILTERS.creators),
  } as Tone3000SearchFilters;
};
const providerKey = (source: CloudTone["source"]) => source === "Tone3000" ? "tone3000" : "headRushCloud";
const toneCacheKey = (source: CloudTone["source"], query: string, filters: Tone3000SearchFilters) => `${source}::${query.trim().toLocaleLowerCase()}::${source === "Tone3000" ? JSON.stringify(filters) : "cloud"}`;
export const replaceProviderTones = (tones: CloudTone[], source: CloudTone["source"], replacement: CloudTone[]) => uniqueTones([...tones.filter((tone) => tone.source !== source), ...replacement]);

const auditionDelay = (milliseconds: number) => milliseconds ? new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
const chainModuleTypeIds = (chain: Record<string, unknown>) => Array.from({ length: 14 }, (_, index) => Number(chain[`ModuleType${index + 1}`] ?? 0));
const snapshotModuleTypeIds = (rig: Rig | undefined) => {
  const moduleTypeIds = Array<number>(14).fill(0);
  for (const block of rig?.blocks ?? []) if (block.slot >= 0 && block.slot < 14) moduleTypeIds[block.slot] = block.moduleTypeId ?? 0;
  return moduleTypeIds;
};

function assertDeviceMutation(status: number, action: string) {
  if (status < 200 || status >= 300) throw new Error(`${action} failed with device status ${status}.`);
}

async function waitForTestRigPlan(input: {
  rig: TestRigTemplate;
  captureType: Exclude<CaptureType, "auto">;
  tone: CloudTone;
  moduleTypes: string[];
  previousModuleTypeIds: number[];
}): Promise<{ plan: TestRigDevicePlan; currentModuleTypeIds: number[] }> {
  let lastPlan: TestRigDevicePlan | null = null;
  let currentModuleTypeIds = Array<number>(14).fill(0);
  for (const delay of AUDITION_SETTLE_DELAYS) {
    await auditionDelay(delay);
    currentModuleTypeIds = chainModuleTypeIds(await deviceApi.properties("/Evil/Engine/Patch/Chain"));
    lastPlan = buildTestRigDevicePlan({
      blocks: input.rig.blocks,
      captureType: input.captureType,
      source: input.tone.source,
      remoteKind: input.tone.remoteKind,
      moduleTypes: input.moduleTypes,
      currentModuleTypeIds,
      previousModuleTypeIds: input.previousModuleTypeIds,
    });
    if (lastPlan.captureSlot !== null || (lastPlan.complete && input.tone.source === "HeadRush Cloud" && input.tone.remoteKind !== "clone" && input.captureType !== "ir")) {
      return { plan: lastPlan, currentModuleTypeIds };
    }
  }
  throw new Error(lastPlan?.message ?? "The Flex Prime did not finish creating its temporary audition host.");
}

async function setChainModule(slot: number, moduleTypeId: number) {
  // This deliberately mirrors the transaction used by the Flex Prime web
  // editor. ModuleTypeN updates the reflected patch (and therefore the DSP
  // graph); setModuleTypeInternal commits the matching internal slot change.
  // Calling only the method can update the screen while the provider demo
  // continues to own a separate input -> capture -> output audio route.
  const propertyResponse = await deviceApi.setProperties(TEST_RIG_CHAIN_PATH, { [`ModuleType${slot + 1}`]: moduleTypeId });
  assertDeviceMutation(propertyResponse.status, `Writing Test Rig slot ${slot + 1}`);
  const methodResponse = await deviceApi.callMethod(TEST_RIG_CHAIN_PATH, "setModuleTypeInternal", [slot, moduleTypeId]);
  assertDeviceMutation(methodResponse.status, `Committing Test Rig slot ${slot + 1}`);
}

async function readTestRigChain() {
  return deviceApi.properties(TEST_RIG_CHAIN_PATH);
}

async function settleTestRigChain(plan: TestRigDevicePlan, attempts = 6): Promise<Record<string, unknown>> {
  let previousSignature = "";
  let stableReads = 0;
  let latest: Record<string, unknown> = {};
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await auditionDelay(AUDITION_SETTLE_DELAYS[Math.min(attempt + 1, AUDITION_SETTLE_DELAYS.length - 1)]);
    latest = await readTestRigChain();
    const ids = chainModuleTypeIds(latest);
    const mismatches = testRigPlanMismatches(plan, ids);
    const routingMatches = Number(latest.Routing ?? TEST_RIG_ROUTING) === TEST_RIG_ROUTING;
    if (mismatches.length || !routingMatches) {
      stableReads = 0;
      previousSignature = "";
      if (!routingMatches) {
        const response = await deviceApi.setProperties(TEST_RIG_CHAIN_PATH, { Routing: TEST_RIG_ROUTING });
        assertDeviceMutation(response.status, "Selecting the Test Rig signal path");
      }
      for (const slot of mismatches) {
        const assignment = plan.assignments.find((item) => item.slot === slot);
        await setChainModule(slot, assignment?.moduleTypeId ?? 0);
      }
      continue;
    }
    const signature = `${latest.Routing ?? TEST_RIG_ROUTING}:${ids.join(",")}`;
    stableReads = signature === previousSignature ? stableReads + 1 : 1;
    previousSignature = signature;
    if (stableReads >= 2) return latest;
  }
  const mismatches = testRigPlanMismatches(plan, chainModuleTypeIds(latest));
  if (mismatches.length) throw new Error(`Flex Prime did not keep Test Rig slot${mismatches.length === 1 ? "" : "s"} ${mismatches.map((slot) => slot + 1).join(", ")} in its audio chain.`);
  if (Number(latest.Routing ?? TEST_RIG_ROUTING) !== TEST_RIG_ROUTING) throw new Error("Flex Prime did not switch its audio engine to the Test Rig signal path.");
  throw new Error("The Flex Prime Test Rig chain did not become stable.");
}

interface TestRigCaptureFile {
  path: string;
  property: "LoadedClone" | "LoadedClone2" | "IR" | "IR2";
  value: string;
}

async function waitForProviderCaptureFile(plan: TestRigDevicePlan): Promise<TestRigCaptureFile | null> {
  const capture = plan.assignments.find((assignment) => assignment.capture);
  if (!capture || !/(?:Clone|Neural Amp Modeler|\bIR(?: \(1024\))?\b)/.test(capture.moduleName)) return null;
  const path = testRigModulePath(capture.moduleName);
  const candidates: TestRigCaptureFile["property"][] = /\bIR(?: \(1024\))?\b/.test(capture.moduleName)
    ? ["IR", "IR2"]
    : ["LoadedClone", "LoadedClone2"];
  for (const delay of AUDITION_SETTLE_DELAYS) {
    await auditionDelay(delay);
    const host = await deviceApi.properties(path);
    for (const property of candidates) {
      const value = typeof host[property] === "string" ? host[property].trim() : "";
      const missingProperty = property.endsWith("2") ? "FileMissing2" : "FileMissing";
      const missing = typeof host[missingProperty] === "string" ? host[missingProperty].trim() : "";
      if (value && !missing) return { path, property, value };
    }
  }
  throw new Error(`The selected profile downloaded, but HeadRush did not expose its loaded file to the temporary ${capture.moduleName} host.`);
}

async function configureAndVerifyTestRigBlocks(plan: TestRigDevicePlan, subtree: HeadRushSubtree | null, captureFile: TestRigCaptureFile | null) {
  const reflectedSubtree: HeadRushSubtree = { ...(subtree ?? {}) };
  for (const assignment of plan.assignments) {
    const path = testRigModulePath(assignment.moduleName);
    if (!reflectedSubtree[path]) {
      try { Object.assign(reflectedSubtree, await deviceApi.subtree(path) as HeadRushSubtree); }
      catch { /* On remains safe even when an older firmware omits module metadata. */ }
    }
    const properties = {
      ...testRigBlockProperties(assignment.block, reflectedSubtree[path], assignment.enabled),
      ...(assignment.capture && captureFile ? { [captureFile.property]: captureFile.value } : {}),
    };
    const fileProperties = assignment.block.parameters
      .filter((parameter) => parameter.deviceFile && typeof parameter.value === "string")
      .map((parameter) => parameter.sourceProperty ?? parameter.id)
      .filter((property) => property in properties);
    if (assignment.capture && captureFile) fileProperties.push(captureFile.property);
    const emptyFile = fileProperties.find((property) => typeof properties[property] !== "string" || !String(properties[property]).trim());
    if (emptyFile) throw new Error(`${assignment.block.name} has no file selected. Choose a compatible device file in Test Rig Studio before auditioning.`);
    const matches = (actual: Record<string, unknown>) => actual.On === assignment.enabled
      && fileProperties.every((property) => deviceFileMatches(actual[property], properties[property]));
    const response = await deviceApi.setProperties(path, properties);
    assertDeviceMutation(response.status, `Configuring ${assignment.block.name}`);

    // Module creation and device-file decoding are asynchronous. A successful
    // HTTP response only means the engine accepted the path; it can take much
    // longer than 70 ms before an IR/NAM is reflected as loaded. Repair once,
    // then poll through a bounded settle window before reporting failure.
    let actual: Record<string, unknown> = {};
    for (let attempt = 0; attempt < AUDITION_SETTLE_DELAYS.length; attempt++) {
      await auditionDelay(attempt === 0 ? 45 : AUDITION_SETTLE_DELAYS[attempt]);
      actual = await deviceApi.properties(path);
      if (matches(actual)) break;
      if (attempt === 0) {
        const retry = await deviceApi.setProperties(path, properties);
        assertDeviceMutation(retry.status, `Reconfiguring ${assignment.block.name}`);
      }
    }
    if (actual.On !== assignment.enabled) throw new Error(`${assignment.block.name} is present, but Flex Prime did not ${assignment.enabled ? "enable" : "bypass"} it in the audio chain.`);
    const missingFile = fileProperties.find((property) => !deviceFileMatches(actual[property], properties[property]));
    if (missingFile) {
      const requested = String(properties[missingFile] ?? "").trim();
      const label = requested.split(/[\\/]/).filter(Boolean).at(-1);
      const missingMarker = missingFile.endsWith("2") ? actual.FileMissing2 : actual.FileMissing;
      const reason = typeof missingMarker === "string" && missingMarker.trim() ? ` The device reported: ${missingMarker.trim()}.` : "";
      throw new Error(label
        ? `${assignment.block.name} is present, but HeadRush did not finish loading "${label}".${reason}`
        : `${assignment.block.name} is present, but no valid device file was selected.`);
    }
  }
}

async function applyAndVerifyTestRig(
  plan: TestRigDevicePlan,
  currentModuleTypeIds: number[],
  subtree: HeadRushSubtree | null,
  knownCaptureFile?: TestRigCaptureFile,
): Promise<TestRigCaptureFile | null> {
  if (!plan.complete) throw new Error(plan.message);
  if (!plan.applied) return null;

  // Read the provider-owned file before any ModuleType write. Creating the NAM
  // host in its reserved Test Rig slot resets LoadedClone on some firmware,
  // even though the provider demo screen still shows the selected profile.
  const captureFile = knownCaptureFile ?? await waitForProviderCaptureFile(plan);

  // Create the provider-loaded NAM/IR host at its saved destination before
  // clearing the provider's temporary source slot. This keeps its loaded file
  // alive while the remainder of the exact-position chain is rebuilt.
  const placementOrder = [...plan.assignments].sort((left, right) =>
    Number(right.capture) - Number(left.capture)
    || Number(["ir", "cab"].includes(right.block.category)) - Number(["ir", "cab"].includes(left.block.category))
    || left.slot - right.slot);
  for (const assignment of placementOrder) if (currentModuleTypeIds[assignment.slot] !== assignment.moduleTypeId) await setChainModule(assignment.slot, assignment.moduleTypeId);
  for (const slot of plan.clearSlots) await setChainModule(slot, 0);
  const routingResponse = await deviceApi.setProperties(TEST_RIG_CHAIN_PATH, { Routing: TEST_RIG_ROUTING });
  assertDeviceMutation(routingResponse.status, "Selecting the Test Rig signal path");

  // Do not configure effects while their modules are still being constructed.
  // First prove that the exact 14-slot plan is the stable device audio graph.
  await settleTestRigChain(plan);
  await configureAndVerifyTestRigBlocks(plan, subtree, captureFile);
  // Parameter writes must not allow a late provider/engine event to replace the
  // graph. This second stable read is what makes a successful audition honest.
  await settleTestRigChain(plan, 4);

  const capture = plan.assignments.find((assignment) => assignment.capture);
  if (!capture || !captureFile) return null;
  for (const delay of AUDITION_SETTLE_DELAYS.slice(0, 5)) {
    await auditionDelay(delay);
    const host = await deviceApi.properties(captureFile.path);
    const loadedValue = host[captureFile.property];
    const loadedFile = typeof loadedValue === "string" ? loadedValue.trim() : "";
    const missingProperty = captureFile.property.endsWith("2") ? "FileMissing2" : "FileMissing";
    const missingValue = host[missingProperty];
    const missing = typeof missingValue === "string" ? missingValue.trim() : "";
    if (host.On === true && loadedFile && !missing && deviceFileMatches(loadedFile, captureFile.value)) return { ...captureFile, value: loadedFile };
  }
  throw new Error(`The ${capture.moduleName} host was created, but its selected file did not finish loading.`);
}

function nestedMethodResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const object = value as Record<string, unknown>;
  if (object.success === true && object.result && typeof object.result === "object") return object.result as Record<string, unknown>;
  return object;
}

function primitiveMetadata(...records: Array<Record<string, unknown> | undefined>): Record<string, string | number | boolean> {
  const metadata: Record<string, string | number | boolean> = {};
  const add = (prefix: string, value: unknown) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") metadata[prefix] = value;
    else if (Array.isArray(value) && value.length && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) metadata[prefix] = value.join(", ");
  };
  for (const record of records) if (record) for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) add(`${key}.${childKey}`, childValue);
    } else add(key, value);
  }
  return metadata;
}

function overlayPendingWrites(tree: HeadRushSubtree, writes: PendingWrite[]): HeadRushSubtree {
  if (!writes.length) return tree;
  let next = tree;
  for (const write of writes) {
    const object = next[write.path]; if (!object || equalDeviceValue(object.value?.[write.property], write.value)) continue;
    if (next === tree) next = { ...tree };
    next[write.path] = { ...object, value: { ...(object.value ?? {}), [write.property]: write.value } };
  }
  return next;
}

function toneType(gear: unknown): Exclude<CaptureType, "auto"> {
  const value = String(gear ?? "").toLowerCase();
  if (value.includes("pedal") || value.includes("effect") || value.includes("outboard") || value.includes("space")) return "effect";
  if (value.includes("amp-cab") || value.includes("amp+ir") || value.includes("amp + ir")) return "amp+ir";
  if (value.includes("full")) return "full-rig";
  if (value === "amp") return "amp";
  if (value.includes("ir") || value === "cab" || value.includes("cabinet")) return "ir";
  return "unknown";
}

export function mapTone3000(value: unknown): CloudTone[] {
  const result = nestedMethodResult(value);
  const tones = Array.isArray(result.tones) ? result.tones : [];
  return tones.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const user = item.user && typeof item.user === "object" ? item.user as Record<string, unknown> : {};
    const tags = Array.isArray(item.tags) ? item.tags.map((tag) => typeof tag === "object" && tag ? String((tag as Record<string, unknown>).name ?? "") : String(tag)).filter(Boolean) : [];
    const makes = Array.isArray(item.makes) ? item.makes.map((make) => typeof make === "object" && make ? String((make as Record<string, unknown>).name ?? "") : String(make)).filter(Boolean) : [];
    const captureType = toneType(item.gear);
    const images = Array.isArray(item.images) ? item.images : [];
    const firstImage = images[0];
    const imageUrl = typeof firstImage === "string" ? firstImage : firstImage && typeof firstImage === "object" ? String((firstImage as Record<string, unknown>).url ?? (firstImage as Record<string, unknown>).src ?? "") : "";
    const createdAt = String(item.published_at ?? item.publishedAt ?? item.created_at ?? item.createdAt ?? item.published_on ?? item.date ?? "") || undefined;
    const updatedAt = String(item.updated_at ?? item.updatedAt ?? "") || undefined;
    const modelCount = finiteNumber(item.models_count ?? item.model_count ?? item.modelsCount) ?? undefined;
    return [{
      id: `t3k-${String(item.id ?? index)}`, title: String(item.title ?? "Untitled Tone3000 capture"),
      author: String(user.display_name ?? user.username ?? "Tone3000 creator"), description: String(item.description ?? ""),
      captureType, detectedType: captureType, tags, rating: Number(item.favorites_count ?? 0),
      downloads: Number(item.downloads_count ?? 0), source: "Tone3000" as const, imageColor: "#a982ef",
      remoteId: Number(item.id ?? 0), remoteKind: "tone-group" as const,
      imageUrl, gear: String(item.gear ?? "") || undefined, createdAt, updatedAt, modelCount,
      metadata: primitiveMetadata(item, { user, filters: { makes: makes.join(", ") } }),
    }];
  });
}

export function mapHeadRushCloud(value: unknown): CloudTone[] {
  const result = nestedMethodResult(value);
  const items = Array.isArray(result.item_collection) ? result.item_collection : [];
  return items.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const meta = (item.rig_metadata ?? item.amp_clone) as Record<string, unknown> | undefined;
    if (!meta) return [];
    const relation = item.relationship && typeof item.relationship === "object" ? item.relationship as Record<string, unknown> : {};
    const captureType = item.amp_clone ? toneType(meta.clone_type ?? "amp") : "full-rig";
    const rawTags = [meta.genre, meta.category, meta.clone_type, ...(Array.isArray(meta.tags) ? meta.tags : [])].map(String).filter((tag) => tag && tag !== "undefined");
    const tags = [...new Set([item.amp_clone ? "Clone" : "Rig", ...rawTags])];
    const createdAt = String(meta.created_at ?? meta.created_time ?? meta.createdAt ?? "") || undefined;
    const updatedAt = String(meta.updated_at ?? meta.modified_time ?? meta.updatedAt ?? "") || undefined;
    return [{
      id: `hrc-${String(meta.id ?? index)}`, title: String(meta.display_name ?? meta.name ?? "HeadRush Cloud item"),
      author: String(meta.artist ?? meta.created_by_name ?? "HeadRush Cloud"), description: String(meta.description ?? ""),
      captureType, detectedType: captureType, tags,
      rating: Number(meta.likes_count ?? 0), downloads: Number(meta.downloads_count ?? 0),
      source: "HeadRush Cloud" as const, imageColor: "#6ee7f2", downloaded: relation.is_downloaded_by_me === true,
      remoteId: String(meta.id ?? ""), remoteKind: item.amp_clone ? "clone" as const : "rig" as const,
      imageUrl: String(meta.image_url ?? ""), gear: String(meta.clone_type ?? meta.gear ?? "") || undefined,
      createdAt, updatedAt, modelCount: finiteNumber(meta.model_count) ?? undefined,
      metadata: primitiveMetadata(meta, { relationship: relation }),
    }];
  });
}

export function mapTone3000Models(value: unknown, fallbackArchitecture: "A1" | "A2"): ToneModel[] {
  const result = nestedMethodResult(value);
  const rows = Array.isArray(result) ? result : Array.isArray(result.models) ? result.models : [];
  return rows.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const remoteId = Number(item.id ?? 0);
    if (!Number.isFinite(remoteId)) return [];
    const architectureValue = item.architecture ?? item.arch ?? item.architecture_name;
    const sizeBytes = finiteNumber(item.size_bytes ?? item.file_size ?? item.size) ?? undefined;
    return [{
      id: `t3k-model-${String(item.id ?? index)}`,
      remoteId,
      name: String(item.name ?? item.title ?? "Unnamed model"),
      architecture: String(architectureValue ?? fallbackArchitecture),
      url: String(item.url ?? item.download_url ?? item.file_url ?? ""),
      description: String(item.description ?? item.notes ?? "") || undefined,
      gear: String(item.gear ?? item.model_type ?? "") || undefined,
      sizeBytes,
      createdAt: String(item.created_at ?? item.createdAt ?? "") || undefined,
      calibrated: typeof item.calibrated === "boolean" ? item.calibrated : undefined,
      metadata: primitiveMetadata(item),
    } satisfies ToneModel];
  });
}

interface Tone3000Page {
  tones: CloudTone[];
  total: number | null;
  totalPages: number | null;
}

interface HeadRushCloudPage {
  tones: CloudTone[];
  total: number | null;
  nextPageToken: string | null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseTone3000Page(value: unknown): Tone3000Page {
  const result = nestedMethodResult(value);
  return { tones: mapTone3000(value), total: finiteNumber(result.total), totalPages: finiteNumber(result.total_pages) };
}

export function parseHeadRushCloudPage(value: unknown): HeadRushCloudPage {
  const result = nestedMethodResult(value);
  const metadata = result.page_metadata && typeof result.page_metadata === "object" ? result.page_metadata as Record<string, unknown> : {};
  const token = metadata.next_page_token;
  return { tones: mapHeadRushCloud(value), total: finiteNumber(metadata.total_size), nextPageToken: typeof token === "string" && token ? token : null };
}

function uniqueTones(tones: CloudTone[]): CloudTone[] {
  return [...new Map(tones.map((tone) => [tone.id, tone])).values()];
}

function headRushCloudCompatibility(tree: HeadRushSubtree | null) {
  const values = tree?.["/Evil/Cloud/Master"]?.value ?? {};
  const strings = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  return { releaseTypes: strings(values.include_release_types), unsupportedCapabilities: strings(values.unsupported_capabilities) };
}

async function fetchTone3000Batch(query: string, startPage: number, maxPages: number, filters: Tone3000SearchFilters, pageSize = TONE3000_PROVIDER_PAGE_SIZE) {
  const first = parseTone3000Page(await deviceApi.searchTone3000(query, startPage, pageSize, filters));
  const advertisedLastPage = first.totalPages ?? (first.tones.length === pageSize ? startPage + maxPages - 1 : startPage);
  const lastPage = Math.max(startPage, Math.min(advertisedLastPage, startPage + maxPages - 1));
  const requestedPages = Array.from({ length: lastPage - startPage }, (_, index) => startPage + index + 1);
  const extra = await Promise.allSettled(requestedPages.map((page) => deviceApi.searchTone3000(query, page, pageSize, filters)));
  const pages = [first]; const failedPages: number[] = [];
  extra.forEach((result, index) => { if (result.status === "fulfilled") pages.push(parseTone3000Page(result.value)); else failedPages.push(requestedPages[index]); });
  const lastSuccessfulPage = requestedPages.filter((page) => !failedPages.includes(page)).at(-1) ?? startPage;
  const nextPage = failedPages.length ? Math.min(...failedPages) : first.totalPages !== null && lastSuccessfulPage >= first.totalPages ? null : pages.at(-1)?.tones.length === pageSize ? lastSuccessfulPage + 1 : null;
  return { tones: uniqueTones(pages.flatMap((page) => page.tones)), total: first.total, nextPage, partialFailures: failedPages.length };
}

async function fetchHeadRushCloudBatch(query: string, pageToken: string | undefined, maxPages: number, compatibility: ReturnType<typeof headRushCloudCompatibility>, pageSize = TONE_PAGE_SIZE) {
  const tones: CloudTone[] = []; let total: number | null = null; let nextPageToken: string | null = pageToken ?? null; let partialFailures = 0;
  for (let index = 0; index < maxPages; index++) {
    const tokenForRequest = index === 0 ? pageToken : nextPageToken ?? undefined;
    if (index > 0 && !tokenForRequest) break;
    try {
      const page = parseHeadRushCloudPage(await deviceApi.listHeadRushCloud(query, tokenForRequest, pageSize, compatibility));
      tones.push(...page.tones); total = page.total ?? total; nextPageToken = page.nextPageToken;
    } catch (error) {
      if (!index) throw error;
      partialFailures++; nextPageToken = tokenForRequest ?? null; break;
    }
  }
  return { tones: uniqueTones(tones), total, nextPageToken, partialFailures };
}

const selectPersistedState = (() => {
  let previousReferences: unknown[] = [];
  let previousResult: Partial<AppState> | undefined;
  return (state: AppState): Partial<AppState> => {
    const references = [
      state.preferences, state.liveLayout, state.liveStages, state.selectedLiveStageId,
      state.favoriteLiveControlKeys, state.liveControlPresets, state.snapshots,
      state.testRigs, state.selectedTestRigId, state.testRigSets, state.selectedTestRigSetId,
      state.tones, state.toneModels, state.toneTotals, state.toneHasMore,
      state.toneHasMoreBySource, state.toneQuery, state.toneUpdatedAt,
      state.toneUpdatedAtBySource, state.toneCursor, state.favoriteToneIds,
      state.favoriteRigIds, state.favoriteBlockNames, state.savedWorkflows, state.rigHistory,
    ];
    if (previousResult && references.every((value, index) => Object.is(value, previousReferences[index]))) return previousResult;
    previousReferences = references;
    previousResult = {
      preferences: state.preferences,
      liveLayout: state.liveLayout,
      liveStages: state.liveStages,
      selectedLiveStageId: state.selectedLiveStageId,
      favoriteLiveControlKeys: state.favoriteLiveControlKeys,
      liveControlPresets: state.liveControlPresets,
      snapshots: state.snapshots,
      testRigs: state.testRigs,
      selectedTestRigId: state.selectedTestRigId,
      testRigSets: state.testRigSets,
      selectedTestRigSetId: state.selectedTestRigSetId,
      tones: state.tones,
      toneModels: state.toneModels,
      toneTotals: state.toneTotals,
      toneHasMore: state.toneHasMore,
      toneHasMoreBySource: state.toneHasMoreBySource,
      toneQuery: state.toneQuery,
      toneUpdatedAt: state.toneUpdatedAt,
      toneUpdatedAtBySource: state.toneUpdatedAtBySource,
      toneFromCache: true,
      toneCursor: state.toneCursor,
      favoriteToneIds: state.favoriteToneIds,
      favoriteRigIds: state.favoriteRigIds,
      favoriteBlockNames: state.favoriteBlockNames,
      savedWorkflows: state.savedWorkflows,
      rigHistory: Object.fromEntries(Object.entries(state.rigHistory).map(([rigId, entries]) => [rigId, retainedHistory(entries)]).filter(([, entries]) => entries.length)),
    };
    return previousResult;
  };
})();

const LIVE_ACTIONS = new Set<LiveActionType>([
  "rig-prev", "rig-next", "scene", "block-toggle", "tuner", "tap-tempo",
  "drums", "snapshot", "custom",
]);
const LIVE_BINDING_ACTIONS = new Set<LiveActionType>(["rig-prev", "rig-next", "scene", "block-toggle", "tuner", "tap-tempo", "drums"]);

function normalizePersistedLiveButton(candidate: unknown): LiveButton | null {
  if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.action !== "string" || !LIVE_ACTIONS.has(candidate.action as LiveActionType)) return null;
  const action = candidate.action as LiveActionType;
  const target = typeof candidate.target === "string" ? candidate.target : undefined;
  const midiValue = isRecord(candidate.midi) ? candidate.midi : {};
  const fallbackMidi = flexPrimeMidiCommand(action, target);
  const midi: MidiCommand = normalizeLiveMidiCommand({
    type: midiValue.type === "pc" || midiValue.type === "note" || midiValue.type === "cc" ? midiValue.type : fallbackMidi.type,
    channel: Number(midiValue.channel ?? fallbackMidi.channel),
    number: Number(midiValue.number ?? fallbackMidi.number),
    value: Number(midiValue.value ?? fallbackMidi.value),
    ...(midiValue.releaseValue === undefined && fallbackMidi.releaseValue === undefined ? {} : { releaseValue: Number(midiValue.releaseValue ?? fallbackMidi.releaseValue) }),
  });
  const button = {
    ...candidate,
    id: candidate.id,
    action,
    target,
    label: typeof candidate.label === "string" ? candidate.label : action.toUpperCase(),
    subtitle: typeof candidate.subtitle === "string" ? candidate.subtitle : "",
    color: typeof candidate.color === "string" ? candidate.color : "cyan",
    icon: typeof candidate.icon === "string" ? candidate.icon : "zap",
    midi,
  } as LiveButton;
  const migrated = migrateStageTunerGesture(migrateLegacyStageMidi({ ...button, holdMs: action === "tuner" ? button.holdMs ?? 650 : button.holdMs }));
  const validBinding = (binding: LiveButton["tapBinding"]) => binding && LIVE_BINDING_ACTIONS.has(binding.action) ? binding : undefined;
  return {
    ...migrated,
    midi: normalizeLiveMidiCommand(migrated.midi),
    switchType: canonicalLiveSwitchType(migrated),
    tapBinding: validBinding(migrated.tapBinding),
    holdBinding: validBinding(migrated.holdBinding),
    doubleBinding: validBinding(migrated.doubleBinding),
  };
}

function normalizePersistedLiveLayout(candidate: unknown, fallback: LiveLayout): LiveLayout {
  if (!isRecord(candidate) || !Array.isArray(candidate.buttons)) return fallback;
  const finite = (value: unknown, defaultValue: number) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
  let dimensions = normalizeLiveDimensions(
    finite(candidate.rows, fallback.rows),
    finite(candidate.columns, fallback.columns),
    finite(candidate.firstRowColumns, fallback.firstRowColumns),
  );
  const recovered = candidate.buttons.slice(0, 32).map(normalizePersistedLiveButton);
  let lastOccupied = -1;
  for (let index = recovered.length - 1; index >= 0; index -= 1) {
    if (recovered[index] !== null) { lastOccupied = index; break; }
  }
  if (lastOccupied >= dimensions.size) dimensions = { rows: 4, columns: 8, firstRowColumns: 8, size: 32 };
  const buttons = [...recovered.slice(0, dimensions.size), ...Array(Math.max(0, dimensions.size - recovered.length)).fill(null)];
  const model = candidate.model === "Prime" || candidate.model === "Core" || candidate.model === "Prime Flex" ? candidate.model : fallback.model;
  return {
    model,
    rows: dimensions.rows,
    columns: dimensions.columns,
    firstRowColumns: dimensions.firstRowColumns,
    locked: typeof candidate.locked === "boolean" ? candidate.locked : fallback.locked,
    spacing: normalizeLiveStageSpacing(isRecord(candidate.spacing) ? candidate.spacing : undefined),
    buttons,
  };
}

/**
 * Merge a persisted workspace without trusting browser storage as valid app
 * state. Older versions are repaired and malformed sections fall back to the
 * current defaults independently, so one bad StageHand control cannot prevent
 * RushLink from starting.
 */
export function mergePersistedAppState(persisted: unknown, current: AppState): AppState {
  const saved = isRecord(persisted) ? persisted as Partial<AppState> : {};
  const savedCursor = isRecord(saved.toneCursor) ? saved.toneCursor as unknown as ToneCatalogueCursor : undefined;
  const hasProviderCursors = isRecord(savedCursor?.tone3000) && isRecord(savedCursor?.headRushCloud);
  const toneCursor = hasProviderCursors ? {
    tone3000: { ...savedCursor!.tone3000, filters: normalizedTone3000Filters(savedCursor!.tone3000.filters) },
    headRushCloud: savedCursor!.headRushCloud,
  } : current.toneCursor;
  const legacyLayout = saved.liveLayout ? normalizePersistedLiveLayout(saved.liveLayout, current.liveLayout) : current.liveLayout;
  const seenStageIds = new Set<string>();
  const recoveredStages = Array.isArray(saved.liveStages) ? saved.liveStages.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim() || seenStageIds.has(candidate.id)) return [];
    seenStageIds.add(candidate.id);
    return [{
      id: candidate.id,
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "Recovered stage",
      ...(typeof candidate.rigId === "string" && candidate.rigId ? { rigId: candidate.rigId } : {}),
      layout: normalizePersistedLiveLayout(candidate.layout, legacyLayout),
    } satisfies LiveStage];
  }) : [];
  const liveStages = recoveredStages.length ? recoveredStages : [{ ...current.liveStages[0], layout: legacyLayout }];
  const selectedLiveStageId = liveStages.some((stage) => stage.id === saved.selectedLiveStageId) ? saved.selectedLiveStageId! : liveStages[0].id;
  const liveLayout = liveStages.find((stage) => stage.id === selectedLiveStageId)?.layout ?? legacyLayout;
  const savedTestRigs = Array.isArray(saved.testRigs) ? saved.testRigs : current.testRigs;
  const testRigs = repairPersistedTestRigs(migrateSeededTestRigSounds(savedTestRigs));
  const savedTestRigSets = Array.isArray(saved.testRigSets) ? saved.testRigSets.filter((setlist) => isRecord(setlist) && Array.isArray(setlist.rigIds)) as ToneTestSet[] : null;
  const favoriteRigIds = Array.isArray(saved.favoriteRigIds) ? saved.favoriteRigIds.filter((rigId): rigId is string => typeof rigId === "string") : current.favoriteRigIds;
  const preferences = isRecord(saved.preferences) ? { ...current.preferences, ...saved.preferences as Partial<Preferences> } : current.preferences;
  return {
    ...current,
    ...saved,
    preferences,
    liveLayout,
    liveStages,
    selectedLiveStageId,
    testRigs,
    favoriteLiveControlKeys: Array.isArray(saved.favoriteLiveControlKeys) ? saved.favoriteLiveControlKeys : current.favoriteLiveControlKeys,
    liveControlPresets: (Array.isArray(saved.liveControlPresets) ? saved.liveControlPresets : current.liveControlPresets).filter((preset) => !["looper", "practice", "expression"].includes(preset.button.action)),
    toneCursor,
    toneHasMore: hasProviderCursors ? saved.toneHasMore ?? false : false,
    toneHasMoreBySource: hasProviderCursors && isRecord(saved.toneHasMoreBySource) ? saved.toneHasMoreBySource : current.toneHasMoreBySource,
    toneUpdatedAtBySource: { ...current.toneUpdatedAtBySource, ...(isRecord(saved.toneUpdatedAtBySource) ? saved.toneUpdatedAtBySource : {}) },
    tonePrefetchingSource: null,
    favoriteRigIds: favoriteRigIds.filter((rigId) => !deviceApi.isNative() || !demoRigs.some((rig) => rig.favorite && rig.id === rigId)),
    favoriteBlockNames: Array.isArray(saved.favoriteBlockNames) ? saved.favoriteBlockNames : current.favoriteBlockNames,
    savedWorkflows: Array.isArray(saved.savedWorkflows) ? saved.savedWorkflows : current.savedWorkflows,
    testRigSets: savedTestRigSets?.map((setlist) => ({ ...setlist, rigIds: setlist.rigIds.filter((testRigId) => testRigs.some((rig) => rig.id === testRigId)) })) ?? current.testRigSets,
    selectedTestRigSetId: savedTestRigSets?.some((setlist) => setlist.id === saved.selectedTestRigSetId) ? saved.selectedTestRigSetId! : current.selectedTestRigSetId,
    testRigReturn: null,
    auditionError: null,
  };
}

const appPersistStorage = createBufferedPersistStorage<Partial<AppState>>({ delayMs: 300 });
export const flushAppPersistence = () => appPersistStorage.flush();

export const useAppStore = create<AppState>()(persist((set, get) => ({
  page: "dashboard",
  sidebarCollapsed: false,
  device: null,
  capabilities: null,
  connectionBusy: false,
  connectionError: null,
  liveSubtree: null,
  liveSnapshot: null,
  syncBusy: false,
  lastSyncSource: null,
  performanceTunerActive: false,
  preferences: {
    address: "headrushflexprime.local", writeMode: "immediate", firstWriteResolved: false,
    density: "comfortable", reduceMotion: false, highContrast: false, keepAwake: true, autoBackup: true,
    autoDiscovery: true, autoReconnect: true, confirmRigReplacement: true, keepHistory: true,
  },
  rigs: [],
  favoriteRigIds: [],
  selectedRigId: "",
  selectedBlockId: null,
  setlists: [],
  selectedSetlistId: "",
  liveLayout: defaultLiveLayout,
  liveStages: [defaultLiveStage],
  selectedLiveStageId: defaultLiveStage.id,
  favoriteLiveControlKeys: [],
  liveControlPresets: [],
  tones: [],
  toneModels: {},
  toneLoading: false,
  toneLoadingMore: false,
  toneLoadingMoreSource: null,
  tonePrefetchingSource: null,
  toneError: null,
  toneTotals: { tone3000: null, headRushCloud: null },
  toneHasMore: false,
  toneHasMoreBySource: { tone3000: false, headRushCloud: false },
  toneQuery: "",
  toneUpdatedAt: null,
  toneUpdatedAtBySource: { tone3000: null, headRushCloud: null },
  toneFromCache: false,
  toneCursor: {
    tone3000: { query: "", nextPage: null, filters: normalizedTone3000Filters() },
    headRushCloud: { query: "", nextToken: null },
  },
  toneModelLoading: false,
  toneModelError: null,
  favoriteToneIds: [],
  favoriteBlockNames: [],
  savedWorkflows: [],
  selectedToneId: null,
  selectedToneModelId: null,
  auditioningToneId: null,
  auditionBusy: false,
  auditionError: null,
  captureOverride: "auto",
  testRigs: testRigTemplates,
  selectedTestRigId: "clean",
  testRigSets: [{ id: "tonepilot-reference", name: "Reference Run", rigIds: testRigTemplates.map((rig) => rig.id) }],
  selectedTestRigSetId: "tonepilot-reference",
  testRigReturn: null,
  testRigSyncBusy: false,
  testRigSyncError: null,
  testRigSyncedAt: null,
  pendingWrites: [],
  snapshots: [],
  diagnostics: [
    { id: "d1", time: timestamp(), level: "info", source: "Transport", message: deviceApi.isNative() ? "Native transport ready" : "Browser preview ready; connect to start a demo session" },
  ],
  undoStack: [],
  rigHistory: {},
  historyPreview: null,

  setPage: (page) => {
    set({ page });
    if (get().device && deviceApi.isNative()) void get().refreshPage(page, "manual");
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setPreference: (key, value) => set((s) => ({ preferences: { ...s.preferences, [key]: value } })),
  setPerformanceTunerActive: (performanceTunerActive) => set({ performanceTunerActive }),

  connect: async (address) => {
    const target = address || get().preferences.address;
    set({ connectionBusy: true, connectionError: null, device: get().device ? { ...get().device!, status: "syncing" } : null });
    try {
      const result = await deviceApi.connect(target);
      set((s) => ({ device: { ...result.device, status: deviceApi.isNative() ? "syncing" : "demo" }, capabilities: result.capabilities, preferences: { ...s.preferences, address: target } }));
      if (deviceApi.isNative()) {
        await get().refreshFull("connect");
        if (!get().liveSnapshot || get().device?.status !== "ready") throw new Error("The pedal responded, but RushLink could not read its live state.");
        void deviceApi.startEvents();
      } else {
        const now = Date.now();
        set({
          rigs: structuredClone(demoRigs), selectedRigId: demoRigs[0].id, selectedBlockId: demoRigs[0].blocks.find((block) => !block.empty)?.id ?? null,
          setlists: structuredClone(demoSetlists), selectedSetlistId: demoSetlists[0].id,
          tones: cloudTones.map((tone) => ({ ...tone, detectedType: detectCaptureType(tone) })), snapshots: structuredClone(demoSnapshots),
          favoriteRigIds: demoRigs.filter((rig) => rig.favorite).map((rig) => rig.id), toneUpdatedAt: now, toneUpdatedAtBySource: { tone3000: now, headRushCloud: now },
        });
      }
      set({ connectionBusy: false });
      get().addDiagnostic({ level: "success", source: "Device", message: `Connected to ${result.device.name}`, detail: `${result.device.host} · ${result.device.firmware}` });
    } catch (error) {
      const message = deviceErrorMessage(error);
      set({ connectionBusy: false, connectionError: message, device: null, capabilities: null, liveSubtree: null, liveSnapshot: null, syncBusy: false, rigs: [], selectedRigId: "", selectedBlockId: null, setlists: [], selectedSetlistId: "", tones: [], toneModels: {}, selectedToneId: null, selectedToneModelId: null, auditioningToneId: null, testRigReturn: null });
      get().addDiagnostic({ level: "error", source: "Device", message: "Connection failed", detail: deviceErrorDetail(error) });
    }
  },
  disconnect: async () => {
    let disconnectError: unknown;
    try { await deviceApi.disconnect(); } catch (error) { disconnectError = error; }
    consecutiveSyncFailures = 0;
    set({ device: null, capabilities: null, connectionError: null, liveSubtree: null, liveSnapshot: null, syncBusy: false, rigs: [], selectedRigId: "", selectedBlockId: null, setlists: [], selectedSetlistId: "", tones: [], toneModels: {}, selectedToneId: null, selectedToneModelId: null, auditioningToneId: null, testRigReturn: null });
    get().addDiagnostic(disconnectError
      ? { level: "warning", source: "Device", message: "Disconnected locally", detail: deviceErrorDetail(disconnectError) }
      : { level: "info", source: "Device", message: "Device disconnected" });
  },

  refreshFull: async (source = "manual") => {
    if (!deviceApi.isNative() || !get().device) return;
    set({ syncBusy: true });
    try {
      const tree = overlayPendingWrites(await deviceApi.subtree() as HeadRushSubtree, get().pendingWrites);
      const snapshot = parseHeadRushSubtree(tree);
      consecutiveSyncFailures = 0;
      const setlistRows: Setlist[] = snapshot.setlists.map((list) => ({
        id: list.id,
        name: list.name,
        items: Array.from({ length: list.count }, (_, index) => ({ id: `${list.id}-${index}`, rigId: "", title: `Rig ${index + 1}` })),
      }));
      set((state) => ({
        ...stagePatchForChangedRig(state, snapshot.rig.id),
        liveSubtree: tree,
        liveSnapshot: snapshot,
        syncBusy: false,
        connectionError: null,
        lastSyncSource: source,
        device: state.device ? { ...state.device, name: snapshot.deviceName, firmware: snapshot.firmware, status: "ready" } : state.device,
        rigs: [snapshot.rig, ...snapshot.rigLibrary.filter((rig) => !rig.loaded).map((rig): Rig => ({ id: rig.id, name: rig.name, author: "On device", color: rig.color, tags: ["Device"], tempo: 0, favorite: false, modified: "On device", blocks: [] }))],
        selectedRigId: snapshot.rig.id,
        selectedBlockId: state.selectedBlockId && snapshot.rig.blocks.some((block) => block.id === state.selectedBlockId)
          ? state.selectedBlockId : snapshot.rig.blocks.find((block) => !block.empty)?.id ?? null,
        setlists: setlistRows,
        selectedSetlistId: snapshot.loadedSetlistId || setlistRows[0]?.id || "",
      }));
      if (snapshot.loadedSetlistId) {
        try {
          const response = await deviceApi.getSetlist(snapshot.loadedSetlistId);
          const detail = typeof response === "string" ? JSON.parse(response) as Record<string, unknown> : response as Record<string, unknown>;
          const rigIds = Array.isArray(detail?.rigs) ? detail.rigs.map(String) : [];
          const rigNames = Array.isArray(detail?.rig_names) ? detail.rig_names.map(String) : [];
          set((state) => ({ setlists: state.setlists.map((list) => list.id !== snapshot.loadedSetlistId ? list : {
            ...list,
            items: rigIds.map((rigId, index) => ({ id: `${list.id}-${index}`, rigId, title: rigNames[index] ?? `Rig ${index + 1}` })),
          }) }));
        } catch (error) {
          get().addDiagnostic({ level: "warning", source: "Setlists", message: "Could not expand active setlist", detail: deviceErrorDetail(error) });
        }
      }
    } catch (error) {
      consecutiveSyncFailures += 1;
      const unavailable = consecutiveSyncFailures >= SYNC_FAILURE_LIMIT;
      set((state) => ({
        syncBusy: false,
        connectionError: unavailable ? deviceErrorMessage(error) : state.connectionError,
        device: unavailable && state.device ? { ...state.device, status: "error" } : state.device,
      }));
      get().addDiagnostic({ level: unavailable ? "error" : "warning", source: "Sync", message: unavailable ? "Device connection appears unavailable" : "Full device refresh failed", detail: deviceErrorDetail(error) });
    }
  },

  refreshPage: async (requestedPage, source = "poll") => {
    if (!deviceApi.isNative() || !get().device) return;
    if (!get().liveSubtree) return get().refreshFull(source);
    if (scopedRefresh) return scopedRefresh;
    const activePage = requestedPage ?? get().page;
    scopedRefresh = (async () => {
      const basePaths = PAGE_PATHS[activePage] ?? PAGE_PATHS.dashboard;
      const blockPaths = ["dashboard", "editor", "live", "tone-cloud"].includes(activePage)
        ? get().liveSnapshot?.rig.blocks.flatMap((block) => block.sourcePath ? [block.sourcePath] : []) ?? [] : [];
      const paths = [...new Set([...basePaths, ...blockPaths])];
      try {
        const updates = await Promise.all(paths.map(async (path) => [path, await deviceApi.properties(path)] as const));
        consecutiveSyncFailures = 0;
        const currentTree = get().liveSubtree ?? {};
        const merged = mergeReflectedTree(currentTree, updates);
        const mergedTree = overlayPendingWrites(merged.tree, get().pendingWrites);
        // Successful polling commonly returns byte-for-byte equivalent data.
        // Preserve store references and avoid parsing/rerendering in that case.
        if (!merged.changed && mergedTree === currentTree) return;
        const snapshot = parseHeadRushSubtree(mergedTree);
        set((state) => ({
          ...stagePatchForChangedRig(state, snapshot.rig.id),
          liveSubtree: mergedTree,
          liveSnapshot: snapshot,
          lastSyncSource: source,
          connectionError: null,
          device: state.device ? { ...state.device, name: snapshot.deviceName, firmware: snapshot.firmware, status: "ready" } : state.device,
          rigs: [snapshot.rig, ...snapshot.rigLibrary.filter((rig) => !rig.loaded).map((rig): Rig => {
            const existing = state.rigs.find((item) => item.id === rig.id);
            return existing ?? { id: rig.id, name: rig.name, author: "On device", color: rig.color, tags: ["Device"], tempo: 0, favorite: false, modified: "On device", blocks: [] };
          })],
          selectedRigId: snapshot.rig.id,
          setlists: snapshot.setlists.map((list) => state.setlists.find((item) => item.id === list.id) ?? { id: list.id, name: list.name, items: Array.from({ length: list.count }, (_, index) => ({ id: `${list.id}-${index}`, rigId: "", title: `Rig ${index + 1}` })) }),
          selectedSetlistId: snapshot.loadedSetlistId || state.selectedSetlistId,
        }));
      } catch (error) {
        consecutiveSyncFailures += 1;
        const unavailable = consecutiveSyncFailures >= SYNC_FAILURE_LIMIT;
        if (unavailable) set((state) => ({ connectionError: deviceErrorMessage(error), device: state.device ? { ...state.device, status: "error" } : state.device }));
        get().addDiagnostic({ level: unavailable ? "error" : "warning", source: "Sync", message: unavailable ? "Device connection appears unavailable" : `Could not refresh ${activePage}`, detail: deviceErrorDetail(error) });
      } finally {
        scopedRefresh = null;
      }
    })();
    return scopedRefresh;
  },

  refreshToneServices: async (query = "", force = false, requestedFilters, source = "Tone3000", background = false) => {
    const normalizedQuery = query.trim();
    const filters = normalizedTone3000Filters(requestedFilters);
    const key = providerKey(source);
    const cacheKey = toneCacheKey(source, normalizedQuery, filters);
    const updateCursor = (cursor: ToneCatalogueCursor, nextPage: number | string | null): ToneCatalogueCursor => source === "Tone3000"
      ? { ...cursor, tone3000: { query: normalizedQuery, nextPage: typeof nextPage === "number" ? nextPage : null, filters } }
      : { ...cursor, headRushCloud: { query: normalizedQuery, nextToken: typeof nextPage === "string" ? nextPage : null } };
    if (!deviceApi.isNative() || !get().device) {
      set((state) => ({ toneQuery: background ? state.toneQuery : normalizedQuery, toneFromCache: true, toneCursor: updateCursor(state.toneCursor, null) }));
      return;
    }
    const now = Date.now();
    const cached = toneCatalogueCache.get(cacheKey);
    const state = get();
    const sourceUpdatedAt = state.toneUpdatedAtBySource?.[key] ?? null;
    const cursorMatches = source === "Tone3000"
      ? toneCacheKey(source, state.toneCursor.tone3000.query, normalizedTone3000Filters(state.toneCursor.tone3000.filters)) === cacheKey
      : state.toneCursor.headRushCloud.query === normalizedQuery;
    const sourceToneCount = state.tones.filter((tone) => tone.source === source).length;
    const expectedCurrentBatch = Math.min(TONE_PAGE_SIZE, state.toneTotals[key] ?? TONE_PAGE_SIZE);
    const currentBatchComplete = sourceToneCount >= expectedCurrentBatch;
    const currentIsFresh = cursorMatches && currentBatchComplete && sourceUpdatedAt !== null && now - sourceUpdatedAt < TONE_CACHE_TTL;
    const expectedCachedBatch = cached ? Math.min(TONE_PAGE_SIZE, cached.total ?? TONE_PAGE_SIZE) : TONE_PAGE_SIZE;
    const cachedBatchComplete = Boolean(cached && cached.tones.length >= expectedCachedBatch);
    if (!force && cached && cachedBatchComplete && now - cached.updatedAt < TONE_CACHE_TTL) {
      set((current) => {
        const toneHasMoreBySource = { ...current.toneHasMoreBySource, [key]: Boolean(cached.nextPage) };
        return {
          tones: replaceProviderTones(current.tones, source, cached.tones),
          toneTotals: { ...current.toneTotals, [key]: cached.total },
          toneCursor: updateCursor(current.toneCursor, cached.nextPage),
          toneHasMoreBySource,
          toneHasMore: toneHasMoreBySource.tone3000 || toneHasMoreBySource.headRushCloud,
          toneQuery: background ? current.toneQuery : normalizedQuery,
          toneUpdatedAt: background ? current.toneUpdatedAt : cached.updatedAt,
          toneUpdatedAtBySource: { ...current.toneUpdatedAtBySource, [key]: cached.updatedAt },
          toneFromCache: background ? current.toneFromCache : true,
          toneError: background ? current.toneError : null,
          toneLoading: background ? current.toneLoading : false,
          tonePrefetchingSource: background ? null : current.tonePrefetchingSource,
        };
      });
      return;
    }
    if (!force && currentIsFresh) {
      set(background ? { tonePrefetchingSource: null } : { toneFromCache: true, toneError: null });
      return;
    }
    const requestSerial = ++toneRequestSerial[key];
    if (background) set({ tonePrefetchingSource: source });
    else set({ toneLoading: true, toneLoadingMore: false, toneLoadingMoreSource: null, toneError: null, toneFromCache: false, toneQuery: normalizedQuery });
    try {
      const result = source === "Tone3000"
        ? await fetchTone3000Batch(normalizedQuery, 1, TONE3000_BATCH_PAGES, filters).then((page) => ({ ...page, providerNextPage: page.nextPage as number | string | null }))
        : await fetchHeadRushCloudBatch(normalizedQuery, undefined, 1, headRushCloudCompatibility(get().liveSubtree)).then((page) => ({ ...page, providerNextPage: page.nextPageToken as number | string | null }));
      if (requestSerial !== toneRequestSerial[key]) return;
      const tones = result.tones;
      const total = result.total;
      const nextPage = result.providerNextPage;
      const partialFailures = result.partialFailures;
      const updatedAt = Date.now();
      toneCatalogueCache.set(cacheKey, { source, tones, total, nextPage, query: normalizedQuery, filters, updatedAt });
      set((current) => {
        const merged = replaceProviderTones(current.tones, source, tones);
        const toneHasMoreBySource = { ...current.toneHasMoreBySource, [key]: Boolean(nextPage) };
        return {
          tones: merged,
          toneLoading: background ? current.toneLoading : false,
          tonePrefetchingSource: background ? null : current.tonePrefetchingSource,
          toneError: background ? current.toneError : partialFailures ? `${source} returned a partial page. Retry when the device connection is stable.` : null,
          toneTotals: { ...current.toneTotals, [key]: total },
          toneCursor: updateCursor(current.toneCursor, nextPage),
          toneHasMore: toneHasMoreBySource.tone3000 || toneHasMoreBySource.headRushCloud,
          toneHasMoreBySource,
          toneQuery: background ? current.toneQuery : normalizedQuery,
          toneUpdatedAt: background ? current.toneUpdatedAt : updatedAt,
          toneUpdatedAtBySource: { ...current.toneUpdatedAtBySource, [key]: updatedAt },
          toneFromCache: background ? current.toneFromCache : false,
          selectedToneId: merged.some((tone) => tone.id === current.selectedToneId) ? current.selectedToneId : null,
        };
      });
    } catch (error) {
      if (requestSerial !== toneRequestSerial[key]) return;
      const message = `${source} did not return a page. Its previous cached results remain available.`;
      set(background ? { tonePrefetchingSource: null } : { toneLoading: false, toneError: message, toneFromCache: true });
      get().addDiagnostic({ level: "warning", source: "TonePilot", message: `${source} search failed`, detail: deviceErrorDetail(error) });
    }
  },

  prefetchToneService: async (source, query = "", filters) => get().refreshToneServices(query, false, filters, source, true),

  loadMoreTones: async (source) => {
    const key = providerKey(source);
    const state = get();
    const filters = normalizedTone3000Filters(state.toneCursor.tone3000.filters);
    const query = source === "Tone3000" ? state.toneCursor.tone3000.query : state.toneCursor.headRushCloud.query;
    const nextPage = source === "Tone3000" ? state.toneCursor.tone3000.nextPage : state.toneCursor.headRushCloud.nextToken;
    if (!deviceApi.isNative() || !state.device || state.toneLoading || state.toneLoadingMore || !nextPage) return;
    const requestSerial = ++toneRequestSerial[key];
    set({ toneLoadingMore: true, toneLoadingMoreSource: source, toneError: null });
    try {
      const result = source === "Tone3000"
        ? await fetchTone3000Batch(query, Number(nextPage), TONE3000_BATCH_PAGES, filters).then((page) => ({ ...page, providerNextPage: page.nextPage as number | string | null }))
        : await fetchHeadRushCloudBatch(query, String(nextPage), 1, headRushCloudCompatibility(get().liveSubtree)).then((page) => ({ ...page, providerNextPage: page.nextPageToken as number | string | null }));
      if (requestSerial !== toneRequestSerial[key]) return;
      const updatedAt = Date.now();
      const providerNextPage = result.providerNextPage;
      set((current) => {
        const providerTones = uniqueTones([...current.tones.filter((tone) => tone.source === source), ...result.tones]);
        const tones = replaceProviderTones(current.tones, source, providerTones);
        const toneHasMoreBySource = { ...current.toneHasMoreBySource, [key]: Boolean(providerNextPage) };
        const toneCursor = source === "Tone3000"
          ? { ...current.toneCursor, tone3000: { query, nextPage: typeof providerNextPage === "number" ? providerNextPage : null, filters } }
          : { ...current.toneCursor, headRushCloud: { query, nextToken: typeof providerNextPage === "string" ? providerNextPage : null } };
        return {
          tones,
          toneCursor,
          toneLoadingMore: false,
          toneLoadingMoreSource: null,
          toneError: result.partialFailures ? `${source} returned a partial page. Retry when the connection is stable.` : null,
          toneTotals: { ...current.toneTotals, [key]: result.total ?? current.toneTotals[key] },
          toneHasMore: toneHasMoreBySource.tone3000 || toneHasMoreBySource.headRushCloud,
          toneHasMoreBySource,
          toneUpdatedAt: updatedAt,
          toneUpdatedAtBySource: { ...current.toneUpdatedAtBySource, [key]: updatedAt },
          toneFromCache: false,
        };
      });
      const current = get();
      const providerTones = current.tones.filter((tone) => tone.source === source);
      toneCatalogueCache.set(toneCacheKey(source, query, filters), { source, tones: providerTones, total: current.toneTotals[key], nextPage: providerNextPage, query, filters, updatedAt });
    } catch (error) {
      if (requestSerial !== toneRequestSerial[key]) return;
      set({ toneLoadingMore: false, toneLoadingMoreSource: null, toneError: `Could not load the next ${source} page.` });
      get().addDiagnostic({ level: "warning", source: "TonePilot", message: `Could not load the next ${source} page`, detail: deviceErrorDetail(error) });
    }
  },

  selectRig: (selectedRigId) => set((s) => ({ selectedRigId, selectedBlockId: s.rigs.find((r) => r.id === selectedRigId)?.blocks[0]?.id ?? null })),
  loadRig: async (rigId, srId = "") => {
    if (get().preferences.confirmRigReplacement && get().liveSnapshot?.rig.modified === "Unsaved changes" && !window.confirm("The current device rig has unsaved changes. Load another rig and discard them?")) return;
    await deviceApi.callMethod("/Evil/API/Rigs", "loadRigConfirm", [rigId, srId]);
    set({ historyPreview: null });
    await get().refreshFull("manual");
    get().addDiagnostic({ level: "success", source: "Rig Editor", message: `Loaded ${get().liveSnapshot?.rig.name ?? "rig"}` });
  },
  saveCurrentRig: async () => { await deviceApi.callMethod("/Evil/API/Rigs", "saveRig", []); await get().refreshPage("editor", "manual"); },
  createRig: async (name) => {
    if (!deviceApi.isNative()) {
      const source = cloneRig(currentRig(get()));
      const rigId = id();
      const rig = { ...source, id: rigId, name: name?.trim() || "New Rig", favorite: false, modified: "Just now", blocks: source.blocks.map((block, index) => ({ ...block, id: `${rigId}-slot-${index + 1}` })) };
      set((state) => ({ rigs: [...state.rigs, rig], selectedRigId: rigId, selectedBlockId: rig.blocks.find((block) => !block.empty)?.id ?? null }));
      return;
    }
    await deviceApi.callMethod("/Evil/API/Rigs", "makeNewRigConfirm", [-1]);
    if (name?.trim()) {
      await deviceApi.callMethod("/Evil/API/Rigs", "renameLoadedRig", [name.trim()]);
      await deviceApi.callMethod("/Evil/API/Rigs", "saveRig", []);
    }
    await get().refreshFull("manual");
  },
  renameRig: async (rigId, name) => {
    if (!deviceApi.isNative()) { set((state) => ({ rigs: state.rigs.map((rig) => rig.id === rigId ? { ...rig, name: name.trim(), modified: "Just now" } : rig) })); return; }
    await deviceApi.callMethod("/Evil/API/Rigs", "renameRig", [rigId, name.trim()]);
    await get().refreshFull("manual");
  },
  deleteRig: async (rigId) => {
    if (get().preferences.autoBackup) await get().createSnapshot("Before deleting a rig");
    if (!deviceApi.isNative()) {
      set((state) => {
        const rigs = state.rigs.filter((rig) => rig.id !== rigId); const selectedRigId = state.selectedRigId === rigId ? rigs[0]?.id ?? "" : state.selectedRigId;
        return { rigs, selectedRigId, selectedBlockId: rigs.find((rig) => rig.id === selectedRigId)?.blocks.find((block) => !block.empty)?.id ?? null, favoriteRigIds: state.favoriteRigIds.filter((id) => id !== rigId) };
      });
      return;
    }
    await deviceApi.callMethod("/Evil/API/Rigs", "deleteRig", [rigId]);
    await get().refreshFull("manual");
  },
  duplicateRig: async (name) => {
    if (!deviceApi.isNative()) {
      const source = cloneRig(currentRig(get())); const rigId = id(); const rig = { ...source, id: rigId, name: name.trim(), favorite: false, modified: "Just now", blocks: source.blocks.map((block, index) => ({ ...block, id: `${rigId}-slot-${index + 1}` })) };
      set((state) => ({ rigs: [...state.rigs, rig], selectedRigId: rigId, selectedBlockId: rig.blocks.find((block) => !block.empty)?.id ?? null }));
      return;
    }
    await deviceApi.callMethod("/Evil/API/Rigs", "saveRigAs", [name.trim(), -1]);
    await get().refreshFull("manual");
  },
  toggleFavoriteRig: (rigId) => set((state) => ({ favoriteRigIds: state.favoriteRigIds.includes(rigId) ? state.favoriteRigIds.filter((id) => id !== rigId) : [...state.favoriteRigIds, rigId] })),
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  updateParameter: (blockId, parameterId, value) => {
    const state = get();
    const rig = currentRig(state);
    const block = rig.blocks.find((item) => item.id === blockId);
    const param = block?.parameters.find((item) => item.id === parameterId);
    if (!block || !param) return;
    const historyBefore = cloneRig(rig);
    const deviceValue = parameterDeviceValue(param, value);
    const write: PendingWrite = { id: id(), path: block.sourcePath ?? "/Evil/Engine/Patch/Rig", property: param.sourceProperty ?? parameterId, previous: param.rawValue ?? param.value, value: deviceValue, createdAt: new Date().toISOString() };
    const patchRig = (target: Rig): Rig => ({ ...target, blocks: target.blocks.map((b) => b.id !== blockId ? b : { ...b, parameters: b.parameters.map((p) => p.id === parameterId ? { ...p, value } : p) }) });
    set((s) => ({
      rigs: s.rigs.map((r) => r.id !== rig.id ? r : patchRig(r)),
      liveSnapshot: s.liveSnapshot ? { ...s.liveSnapshot, rig: patchRig(s.liveSnapshot.rig) } : s.liveSnapshot,
      pendingWrites: s.preferences.writeMode === "immediate" ? s.pendingWrites : [...s.pendingWrites.filter((w) => !(w.path === write.path && w.property === write.property)), write],
      undoStack: [...s.undoStack, write].slice(-50),
    }));
    if (state.preferences.writeMode === "immediate") {
      const timerKey = `${write.path}:${write.property}`;
      const previousTimer = parameterWriteTimers.get(timerKey); if (previousTimer) clearTimeout(previousTimer);
      parameterWriteTimers.set(timerKey, setTimeout(() => {
        parameterWriteTimers.delete(timerKey);
        void deviceApi.setProperties(write.path, { [write.property]: deviceValue }).then(() => get().refreshPage("editor", "manual")).catch((error) => get().addDiagnostic({ level: "error", source: "Write", message: `Could not write ${param.label}`, detail: deviceErrorDetail(error) }));
      }, 90));
    }
    scheduleHistory(get, set, historyBefore, `${block.name}: changed ${param.label}`);
  },
  toggleBlock: async (blockId) => {
    const rig = get().liveSnapshot?.rig ?? currentRig(get());
    const block = rig.blocks.find((b) => b.id === blockId);
    if (!block) return false;
    const patchRig = (target: Rig): Rig => ({ ...target, blocks: target.blocks.map((b) => b.id === blockId ? { ...b, enabled: !b.enabled } : b) });
    set((s) => ({ rigs: s.rigs.map((r) => r.id !== rig.id ? r : patchRig(r)), liveSnapshot: s.liveSnapshot ? { ...s.liveSnapshot, rig: patchRig(s.liveSnapshot.rig) } : s.liveSnapshot }));
    const write: PendingWrite = { id: id(), path: block.sourcePath ?? "/Evil/Engine/Patch/Rig", property: "On", previous: block.enabled, value: !block.enabled, createdAt: new Date().toISOString() };
    if (get().preferences.writeMode !== "immediate") {
      set((s) => ({ pendingWrites: [...s.pendingWrites.filter((w) => !(w.path === write.path && w.property === "On")), write] }));
      return true;
    }
    try {
      await deviceApi.setProperties(write.path, { On: !block.enabled });
      void get().refreshPage(get().page, "manual");
      return true;
    } catch (error) {
      const restoreRig = (target: Rig): Rig => ({ ...target, blocks: target.blocks.map((candidate) => candidate.id === blockId ? { ...candidate, enabled: block.enabled } : candidate) });
      set((state) => ({
        rigs: state.rigs.map((candidate) => candidate.id !== rig.id ? candidate : restoreRig(candidate)),
        liveSnapshot: state.liveSnapshot ? { ...state.liveSnapshot, rig: restoreRig(state.liveSnapshot.rig) } : state.liveSnapshot,
      }));
      get().addDiagnostic({ level: "warning", source: "StageHand", message: `Could not switch ${block.name}`, detail: errorMessage(error) });
      return false;
    }
  },
  moveBlock: async (from, to) => {
    if (from === to || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= 14 || to < 0 || to >= 14) return;
    const current = cloneRig(get().liveSnapshot?.rig ?? currentRig(get()));
    const emptySlot = (slot: number): RigBlock => ({ id: `slot-${slot + 1}`, name: "Empty Slot", model: "Available", category: "utility", color: "#354150", enabled: false, empty: true, slot, moduleTypeId: 0, parameters: [] });
    const blocks = Array.from({ length: 14 }, (_, slot) => {
      const block = current.blocks.find((candidate) => candidate.slot === slot) ?? current.blocks[slot];
      return block ? { ...block, id: `slot-${slot + 1}`, slot } : emptySlot(slot);
    });
    const item = blocks[from];
    if (!item || item.empty) return;
    const target = blocks[to];
    blocks[to] = { ...item, id: `slot-${to + 1}`, slot: to };
    blocks[from] = target?.empty ? emptySlot(from) : { ...target, id: `slot-${from + 1}`, slot: from };
    const desired = { ...current, blocks };
    await get().restoreRigSnapshot(desired, `${target?.empty ? "Moved" : "Swapped"} ${item.name} from slot ${from + 1} to ${to + 1}`);
    set({ selectedBlockId: `slot-${to + 1}` });
  },
  addBlock: async (block) => {
    const historyBefore = cloneRig(get().liveSnapshot?.rig ?? currentRig(get()));
    const slot = Math.max(0, Math.min(13, block.slot));
    if (!block.moduleTypeId) throw new Error(`No reflected module type for ${block.name}`);
    await deviceApi.callMethod("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [slot, block.moduleTypeId]);
    set({ selectedBlockId: `slot-${slot + 1}` });
    await get().refreshPage("editor", "manual");
    const historyAfter = get().liveSnapshot?.rig ?? currentRig(get()); appendHistory(set, historyBefore.id, historyBefore, historyAfter, `Added ${block.name} to slot ${slot + 1}`);
    get().addDiagnostic({ level: "success", source: "Rig Editor", message: `Added ${block.name} to slot ${slot + 1}` });
  },
  removeBlock: async (blockId) => {
    const block = get().liveSnapshot?.rig.blocks.find((item) => item.id === blockId) ?? currentRig(get()).blocks.find((item) => item.id === blockId);
    if (!block) return;
    const historyBefore = cloneRig(get().liveSnapshot?.rig ?? currentRig(get()));
    await deviceApi.callMethod("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [block.slot, 0]);
    set({ selectedBlockId: null });
    await get().refreshPage("editor", "manual");
    const historyAfter = get().liveSnapshot?.rig ?? currentRig(get()); appendHistory(set, historyBefore.id, historyBefore, historyAfter, `Removed ${block.name} from slot ${block.slot + 1}`);
    get().addDiagnostic({ level: "success", source: "Rig Editor", message: `Removed ${block.name} from slot ${block.slot + 1}` });
  },
  loadBlockPreset: async (blockId, presetName) => {
    const rig = get().liveSnapshot?.rig ?? currentRig(get()); const block = rig.blocks.find((item) => item.id === blockId); if (!block) return;
    const before = cloneRig(rig); await deviceApi.loadBlockPreset(block.name, presetName); await get().refreshPage("editor", "manual");
    appendHistory(set, before.id, before, get().liveSnapshot?.rig ?? currentRig(get()), `${block.name}: loaded preset ${presetName || "default"}`);
  },
  updateRouting: async (properties) => { await deviceApi.setProperties("/Evil/Engine/Patch/Chain", properties); await get().refreshPage("editor", "manual"); },
  updateFootswitch: async (number, properties) => {
    const prefixed = Object.fromEntries(Object.entries(properties).map(([key, value]) => [`${key}${number}`, value]));
    await deviceApi.setProperties("/Evil/Engine/FootSwitch", prefixed); await get().refreshPage("editor", "manual");
  },
  restoreRigSnapshot: async (snapshot, description, recordHistory = true) => {
    const before = cloneRig(get().liveSnapshot?.rig ?? currentRig(get()));
    const current = get().liveSnapshot?.rig ?? currentRig(get());
    for (let slot = 0; slot < 14; slot++) {
      const desired = snapshot.blocks.find((block) => block.slot === slot)?.moduleTypeId ?? snapshot.blocks[slot]?.moduleTypeId ?? 0;
      const existing = current.blocks.find((block) => block.slot === slot)?.moduleTypeId ?? current.blocks[slot]?.moduleTypeId ?? 0;
      if (desired !== existing) await deviceApi.callMethod("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [slot, desired]);
    }
    for (const block of snapshot.blocks) {
      if (!block.sourcePath || block.empty) continue;
      const properties = { On: block.enabled, ...Object.fromEntries(block.parameters.filter((parameter) => parameter.writable !== false).map((parameter) => [parameter.sourceProperty ?? parameter.id, parameterDeviceValue(parameter, parameter.value)])) };
      if (Object.keys(properties).length) await deviceApi.setProperties(block.sourcePath, properties);
    }
    await get().refreshPage("editor", "manual");
    if (recordHistory) {
      const after = get().liveSnapshot?.rig ?? currentRig(get());
      appendHistory(set, before.id, before, after, description);
    }
  },
  restoreHistory: async (entryId, side) => {
    const rig = get().liveSnapshot?.rig ?? currentRig(get()); const entry = (get().rigHistory[rig.id] ?? []).find((item) => item.id === entryId); if (!entry) return;
    const existing = get().historyPreview?.rigId === rig.id ? get().historyPreview : null;
    const preview = { rigId: rig.id, entryId, side, returnState: existing?.returnState ?? cloneRig(rig), previewState: cloneRig(entry[side]) };
    await get().restoreRigSnapshot(preview.previewState, `Previewed ${side} “${entry.description}”`, false);
    set({ historyPreview: preview });
  },
  returnFromHistory: async () => {
    const preview = get().historyPreview; if (!preview) return;
    await get().restoreRigSnapshot(preview.returnState, "Returned to the device state from before history preview", false);
    set({ historyPreview: null });
    get().addDiagnostic({ level: "success", source: "Rig history", message: "Returned to current device state" });
  },
  overwriteFromHistory: async () => {
    const preview = get().historyPreview; if (!preview) return;
    await get().saveCurrentRig();
    const committed = cloneRig(get().liveSnapshot?.rig ?? preview.previewState);
    appendHistory(set, preview.rigId, preview.returnState, committed, "Overwrote current rig from change history");
    set({ historyPreview: null });
    get().addDiagnostic({ level: "success", source: "Rig history", message: "Historical state saved as the current rig" });
  },
  toggleHistorySaved: (entryId) => set((state) => ({ rigHistory: Object.fromEntries(Object.entries(state.rigHistory).map(([rigId, entries]) => [rigId, entries.map((entry) => entry.id === entryId ? { ...entry, saved: !entry.saved } : entry)])) })),

  selectSetlist: (selectedSetlistId) => {
    set({ selectedSetlistId });
    if (!deviceApi.isNative() || !get().device) return;
    void deviceApi.getSetlist(selectedSetlistId).then((response) => {
      const detail = typeof response === "string" ? JSON.parse(response) as Record<string, unknown> : response as Record<string, unknown>;
      const rigIds = Array.isArray(detail?.rigs) ? detail.rigs.map(String) : [];
      const rigNames = Array.isArray(detail?.rig_names) ? detail.rig_names.map(String) : [];
      set((state) => ({ setlists: state.setlists.map((list) => list.id !== selectedSetlistId ? list : { ...list, items: rigIds.map((rigId, index) => ({ id: `${list.id}-${index}`, rigId, title: rigNames[index] ?? `Rig ${index + 1}` })) }) }));
    }).catch((error) => get().addDiagnostic({ level: "warning", source: "Setlists", message: "Could not load setlist", detail: deviceErrorDetail(error) }));
  },
  moveSetlistItem: (from, to) => set((s) => ({ setlists: s.setlists.map((list) => {
    if (list.id !== s.selectedSetlistId) return list;
    const items = [...list.items]; const [item] = items.splice(from, 1); items.splice(to, 0, item); return { ...list, items };
  }) })),
  saveSelectedSetlist: async () => {
    const list = get().setlists.find((item) => item.id === get().selectedSetlistId); if (!list) return;
    if (!deviceApi.isNative()) { get().addDiagnostic({ level: "success", source: "Setlists", message: `Saved ${list.name}` }); return; }
    await deviceApi.saveSetlist(list.id, list.name, list.items.map((item) => item.rigId).filter(Boolean));
    await get().refreshPage("setlists", "manual");
    get().addDiagnostic({ level: "success", source: "Setlists", message: `Saved ${list.name}` });
  },
  createSetlist: async (name) => {
    if (!deviceApi.isNative()) { const setlistId = id(); set((state) => ({ setlists: [...state.setlists, { id: setlistId, name: name.trim(), items: [] }], selectedSetlistId: setlistId })); return; }
    await deviceApi.saveSetlist("", name.trim(), []);
    await get().refreshFull("manual");
  },
  renameSetlist: async (setlistId, name) => {
    if (!deviceApi.isNative()) { set((state) => ({ setlists: state.setlists.map((list) => list.id === setlistId ? { ...list, name: name.trim() } : list) })); return; }
    await deviceApi.callMethod("/Evil/API/Setlists", "renameSetlist", [setlistId, name.trim()]);
    await get().refreshFull("manual");
  },
  deleteSetlist: async (setlistId) => {
    if (get().preferences.autoBackup) await get().createSnapshot("Before deleting a setlist");
    if (!deviceApi.isNative()) { set((state) => { const setlists = state.setlists.filter((list) => list.id !== setlistId); return { setlists, selectedSetlistId: state.selectedSetlistId === setlistId ? setlists[0]?.id ?? "" : state.selectedSetlistId }; }); return; }
    await deviceApi.callMethod("/Evil/API/Setlists", "deleteSetlist", [setlistId]);
    await get().refreshFull("manual");
  },
  addRigToSetlist: (rigId) => set((state) => ({ setlists: state.setlists.map((list) => list.id !== state.selectedSetlistId ? list : { ...list, items: [...list.items, { id: id(), rigId, title: state.rigs.find((rig) => rig.id === rigId)?.name ?? "Rig" }] }) })),
  removeSetlistItem: (itemId) => set((state) => ({ setlists: state.setlists.map((list) => list.id !== state.selectedSetlistId ? list : { ...list, items: list.items.filter((item) => item.id !== itemId) }) })),

  selectLiveStage: (stageId) => set((state) => {
    const stage = state.liveStages.find((candidate) => candidate.id === stageId);
    return stage ? { selectedLiveStageId: stage.id, liveLayout: stage.layout } : {};
  }),
  createLiveStage: (name) => set((state) => {
    const stageId = `stage-${id()}`;
    const source = activeLiveStage(state)?.layout ?? state.liveLayout;
    const layout = { ...structuredClone(source), locked: false, buttons: Array(source.buttons.length).fill(null) };
    const stage: LiveStage = { id: stageId, name: name?.trim() || `Stage ${state.liveStages.length + 1}`, layout };
    return { liveStages: [...state.liveStages, stage], selectedLiveStageId: stageId, liveLayout: layout };
  }),
  duplicateLiveStage: () => set((state) => {
    const source = activeLiveStage(state); if (!source) return {};
    const stageId = `stage-${id()}`;
    const layout = structuredClone(source.layout);
    const stage: LiveStage = { ...source, id: stageId, name: `${source.name} Copy`, rigId: undefined, layout };
    return { liveStages: [...state.liveStages, stage], selectedLiveStageId: stageId, liveLayout: layout };
  }),
  renameLiveStage: (name) => set((state) => ({ liveStages: state.liveStages.map((stage) => stage.id === state.selectedLiveStageId ? { ...stage, name: name.trim() || stage.name } : stage) })),
  deleteLiveStage: () => set((state) => {
    if (state.liveStages.length <= 1) return {};
    const liveStages = state.liveStages.filter((stage) => stage.id !== state.selectedLiveStageId);
    const stage = liveStages[0];
    return { liveStages, selectedLiveStageId: stage.id, liveLayout: stage.layout };
  }),
  attachLiveStageToRig: (rigId) => set((state) => ({ liveStages: state.liveStages.map((stage) => stage.id === state.selectedLiveStageId ? { ...stage, rigId: rigId || undefined } : rigId && stage.rigId === rigId ? { ...stage, rigId: undefined } : stage) })),
  setLiveDimensions: (rows, columns, firstRowColumns) => set((s) => activeLayoutPatch(s, resizeLiveLayout(s.liveLayout, rows, columns, firstRowColumns))),
  setLiveModel: (model) => {
    const firstRowColumns = DEVICE_FIRST_ROW_COLUMNS[model];
    set((s) => {
      const resized = resizeLiveLayout(s.liveLayout, s.liveLayout.rows, Math.max(s.liveLayout.columns, firstRowColumns), firstRowColumns);
      if (resized === s.liveLayout) return {};
      return activeLayoutPatch(s, { ...resized, model });
    });
  },
  setLiveSpacing: (spacing) => set((s) => activeLayoutPatch(s, { ...s.liveLayout, spacing: normalizeLiveStageSpacing({ ...s.liveLayout.spacing, ...spacing }) })),
  setLiveLocked: (locked) => set((s) => activeLayoutPatch(s, { ...s.liveLayout, locked })),
  moveLiveButton: (from, to) => set((s) => {
    if (from === to || from < 0 || to < 0 || from >= s.liveLayout.buttons.length || to >= s.liveLayout.buttons.length) return {};
    const buttons = [...s.liveLayout.buttons]; [buttons[from], buttons[to]] = [buttons[to], buttons[from]];
    return activeLayoutPatch(s, { ...s.liveLayout, buttons });
  }),
  addLiveButton: (button, index) => set((s) => {
    const buttons = [...s.liveLayout.buttons];
    const target = index ?? buttons.findIndex((candidate) => candidate === null);
    if (target < 0 || target >= buttons.length || buttons[target] !== null) return {};
    buttons[target] = button;
    return activeLayoutPatch(s, { ...s.liveLayout, buttons });
  }),
  removeLiveButton: (buttonId) => set((s) => activeLayoutPatch(s, { ...s.liveLayout, buttons: s.liveLayout.buttons.map((b) => b?.id === buttonId ? null : b) })),
  updateLiveButton: (buttonId, patch) => set((s) => activeLayoutPatch(s, { ...s.liveLayout, buttons: s.liveLayout.buttons.map((b) => b?.id === buttonId ? { ...b, ...patch } : b) })),
  toggleFavoriteLiveControl: (key) => set((state) => ({ favoriteLiveControlKeys: state.favoriteLiveControlKeys.includes(key) ? state.favoriteLiveControlKeys.filter((item) => item !== key) : [...state.favoriteLiveControlKeys, key] })),
  saveLiveControlPreset: (name, source) => set((state) => {
    const presetName = name.trim() || source.label || "User control";
    const { id: _buttonId, active: _active, ...button } = structuredClone(source);
    const existing = state.liveControlPresets.find((preset) => preset.name.localeCompare(presetName, undefined, { sensitivity: "accent" }) === 0);
    if (existing) return { liveControlPresets: state.liveControlPresets.map((preset) => preset.id === existing.id ? { ...preset, name: presetName, button } : preset) };
    return { liveControlPresets: [{ id: `control-${id()}`, name: presetName, createdAt: new Date().toISOString(), button }, ...state.liveControlPresets] };
  }),
  deleteLiveControlPreset: (presetId) => set((state) => ({
    liveControlPresets: state.liveControlPresets.filter((preset) => preset.id !== presetId),
    favoriteLiveControlKeys: state.favoriteLiveControlKeys.filter((key) => key !== `preset:${presetId}`),
  })),
  updateMidi: (buttonId, midi) => get().updateLiveButton(buttonId, { midi: normalizeLiveMidiCommand(midi) }),
  triggerLiveButton: async (buttonId, gesture = "release", targetOverride) => {
    const button = get().liveLayout.buttons.find((b) => b?.id === buttonId);
    if (!button) return false;
    const resolved = resolveLiveButtonGesture(button, gesture, targetOverride);
    if (!resolved) return false;
    const rig = get().liveSnapshot?.rig ?? currentRig(get());
    const tree = get().liveSubtree;
    const effectiveTarget = resolved.target;
    const deviceActive = resolved.action === "block-toggle" ? rig.blocks.find((block) => block.id === effectiveTarget)?.enabled
      : resolved.action === "tuner" && effectiveTarget === "mute" ? tree?.["/Evil/Engine/AudioCtrl/Tuner"]?.value?.TunerMuting === true
        : resolved.action === "tuner" ? tree?.["/Evil/Engine/AudioCtrl/Input"]?.value?.TunerOn === true
        : resolved.action === "drums" && effectiveTarget === "toggle" ? tree?.["/Evil/Engine/DrumsCtrl"]?.value?.isPlaying === true || tree?.["/Evil/Engine/DrumsCtrl"]?.value?.isPlaying === 1
          : button.active;
    const effective = { ...resolved, target: effectiveTarget, active: deviceActive };
    const previousActive = new Map(get().liveLayout.buttons.filter((candidate): candidate is LiveButton => Boolean(candidate)).map((candidate) => [candidate.id, candidate.active]));
    const rollbackButtonState = () => set((state) => activeLayoutPatch(state, { ...state.liveLayout, buttons: state.liveLayout.buttons.map((candidate) => candidate ? { ...candidate, active: previousActive.get(candidate.id) ?? candidate.active } : candidate) }));
    const switchType = button.switchType ?? "trigger";
    set((s) => activeLayoutPatch(s, { ...s.liveLayout, buttons: s.liveLayout.buttons.map((b) => {
      if (!b) return b;
      if (effective.action === "scene") return { ...b, active: b.action === "scene" && b.target === effective.target };
      if (b.id !== buttonId) return b;
      if (button.widget === "drums" && targetOverride && targetOverride !== "toggle") return b;
      if (switchType === "momentary") return { ...b, active: gesture !== "release" };
      if (switchType === "toggle" || effective.action === "tuner") return { ...b, active: !b.active };
      return b;
    }) }));
    try {
      if (effective.action === "block-toggle") {
        if (!effective.target) {
          rollbackButtonState();
          get().addDiagnostic({ level: "warning", source: "StageHand", message: `${effective.label} has no effect block assigned` });
          return false;
        }
        if (!await get().toggleBlock(effective.target)) { rollbackButtonState(); return false; }
      } else if (effective.action === "snapshot") {
        if (gesture !== "press") await get().createSnapshot(`StageHand · ${effective.label}`);
      } else if (effective.action === "rig-next" || effective.action === "rig-prev") {
        const list = get().setlists.find((item) => item.id === get().selectedSetlistId);
        const currentId = get().liveSnapshot?.rig.id ?? currentRig(get()).id;
        const currentIndex = list?.items.findIndex((item) => item.rigId === currentId) ?? -1;
        const offset = effective.action === "rig-next" ? 1 : -1;
        const target = list?.items[currentIndex + offset];
        if (!target?.rigId) throw new Error(effective.action === "rig-next" ? "There is no next rig in the active setlist." : "There is no previous rig in the active setlist.");
        await get().loadRig(target.rigId);
      } else if (["drums", "tuner", "scene", "tap-tempo"].includes(effective.action)) {
        await deviceApi.executeLiveAction(effective, gesture);
      } else {
        rollbackButtonState();
        get().addDiagnostic({ level: "warning", source: "StageHand", message: `${effective.label} is unavailable`, detail: "RushLink no longer sends MIDI commands to the HeadRush." });
        return false;
      }
      if (["drums", "tuner", "scene", "tap-tempo"].includes(effective.action)) {
        await get().refreshPage("live", "manual");
        // Reflected methods acknowledge before the audio engine publishes its next
        // property state. A trailing read prevents stale play/mute/tuner indicators.
        window.setTimeout(() => { void get().refreshPage("live", "manual"); }, 350);
      }
      return true;
    }
    catch (error) {
      rollbackButtonState();
      get().addDiagnostic({ level: "warning", source: "StageHand", message: `Could not trigger ${effective.label}`, detail: errorMessage(error) });
      return false;
    }
  },

  selectTone: (selectedToneId) => { toneModelRequestSerial++; set({ selectedToneId, selectedToneModelId: null, toneModelError: null, toneModelLoading: false, auditionError: null }); },
  loadToneModels: async (tone, force = false) => {
    if (tone.source !== "Tone3000" || typeof tone.remoteId !== "number" || (!force && get().toneModels[tone.id])) return;
    const requestSerial = ++toneModelRequestSerial;
    set({ toneModelLoading: true, toneModelError: null });
    try {
      const results = await Promise.all([deviceApi.fetchTone3000Models(tone.remoteId, 2), deviceApi.fetchTone3000Models(tone.remoteId, 1)]);
      if (requestSerial !== toneModelRequestSerial) return;
      const models = [...new Map([...mapTone3000Models(results[0], "A2"), ...mapTone3000Models(results[1], "A1")].map((model) => [model.id, model])).values()];
      set((state) => ({ toneModels: { ...state.toneModels, [tone.id]: models }, selectedToneModelId: models.some((model) => model.id === state.selectedToneModelId) ? state.selectedToneModelId : models[0]?.id ?? null, toneModelLoading: false, toneModelError: models.length ? null : "This Tone3000 group has no Flex Prime-compatible model." }));
    } catch (error) { if (requestSerial === toneModelRequestSerial) set({ toneModelLoading: false, toneModelError: deviceErrorMessage(error) }); }
  },
  toggleFavoriteTone: (toneId) => set((state) => ({ favoriteToneIds: state.favoriteToneIds.includes(toneId) ? state.favoriteToneIds.filter((id) => id !== toneId) : [...state.favoriteToneIds, toneId] })),
  toggleFavoriteBlock: (name) => set((state) => ({ favoriteBlockNames: state.favoriteBlockNames.includes(name) ? state.favoriteBlockNames.filter((item) => item !== name) : [...state.favoriteBlockNames, name] })),
  saveWorkflow: (workflow) => set((state) => ({ savedWorkflows: [...state.savedWorkflows.filter((item) => item.id !== workflow.id), structuredClone(workflow)].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)) })),
  deleteWorkflow: (workflowId) => set((state) => ({ savedWorkflows: state.savedWorkflows.filter((workflow) => workflow.id !== workflowId) })),
  selectToneModel: (selectedToneModelId) => set({ selectedToneModelId }),
  setCaptureOverride: (captureOverride) => set({ captureOverride }),
  selectTestRig: (selectedTestRigId) => {
    set((state) => state.testRigs.some((rig) => rig.id === selectedTestRigId) ? { selectedTestRigId } : {});
    scheduleTestRigSync(get, 120);
  },
  updateTestRigDetails: (patch) => set((state) => ({ testRigs: state.testRigs.map((rig) => rig.id !== state.selectedTestRigId ? rig : {
    ...rig,
    name: patch.name?.trim() || rig.name,
    description: patch.description?.trim() || rig.description,
  }) })),
  toggleTestRigBlock: (blockId) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => rig.id !== state.selectedTestRigId ? rig : {
      ...rig,
      blocks: rig.blocks.map((block) => block.id === blockId && block.name !== CAPTURE_SLOT_NAME ? { ...block, enabled: !block.enabled } : block),
    }) }));
    scheduleTestRigSync(get, 140);
  },
  updateTestRigBlock: (blockId, patch) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => rig.id !== state.selectedTestRigId ? rig : {
      ...rig,
      blocks: normalizeTestRigSlots(rig.blocks.map((block) => {
        if (block.id !== blockId) return block;
        if (block.name === CAPTURE_SLOT_NAME) {
          const merged = patch.parameters
            ? mergeTestRigParameters(block.parameters, patch.parameters).filter((parameter) => !isProtectedCaptureFileParameter(parameter))
            : block.parameters.filter((parameter) => !isProtectedCaptureFileParameter(parameter));
          return { ...block, sourcePath: patch.sourcePath ?? block.sourcePath, parameters: merged, enabled: true };
        }
        const updated = { ...block, ...patch, parameters: patch.parameters ? mergeTestRigParameters(block.parameters, patch.parameters) : block.parameters, id: block.id, slot: block.slot };
        return testRigSlotAllowsBlock(block.slot, updated) ? updated : block;
      })),
    }) }));
    scheduleTestRigSync(get);
  },
  updateTestRigParameter: (blockId, parameterId, value) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => rig.id !== state.selectedTestRigId ? rig : {
      ...rig,
      blocks: rig.blocks.map((block) => block.id !== blockId ? block : {
        ...block,
        parameters: block.parameters.map((parameter) => parameter.id === parameterId
          && parameter.writable !== false
          && !(block.name === CAPTURE_SLOT_NAME && isProtectedCaptureFileParameter(parameter))
          ? { ...parameter, value }
          : parameter),
      }),
    }) }));
    scheduleTestRigSync(get, 260);
  },
  addTestRigBlock: (block, targetSlot) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => rig.id !== state.selectedTestRigId ? rig : {
      ...rig,
      blocks: targetSlot === undefined ? addBlockToTestRig(rig.blocks, block) : placeTestRigBlock(rig.blocks, block, targetSlot),
    }) }));
    scheduleTestRigSync(get);
  },
  moveTestRigBlock: (blockId, targetSlot) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => {
      if (rig.id !== state.selectedTestRigId) return rig;
      const block = rig.blocks.find((item) => item.id === blockId);
      return block ? { ...rig, blocks: placeTestRigBlock(rig.blocks, block, targetSlot) } : rig;
    }) }));
    scheduleTestRigSync(get);
  },
  duplicateTestRigBlock: (blockId) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => rig.id !== state.selectedTestRigId ? rig : { ...rig, blocks: duplicateTestRigBlock(rig.blocks, blockId, `test-copy-${id()}`) }) }));
    scheduleTestRigSync(get);
  },
  removeTestRigBlock: (blockId) => {
    set((state) => ({ testRigs: state.testRigs.map((rig) => {
    if (rig.id !== state.selectedTestRigId) return rig;
    const block = rig.blocks.find((item) => item.id === blockId);
    if (!block || block.name === CAPTURE_SLOT_NAME || ["input", "output"].includes(block.category)) return rig;
    return { ...rig, blocks: rig.blocks.filter((item) => item.id !== blockId) };
    }) }));
    scheduleTestRigSync(get);
  },
  syncActiveTestRig: async () => {
    if (!deviceApi.isNative() || !get().auditioningToneId) return;
    if (testRigSyncPromise) { testRigSyncQueued = true; return testRigSyncPromise; }
    const run = async () => {
      const state = get();
      const repairedTestRigs = repairPersistedTestRigs(state.testRigs);
      set({ testRigs: repairedTestRigs });
      const storedAudition = state.testRigReturn?.audition;
      const tone = storedAudition?.tone.id === state.auditioningToneId
        ? storedAudition.tone
        : state.tones.find((item) => item.id === state.auditioningToneId);
      const rig = repairedTestRigs.find((item) => item.id === state.selectedTestRigId);
      const validation = rig ? validateTestRig(rig.blocks) : null;
      if (!tone) throw new Error("The active audition item is no longer available in the catalogue cache.");
      if (!rig || !validation?.valid) throw new Error(validation?.errors[0] ?? "The selected Test Rig is unavailable.");
      set({ testRigSyncBusy: true, testRigSyncError: null });
      try {
        const cachedModules = state.liveSubtree?.["/Evil/API/Blocks"]?.value?.ModuleTypes;
        const blockValues = Array.isArray(cachedModules) ? null : await deviceApi.properties("/Evil/API/Blocks");
        const moduleTypes = (Array.isArray(cachedModules) ? cachedModules : blockValues?.ModuleTypes) as unknown[] | undefined;
        if (!moduleTypes?.length) throw new Error("Flex Prime did not return its effect catalogue.");
        const currentModuleTypeIds = chainModuleTypeIds(await deviceApi.properties("/Evil/Engine/Patch/Chain"));
        const plan = buildTestRigDevicePlan({
          blocks: rig.blocks,
          captureType: effectiveCaptureType(tone, state.captureOverride),
          source: tone.source,
          remoteKind: tone.remoteKind,
          moduleTypes: moduleTypes.map(String),
          currentModuleTypeIds,
        });
        if (!plan.complete) throw new Error(plan.message);
        const captureFile = await applyAndVerifyTestRig(plan, currentModuleTypeIds, state.liveSubtree, storedAudition?.captureFile);
        const syncedAt = Date.now();
        set((latest) => ({
          testRigSyncBusy: false,
          testRigSyncError: null,
          testRigSyncedAt: syncedAt,
          testRigReturn: latest.testRigReturn ? {
            ...latest.testRigReturn,
            testRigApplied: plan.applied,
            testRigMessage: plan.message,
            audition: latest.testRigReturn.audition
              ? { ...latest.testRigReturn.audition, captureFile: captureFile ?? latest.testRigReturn.audition.captureFile }
              : { tone: structuredClone(tone), captureFile: captureFile ?? undefined },
          } : null,
        }));
        void get().refreshPage("tone-cloud", "manual");
      } catch (error) {
        const message = errorMessage(error);
        set({ testRigSyncBusy: false, testRigSyncError: message });
        get().addDiagnostic({ level: "error", source: "TonePilot", message: "Live Test Rig update failed", detail: message });
        throw error;
      }
    };
    testRigSyncPromise = run();
    try { await testRigSyncPromise; }
    finally {
      testRigSyncPromise = null;
      if (testRigSyncQueued) { testRigSyncQueued = false; scheduleTestRigSync(get, 40); }
    }
  },
  createTestRigSet: (name) => set((state) => { const testSet = { id: `test-set-${id()}`, name: name.trim() || "New Test Run", rigIds: [] }; return { testRigSets: [...state.testRigSets, testSet], selectedTestRigSetId: testSet.id }; }),
  renameTestRigSet: (name) => set((state) => ({ testRigSets: state.testRigSets.map((setlist) => setlist.id === state.selectedTestRigSetId ? { ...setlist, name: name.trim() || setlist.name } : setlist) })),
  deleteTestRigSet: () => set((state) => {
    if (state.testRigSets.length <= 1) return {};
    const testRigSets = state.testRigSets.filter((setlist) => setlist.id !== state.selectedTestRigSetId);
    return { testRigSets, selectedTestRigSetId: testRigSets[0].id };
  }),
  selectTestRigSet: (selectedTestRigSetId) => set((state) => state.testRigSets.some((setlist) => setlist.id === selectedTestRigSetId) ? { selectedTestRigSetId } : {}),
  addTestRigToSetlist: (rigId) => set((state) => !state.testRigs.some((rig) => rig.id === rigId) ? {} : ({ testRigSets: state.testRigSets.map((setlist) => setlist.id !== state.selectedTestRigSetId || setlist.rigIds.includes(rigId) ? setlist : { ...setlist, rigIds: [...setlist.rigIds, rigId] }) })),
  removeTestRigFromSetlist: (rigId) => set((state) => ({ testRigSets: state.testRigSets.map((setlist) => setlist.id !== state.selectedTestRigSetId ? setlist : { ...setlist, rigIds: setlist.rigIds.filter((id) => id !== rigId) }) })),
  moveTestRigInSetlist: (from, to) => set((state) => {
    const current = state.testRigSets.find((setlist) => setlist.id === state.selectedTestRigSetId); if (!current) return {};
    const next = [...current.rigIds];
    if (from < 0 || from >= next.length || to < 0 || to >= next.length) return {};
    const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    return { testRigSets: state.testRigSets.map((setlist) => setlist.id === current.id ? { ...setlist, rigIds: next } : setlist) };
  }),
  auditionTone: async (tone) => {
    const stateBeforeAudition = get();
    const provider = toneProviderReadiness({ native: deviceApi.isNative(), device: stateBeforeAudition.device, capabilities: stateBeforeAudition.capabilities, subtree: stateBeforeAudition.liveSubtree, source: tone.source, remoteId: tone.remoteId });
    if (!provider.ready) {
      const message = provider.reason ?? `${tone.source} is not ready.`;
      set({ auditionError: message });
      throw new Error(message);
    }
    const repairedTestRigs = repairPersistedTestRigs(stateBeforeAudition.testRigs);
    set({ testRigs: repairedTestRigs });
    const rig = repairedTestRigs.find((item) => item.id === stateBeforeAudition.selectedTestRigId);
    const validation = rig ? validateTestRig(rig.blocks) : null;

    let model: ToneModel | undefined;
    if (tone.source === "Tone3000") {
      if (!stateBeforeAudition.toneModels[tone.id]) await get().loadToneModels(tone);
      const models = get().toneModels[tone.id] ?? [];
      model = models.find((item) => item.id === get().selectedToneModelId) ?? models[0];
      if (!model) {
        const message = get().toneModelError ?? "Choose a compatible Tone3000 model before auditioning.";
        set({ auditionError: message });
        throw new Error(message);
      }
    }

    // Provider lists and selected-model state can change while the pedal is
    // building the Test Rig. Everything saved later must refer to this exact
    // audition, never whichever catalogue row happens to be selected then.
    const auditionTone = structuredClone(tone);
    const auditionModel = model ? structuredClone(model) : undefined;

    if (stateBeforeAudition.auditioningToneId) await get().stopAudition();
    const stateAfterStop = get();
    set({ auditionBusy: true, auditionError: null });
    let demoStarted = false;
    let recoveryTarget = stateAfterStop.testRigReturn;
    try {
      const loadedSummary = stateBeforeAudition.liveSnapshot?.rigLibrary.find((item) => item.loaded || item.id === stateBeforeAudition.liveSnapshot?.rig.id);
      let testRigReturn = stateAfterStop.testRigReturn;
      if (!testRigReturn) {
        const startingRig = stateBeforeAudition.liveSnapshot?.rig ?? currentRig(stateBeforeAudition);
        let snapshotId: string | undefined;
        if (stateBeforeAudition.liveSnapshot?.rig.modified === "Unsaved changes") {
          await get().createSnapshot(`TonePilot return · ${startingRig.name}`);
          snapshotId = get().snapshots[0]?.id;
        }
        testRigReturn = { id: startingRig.id, name: startingRig.name, srId: loadedSummary?.srId, snapshotId };
      }
      recoveryTarget = testRigReturn;
      const type = effectiveCaptureType(auditionTone, get().captureOverride);
      const planDetail = rig && validation?.valid ? `${rig.name} Test Rig` : "basic demo · Test Rig unavailable";
      get().addDiagnostic({ level: "info", source: "TonePilot", message: `Auditioning ${auditionTone.title}`, detail: `${type} · ${planDetail} · device temporary demo route` });
      await deviceApi.startToneDemo(auditionTone, auditionModel);
      demoStarted = true;

      let testRigApplied = false;
      let testRigMessage = rig && validation?.valid ? "The profile is active, but the Test Rig FX could not be applied." : "Profile-only audition; the selected Test Rig is unavailable or invalid.";
      let captureFile: TestRigCaptureFile | undefined;
      if (deviceApi.isNative() && rig && validation?.valid) {
        const reflectedSubtree = get().liveSubtree ?? stateBeforeAudition.liveSubtree;
        const cachedModules = reflectedSubtree?.["/Evil/API/Blocks"]?.value?.ModuleTypes;
        const blockValues = Array.isArray(cachedModules) ? null : await deviceApi.properties("/Evil/API/Blocks");
        const moduleTypes = (Array.isArray(cachedModules) ? cachedModules : blockValues?.ModuleTypes) as unknown[] | undefined;
        if (!moduleTypes?.length) throw new Error("Flex Prime did not return its effect catalogue, so the Test Rig cannot be built safely.");
        const { plan, currentModuleTypeIds } = await waitForTestRigPlan({
          rig,
          captureType: type,
          tone: auditionTone,
          moduleTypes: moduleTypes.map(String),
          previousModuleTypeIds: snapshotModuleTypeIds(stateBeforeAudition.liveSnapshot?.rig),
        });
        testRigApplied = plan.applied;
        testRigMessage = plan.message;

        if (plan.applied) {
          captureFile = await applyAndVerifyTestRig(plan, currentModuleTypeIds, reflectedSubtree) ?? undefined;
          if (captureFile) testRigMessage = `${plan.message} Loaded ${captureFile.value.split(/[\\/]/).at(-1)} in the ${plan.assignments.find((assignment) => assignment.capture)?.moduleName} host.`;
        } else if (!plan.complete) {
          throw new Error(plan.message);
        }
        get().addDiagnostic({ level: plan.applied ? "success" : "warning", source: "TonePilot", message: plan.applied ? `${rig.name} FX loaded on Flex Prime` : "Profile loaded without Test Rig FX", detail: plan.message });
      }
      set({
        auditioningToneId: auditionTone.id,
        auditionBusy: false,
        auditionError: null,
        testRigReturn: {
          ...testRigReturn,
          auditionSource: auditionTone.source,
          testRigApplied,
          testRigMessage,
          audition: { tone: auditionTone, model: auditionModel, captureFile },
        },
      });
      if (testRigApplied && deviceApi.isNative() && get().device) void get().refreshPage("tone-cloud", "manual");
    } catch (error) {
      const message = errorMessage(error);
      let recovered = !demoStarted;
      if (demoStarted) {
        try { await deviceApi.stopToneDemo(auditionTone.source); recovered = true; }
        catch (recoveryError) { get().addDiagnostic({ level: "error", source: "TonePilot", message: "Automatic audition rollback failed", detail: errorMessage(recoveryError) }); }
      }
      set({ auditionBusy: false, auditioningToneId: null, auditionError: message, testRigReturn: recovered ? stateAfterStop.testRigReturn : recoveryTarget ? { ...recoveryTarget, auditionSource: auditionTone.source } : null });
      get().addDiagnostic({ level: "error", source: "TonePilot", message: `Could not audition ${auditionTone.title}`, detail: message });
      throw error;
    }
  },
  stopAudition: async () => {
    const state = get();
    const tone = state.tones.find((item) => item.id === state.auditioningToneId);
    const source = state.testRigReturn?.audition?.tone.id === state.auditioningToneId
      ? state.testRigReturn.audition.tone.source
      : tone?.source ?? state.testRigReturn?.auditionSource;
    if (!state.auditioningToneId || !source) { set({ auditioningToneId: null, auditionBusy: false }); return; }
    set({ auditionBusy: true, auditionError: null });
    try {
      await deviceApi.stopToneDemo(source);
      set({ auditioningToneId: null, auditionBusy: false });
    } catch (error) {
      const message = errorMessage(error);
      set({ auditionBusy: false, auditionError: message });
      throw error;
    }
  },
  saveAuditionRig: async (options) => {
    const state = get();
    if (!deviceApi.isNative() || !state.device) throw new Error("Connect a HeadRush device before saving this audition.");
    if (!state.auditioningToneId) throw new Error("Start an audition before saving its Test Rig.");
    const activeAudition = state.testRigReturn?.audition;
    if (!activeAudition || activeAudition.tone.id !== state.auditioningToneId) {
      throw new Error("RushLink cannot prove which provider item and file created this audition. Restart the audition before saving.");
    }

    const name = sanitizeHeadRushRigName(options.name);
    if (!name) throw new Error("Enter a rig name.");
    const setlist = options.setlistId ? state.setlists.find((item) => item.id === options.setlistId) : undefined;
    if (options.setlistId && !setlist) throw new Error("The selected setlist is no longer available on the device.");

    if (!Number.isInteger(options.color) || options.color < 1 || options.color > 9) throw new Error("Choose a valid HeadRush rig colour.");
    if (options.tempoMode !== "current" && options.tempoMode !== "fixed") throw new Error("Choose a valid rig tempo source.");
    if (!Number.isFinite(options.tempoBpm) || options.tempoBpm < 30 || options.tempoBpm > 240) throw new Error("Rig tempo must be between 30 and 240 BPM.");
    if (!Number.isInteger(options.programChange) || options.programChange < -1 || options.programChange > 127) throw new Error("MIDI Program Change must be Off or a value from 1 to 128.");
    const color = options.color;
    const tempoBpm = options.tempoBpm;
    const programChange = options.programChange;
    set({ auditionBusy: true });

    let originalRigOptions: Record<string, unknown> | null = null;
    let originalPatchRig: Record<string, unknown> | null = null;
    let metadataChanged = false;
    let rigSaved = false;

    try {
      const rigsBefore = await deviceApi.properties("/Evil/API/Rigs");
      originalRigOptions = rigsBefore;
      const storedNames = Array.isArray(rigsBefore.AllRigNames) ? rigsBefore.AllRigNames.map(String) : state.rigs.map((rig) => rig.name);
      const existingName = storedNames.find((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existingName && !options.overwrite) throw new AuditionRigNameConflictError(existingName);
      if (!existingName && !(await deviceApi.canSaveNewRig())) throw new Error("The HeadRush rig library cannot accept another rig. Remove an unused rig or choose an existing name to replace.");

      const rawAvailablePrograms = rigsBefore.availableProgMIDICC;
      const programChangeSupported = Array.isArray(rawAvailablePrograms);
      const availablePrograms = Array.isArray(rawAvailablePrograms)
        ? rawAvailablePrograms.filter((value: unknown): value is number => typeof value === "number" && Number.isInteger(value))
        : [];
      if (programChange >= 0 && !programChangeSupported) {
        throw new Error("This HeadRush did not expose MIDI Program assignment for saved rigs. Choose Off to continue.");
      }
      if (programChange >= 0 && !availablePrograms.includes(programChange) && programChange !== Number(rigsBefore.loadedProgMIDICC)) {
        throw new Error(`MIDI Program ${programChange + 1} is already assigned to another rig.`);
      }

      await flushActiveTestRigSync(get);
      const syncedState = get();
      const syncedAudition = syncedState.testRigReturn?.audition;
      if (!syncedAudition || syncedAudition.tone.id !== syncedState.auditioningToneId || syncedAudition.tone.id !== activeAudition.tone.id) {
        throw new Error("The active audition changed while its Test Rig was being prepared. Nothing was saved; try again on the current tone.");
      }

      const durableCapture = await ensureDurableAuditionSource(syncedAudition, name);
      if (get().auditioningToneId !== syncedAudition.tone.id) {
        throw new Error("The active audition changed while its source was being prepared. Nothing was saved; try again on the current tone.");
      }
      if (durableCapture) {
        set((latest) => ({
          testRigReturn: latest.testRigReturn?.audition?.tone.id === syncedAudition.tone.id
            ? {
              ...latest.testRigReturn,
              audition: { ...latest.testRigReturn.audition, captureFile: durableCapture },
            }
            : latest.testRigReturn,
        }));
      }

      originalPatchRig = await deviceApi.properties("/Evil/Engine/Patch/Rig");
      const rigOptionsResponse = await deviceApi.setProperties("/Evil/API/Rigs", {
        loadedColor: color,
        ...(programChangeSupported ? { loadedProgMIDICC: programChange } : {}),
      });
      assertDeviceMutation(rigOptionsResponse.status, "Updating rig library options");
      metadataChanged = true;
      const tempoResponse = await deviceApi.setProperties("/Evil/Engine/Patch/Rig", {
        TempoFromMaster: options.tempoMode === "current",
        ...(options.tempoMode === "fixed" ? { Tempo: (tempoBpm - 30) / 210 } : {}),
      });
      assertDeviceMutation(tempoResponse.status, "Updating rig tempo");
      await deviceApi.saveRigAs(name);
      rigSaved = true;

      let savedRigId = "";
      let rigIdentityError: unknown;
      for (const delay of [0, 80, 160, 280]) {
        await auditionDelay(delay);
        try {
          const rigsAfter = await deviceApi.properties("/Evil/API/Rigs");
          const loadedName = typeof rigsAfter.loadedName === "string" ? rigsAfter.loadedName.trim() : "";
          const loadedId = typeof rigsAfter.loadedID === "string" ? rigsAfter.loadedID.trim() : "";
          if (loadedId && loadedName.toLocaleLowerCase() === name.toLocaleLowerCase()) savedRigId = loadedId;
          const names = Array.isArray(rigsAfter.AllRigNames) ? rigsAfter.AllRigNames.map(String) : [];
          const ids = Array.isArray(rigsAfter.AllRigIds) ? rigsAfter.AllRigIds.map(String) : [];
          const savedIndex = names.findIndex((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase());
          if (!savedRigId && savedIndex >= 0) savedRigId = ids[savedIndex] ?? "";
          if (savedRigId) break;
        } catch (error) {
          rigIdentityError = error;
        }
      }
      if (!savedRigId && rigIdentityError) get().addDiagnostic({ level: "warning", source: "TonePilot", message: `${name} was saved, but its new device ID could not be read`, detail: deviceErrorDetail(rigIdentityError) });

      let warning: string | undefined;
      let savedSetlistName: string | undefined;
      if (setlist) {
        if (!savedRigId) {
          warning = `“${name}” was saved to Rigs, but RushLink could not identify it for ${setlist.name}.`;
        } else {
          try {
            const detail = await deviceApi.getSetlist(setlist.id);
            const payload = appendRigToHeadRushSetlist(detail, setlist.id, setlist.name, savedRigId, name);
            await deviceApi.saveSetlistDocument(payload);
            savedSetlistName = payload.name;
          } catch (error) {
            warning = `“${name}” was saved to Rigs, but it could not be added to ${setlist.name}.`;
            get().addDiagnostic({ level: "warning", source: "TonePilot", message: warning, detail: deviceErrorDetail(error) });
          }
        }
      }

      try {
        await get().refreshFull("manual");
      } catch (refreshError) {
        const refreshWarning = `“${name}” was saved, but RushLink could not refresh the device library. The next successful device sync will show it.`;
        warning = warning ? `${warning} ${refreshWarning}` : refreshWarning;
        get().addDiagnostic({ level: "warning", source: "TonePilot", message: refreshWarning, detail: deviceErrorDetail(refreshError) });
      }
      set({ auditionBusy: false });
      get().addDiagnostic({
        level: warning ? "warning" : "success",
        source: "TonePilot",
        message: `Saved ${name} to Rigs`,
        detail: warning ?? (savedSetlistName ? `Also added to ${savedSetlistName}.` : "The active audition remains available for comparison."),
      });
      return { rigId: savedRigId, name, setlistName: savedSetlistName, warning };
    } catch (error) {
      if (metadataChanged && !rigSaved && originalRigOptions && originalPatchRig) {
        try {
          const rigRollback: Record<string, unknown> = {};
          if (typeof originalRigOptions.loadedColor === "number") rigRollback.loadedColor = originalRigOptions.loadedColor;
          if (Array.isArray(originalRigOptions.availableProgMIDICC) && typeof originalRigOptions.loadedProgMIDICC === "number") {
            rigRollback.loadedProgMIDICC = originalRigOptions.loadedProgMIDICC;
          }
          if (Object.keys(rigRollback).length) {
            const response = await deviceApi.setProperties("/Evil/API/Rigs", rigRollback);
            assertDeviceMutation(response.status, "Restoring rig library options");
          }

          const tempoRollback: Record<string, unknown> = {};
          if (typeof originalPatchRig.TempoFromMaster === "boolean") tempoRollback.TempoFromMaster = originalPatchRig.TempoFromMaster;
          if (typeof originalPatchRig.Tempo === "number") tempoRollback.Tempo = originalPatchRig.Tempo;
          if (Object.keys(tempoRollback).length) {
            const response = await deviceApi.setProperties("/Evil/Engine/Patch/Rig", tempoRollback);
            assertDeviceMutation(response.status, "Restoring rig tempo");
          }
        } catch (rollbackError) {
          get().addDiagnostic({ level: "error", source: "TonePilot", message: "Could not restore rig metadata after the failed save", detail: deviceErrorDetail(rollbackError) });
        }
      }
      set({ auditionBusy: false });
      get().addDiagnostic({ level: "error", source: "TonePilot", message: "Could not save the auditioned rig", detail: deviceErrorDetail(error) });
      throw error;
    }
  },
  finishToneTestSession: async () => {
    const original = get().testRigReturn;
    set({ auditionBusy: true, auditionError: null });
    try {
      if (get().auditioningToneId) await get().stopAudition();
      if (original) {
        if (original.snapshotId && get().snapshots.some((snapshot) => snapshot.id === original.snapshotId)) await get().restoreSnapshot(original.snapshotId);
        else {
          await deviceApi.callMethod("/Evil/API/Rigs", "loadRigConfirm", [original.id, original.srId ?? ""]);
          if (deviceApi.isNative() && get().device) await get().refreshFull("manual");
        }
        get().addDiagnostic({ level: "success", source: "TonePilot", message: `Returned to ${original.name}`, detail: original.snapshotId ? "Restored the exact unsaved pre-test state." : "TonePilot did not save or overwrite a device rig." });
      }
      set({ testRigReturn: null, auditioningToneId: null, auditionBusy: false });
    } catch (error) { set({ auditionBusy: false, auditionError: errorMessage(error) }); throw error; }
  },

  applyPending: async () => {
    const writes = [...get().pendingWrites];
    for (const write of writes) await deviceApi.setProperties(write.path, { [write.property]: write.value });
    set({ pendingWrites: [] });
    await get().refreshPage("editor", "manual");
    get().addDiagnostic({ level: "success", source: "Writes", message: `Applied ${writes.length} staged change${writes.length === 1 ? "" : "s"}` });
  },
  discardPending: () => { set({ pendingWrites: [] }); void get().refreshPage("editor", "manual"); },
  resolveFirstWrite: (writeMode) => set((s) => ({ preferences: { ...s.preferences, writeMode, firstWriteResolved: true } })),
  createSnapshot: async (name) => {
    const state = get();
    const restorablePaths = ["/Evil/Engine/Patch/Rig", "/Evil/Engine/Patch/Chain", "/Evil/Engine/Patch/Input", "/Evil/Engine/Patch/Output", "/Evil/Engine/Patch/Mix", "/Evil/Engine/FootSwitch", "/Evil/Engine/Pedal1", "/Evil/Engine/Pedal2", "/Evil/Engine/MIDIOutCtrl", "/Evil/Engine/DrumsCtrl", "/Evil/Engine/GlobalEQMain", "/Evil/Engine/GlobalEQAmp", "/Evil/Engine/Settings/Audio", "/Evil/Engine/Settings/General", "/Evil/Engine/Settings/Midi", "/Evil/Engine/Settings/ExpressionPedal"];
    const objects = Object.fromEntries(restorablePaths.flatMap((path) => {
      const object = state.liveSubtree?.[path]; if (!object?.value) return [];
      const properties = object.meta?.properties ?? {};
      const writable = Object.fromEntries(Object.entries(object.value).filter(([property]) => properties[property] && properties[property].readOnly !== true));
      return Object.keys(writable).length ? [[path, structuredClone(writable)]] : [];
    }));
    const payload = { version: 1 as const, capturedAt: new Date().toISOString(), objects, rigs: structuredClone(state.rigs), setlists: structuredClone(state.setlists) };
    const bytes = new Blob([JSON.stringify(payload)]).size;
    const snapshot: Snapshot = { id: id(), name: name || `Snapshot ${new Date().toLocaleDateString()}`, createdAt: `${new Date().toLocaleDateString()} · ${timestamp()}`, device: state.device?.name ?? "Offline", rigCount: state.rigs.length, setlistCount: state.setlists.length, size: bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`, payload };
    set((current) => ({ snapshots: [snapshot, ...current.snapshots] }));
    get().addDiagnostic({ level: "success", source: "Backup", message: `Captured ${snapshot.name}`, detail: `${Object.keys(objects).length} restorable device objects` });
  },
  restoreSnapshot: async (snapshotId) => {
    const snapshot = get().snapshots.find((item) => item.id === snapshotId); if (!snapshot?.payload) throw new Error("This older snapshot contains metadata only and cannot be restored.");
    if (get().preferences.autoBackup) await get().createSnapshot("Automatic pre-restore snapshot");
    for (const [path, properties] of Object.entries(snapshot.payload.objects)) await deviceApi.setProperties(path, properties);
    await get().refreshFull("manual");
    get().addDiagnostic({ level: "success", source: "Backup", message: `Restored ${snapshot.name}` });
  },
  deleteSnapshot: (snapshotId) => set((state) => ({ snapshots: state.snapshots.filter((item) => item.id !== snapshotId) })),
  importBackupArchive: (archive, restoreWorkspace = false) => {
    const before = get().snapshots.length;
    set((state) => {
      const snapshots = mergeSnapshots(state.snapshots, archive.snapshots);
      if (!restoreWorkspace) return { snapshots };
      const workspace = archive.workspace;
      const testRigs = repairPersistedTestRigs(migrateSeededTestRigSounds(workspace.testRigs?.length ? workspace.testRigs : state.testRigs));
      const testRigSets = workspace.testRigSets?.length ? workspace.testRigSets.filter((setlist) => setlist.rigIds.every((rigId) => testRigs.some((rig) => rig.id === rigId))) : state.testRigSets;
      const selectedTestRigSetId = testRigSets.some((setlist) => setlist.id === workspace.selectedTestRigSetId) ? workspace.selectedTestRigSetId! : testRigSets[0]?.id ?? state.selectedTestRigSetId;
      const liveStages = workspace.liveStages?.length ? workspace.liveStages : state.liveStages;
      const selectedLiveStageId = liveStages.some((stage) => stage.id === workspace.selectedLiveStageId) ? workspace.selectedLiveStageId! : liveStages[0]?.id ?? state.selectedLiveStageId;
      const liveLayout = liveStages.find((stage) => stage.id === selectedLiveStageId)?.layout ?? workspace.liveLayout ?? state.liveLayout;
      return {
        snapshots,
        favoriteRigIds: workspace.favoriteRigIds ?? state.favoriteRigIds,
        favoriteToneIds: workspace.favoriteToneIds ?? state.favoriteToneIds,
        favoriteBlockNames: workspace.favoriteBlockNames ?? state.favoriteBlockNames,
        liveLayout,
        liveStages,
        selectedLiveStageId,
        testRigs,
        testRigSets,
        selectedTestRigSetId,
        preferences: { ...state.preferences, ...(workspace.preferences as Partial<Preferences> | undefined) },
      };
    });
    const imported = Math.max(0, get().snapshots.length - before);
    get().addDiagnostic({ level: "success", source: "Backup", message: `Imported ${imported} new restore point${imported === 1 ? "" : "s"}`, detail: restoreWorkspace ? "Workspace preferences and layouts were also restored." : "Device state was not changed." });
    return imported;
  },
  clearDiagnostics: () => set({ diagnostics: [] }),
  addDiagnostic: (event) => set((s) => ({ diagnostics: [{ ...event, id: id(), time: timestamp() }, ...s.diagnostics].slice(0, 250) })),
}), {
  name: "rushlink-state-v1",
  storage: appPersistStorage,
  version: APP_STATE_VERSION,
  migrate: migratePersistedAppState,
  partialize: selectPersistedState,
  merge: mergePersistedAppState,
}));
