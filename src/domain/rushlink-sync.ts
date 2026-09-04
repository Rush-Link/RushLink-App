import { flexPrimeMidiCommand } from "./headrush-midi";
import type { LiveButton, LiveControlPreset, LiveLayout, LiveStage, MidiCommand, TestRigTemplate } from "./types";

export const RUSHLINK_SYNC_SCHEMA_VERSION = 1 as const;
export const RUSHLINK_SYNC_SECTION_NAMES = ["stageHand", "midiMappings", "testRigs", "favourites", "interfacePreferences", "savedWorkflows"] as const;
export type RushLinkSyncSectionName = typeof RUSHLINK_SYNC_SECTION_NAMES[number];

export interface SavedWorkflowStep {
  id: string;
  kind: string;
  label: string;
  parameters: Record<string, string | number | boolean>;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  updatedAt: string;
  steps: SavedWorkflowStep[];
}

export type SyncLiveButton = Omit<LiveButton, "midi">;
export interface SyncLiveLayout extends Omit<LiveLayout, "buttons"> { buttons: Array<SyncLiveButton | null> }
export interface SyncLiveStage extends Omit<LiveStage, "layout"> { layout: SyncLiveLayout }

export interface StageHandSyncData {
  stages: SyncLiveStage[];
  selectedStageId: string;
  controlPresets?: LiveControlPreset[];
}

export interface MidiMappingsSyncData {
  stages: Record<string, Record<string, MidiCommand>>;
}

export interface TestRigsSyncData {
  templates: TestRigTemplate[];
  selectedTemplateId: string;
  sets: Array<{ id: string; name: string; rigIds: string[] }>;
  selectedSetId: string;
}

export interface FavouritesSyncData {
  rigIds: string[];
  toneIds: string[];
  blockNames: string[];
  liveControlKeys?: string[];
}

export interface InterfacePreferencesSyncData {
  density: "comfortable" | "compact" | "stage";
  reduceMotion: boolean;
  highContrast: boolean;
  keepAwake: boolean;
  sidebarCollapsed: boolean;
}

export interface RushLinkSyncSectionValues {
  stageHand: StageHandSyncData;
  midiMappings: MidiMappingsSyncData;
  testRigs: TestRigsSyncData;
  favourites: FavouritesSyncData;
  interfacePreferences: InterfacePreferencesSyncData;
  savedWorkflows: SavedWorkflow[];
}

export interface RushLinkSyncSection<T> {
  updatedAt: string;
  updatedBy: string;
  data: T;
}

export type RushLinkSyncSections = { [K in RushLinkSyncSectionName]: RushLinkSyncSection<RushLinkSyncSectionValues[K]> };

export interface RushLinkSyncDocument {
  format: "rushlink-sync";
  schemaVersion: typeof RUSHLINK_SYNC_SCHEMA_VERSION;
  accountId: string;
  revision: number;
  baseRevision: number;
  updatedAt: string;
  sections: RushLinkSyncSections;
}

export interface RushLinkSyncSource {
  liveStages: LiveStage[];
  selectedLiveStageId: string;
  testRigs: TestRigTemplate[];
  selectedTestRigId: string;
  testRigSets: Array<{ id: string; name: string; rigIds: string[] }>;
  selectedTestRigSetId: string;
  favoriteRigIds: string[];
  favoriteToneIds: string[];
  favoriteBlockNames: string[];
  favoriteLiveControlKeys?: string[];
  liveControlPresets?: LiveControlPreset[];
  preferences: Pick<InterfacePreferencesSyncData, "density" | "reduceMotion" | "highContrast" | "keepAwake">;
  sidebarCollapsed: boolean;
  savedWorkflows?: SavedWorkflow[];
}

export interface RushLinkPortablePatch {
  liveStages: LiveStage[];
  selectedLiveStageId: string;
  liveLayout: LiveLayout;
  testRigs: TestRigTemplate[];
  selectedTestRigId: string;
  testRigSets: Array<{ id: string; name: string; rigIds: string[] }>;
  selectedTestRigSetId: string;
  favoriteRigIds: string[];
  favoriteToneIds: string[];
  favoriteBlockNames: string[];
  favoriteLiveControlKeys: string[];
  liveControlPresets: LiveControlPreset[];
  preferences: InterfacePreferencesSyncData;
  sidebarCollapsed: boolean;
  savedWorkflows: SavedWorkflow[];
}

export interface RushLinkSyncConflict {
  section: RushLinkSyncSectionName;
  winner: "local" | "remote";
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

const clone = <T,>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const validDate = (value: string) => Number.isFinite(Date.parse(value));

function withoutMidi(layout: LiveLayout): SyncLiveLayout {
  return { ...layout, buttons: layout.buttons.map((button) => {
    if (!button) return null;
    const { midi: _midi, ...portable } = button;
    return portable;
  }) };
}

function portableValues(source: RushLinkSyncSource): RushLinkSyncSectionValues {
  return {
    stageHand: {
      stages: source.liveStages.map((stage) => ({ ...stage, layout: withoutMidi(stage.layout) })),
      selectedStageId: source.selectedLiveStageId,
      controlPresets: clone(source.liveControlPresets ?? []),
    },
    midiMappings: {
      stages: Object.fromEntries(source.liveStages.map((stage) => [stage.id, Object.fromEntries(stage.layout.buttons.flatMap((button) => button ? [[button.id, clone(button.midi)]] : []))])),
    },
    testRigs: {
      templates: clone(source.testRigs), selectedTemplateId: source.selectedTestRigId,
      sets: clone(source.testRigSets), selectedSetId: source.selectedTestRigSetId,
    },
    favourites: { rigIds: [...source.favoriteRigIds], toneIds: [...source.favoriteToneIds], blockNames: [...source.favoriteBlockNames], liveControlKeys: [...(source.favoriteLiveControlKeys ?? [])] },
    interfacePreferences: {
      density: source.preferences.density, reduceMotion: source.preferences.reduceMotion,
      highContrast: source.preferences.highContrast, keepAwake: source.preferences.keepAwake,
      sidebarCollapsed: source.sidebarCollapsed,
    },
    savedWorkflows: clone(source.savedWorkflows ?? []),
  };
}

export function createRushLinkSyncDocument(source: RushLinkSyncSource, options: { accountId: string; clientId: string; previous?: RushLinkSyncDocument | null; now?: string }): RushLinkSyncDocument {
  const now = options.now ?? new Date().toISOString();
  const previous = options.previous?.accountId === options.accountId ? options.previous : null;
  const values = portableValues(source);
  let changed = !previous;
  const sections = Object.fromEntries(RUSHLINK_SYNC_SECTION_NAMES.map((name) => {
    const prior = previous?.sections[name];
    if (prior && same(prior.data, values[name])) return [name, clone(prior)];
    changed = true;
    return [name, { updatedAt: now, updatedBy: options.clientId, data: clone(values[name]) }];
  })) as RushLinkSyncSections;
  if (previous && !changed) return clone(previous);
  return {
    format: "rushlink-sync", schemaVersion: RUSHLINK_SYNC_SCHEMA_VERSION, accountId: options.accountId,
    revision: (previous?.revision ?? 0) + 1, baseRevision: previous?.revision ?? 0, updatedAt: now, sections,
  };
}

function sectionWinner<K extends RushLinkSyncSectionName>(local: RushLinkSyncSections[K], remote: RushLinkSyncSections[K]) {
  const localTime = Date.parse(local.updatedAt); const remoteTime = Date.parse(remote.updatedAt);
  if (localTime !== remoteTime) return localTime > remoteTime ? "local" as const : "remote" as const;
  if (local.updatedBy !== remote.updatedBy) return local.updatedBy > remote.updatedBy ? "local" as const : "remote" as const;
  return JSON.stringify(local.data) >= JSON.stringify(remote.data) ? "local" as const : "remote" as const;
}

export function mergeRushLinkSyncDocuments(local: RushLinkSyncDocument, remote: RushLinkSyncDocument, base?: RushLinkSyncDocument | null, now = new Date().toISOString()) {
  if (local.accountId !== remote.accountId) throw new Error("RushLink Sync documents belong to different accounts.");
  const conflicts: RushLinkSyncConflict[] = [];
  const sections = Object.fromEntries(RUSHLINK_SYNC_SECTION_NAMES.map((name) => {
    const localSection = local.sections[name]; const remoteSection = remote.sections[name]; const baseSection = base?.accountId === local.accountId ? base.sections[name] : undefined;
    if (same(localSection.data, remoteSection.data)) return [name, clone(sectionWinner(localSection, remoteSection) === "local" ? localSection : remoteSection)];
    const localChanged = !baseSection || !same(localSection.data, baseSection.data);
    const remoteChanged = !baseSection || !same(remoteSection.data, baseSection.data);
    if (baseSection && localChanged !== remoteChanged) return [name, clone(localChanged ? localSection : remoteSection)];
    const winner = sectionWinner(localSection, remoteSection);
    if (localChanged && remoteChanged) conflicts.push({ section: name, winner, localUpdatedAt: localSection.updatedAt, remoteUpdatedAt: remoteSection.updatedAt });
    return [name, clone(winner === "local" ? localSection : remoteSection)];
  })) as RushLinkSyncSections;
  const changedSections = RUSHLINK_SYNC_SECTION_NAMES.filter((name) => !same(sections[name].data, remote.sections[name].data));
  const unchangedFromRemote = changedSections.length === 0;
  const document: RushLinkSyncDocument = unchangedFromRemote ? clone(remote) : {
    format: "rushlink-sync", schemaVersion: RUSHLINK_SYNC_SCHEMA_VERSION, accountId: remote.accountId,
    revision: Math.max(local.revision, remote.revision) + 1, baseRevision: remote.revision, updatedAt: now, sections,
  };
  return { document, conflicts, changedSections, expectedRevision: remote.revision };
}

function materializeStages(stageHand: StageHandSyncData, mappings: MidiMappingsSyncData, current: LiveStage[]): LiveStage[] {
  return stageHand.stages.map((stage) => ({ ...stage, layout: { ...stage.layout, buttons: stage.layout.buttons.map((button) => {
    if (!button) return null;
    const existing = current.find((candidate) => candidate.id === stage.id)?.layout.buttons.find((candidate) => candidate?.id === button.id);
    const midi = mappings.stages[stage.id]?.[button.id] ?? existing?.midi ?? flexPrimeMidiCommand(button.action, button.target);
    return { ...button, midi: clone(midi) };
  }) } }));
}

export function portablePatchFromSyncDocument(document: RushLinkSyncDocument, currentStages: LiveStage[]): RushLinkPortablePatch {
  const stages = materializeStages(document.sections.stageHand.data, document.sections.midiMappings.data, currentStages);
  if (!stages.length) throw new Error("RushLink Sync document contains no StageHand stages.");
  const requestedStage = document.sections.stageHand.data.selectedStageId;
  const selectedLiveStageId = stages.some((stage) => stage.id === requestedStage) ? requestedStage : stages[0].id;
  const testRigs = clone(document.sections.testRigs.data.templates);
  const requestedTestRig = document.sections.testRigs.data.selectedTemplateId;
  const selectedTestRigId = testRigs.some((rig) => rig.id === requestedTestRig) ? requestedTestRig : testRigs[0]?.id ?? "";
  const testRigSets = clone(document.sections.testRigs.data.sets).map((set) => ({ ...set, rigIds: set.rigIds.filter((id) => testRigs.some((rig) => rig.id === id)) }));
  const requestedSet = document.sections.testRigs.data.selectedSetId;
  const selectedTestRigSetId = testRigSets.some((set) => set.id === requestedSet) ? requestedSet : testRigSets[0]?.id ?? "";
  return {
    liveStages: stages, selectedLiveStageId, liveLayout: stages.find((stage) => stage.id === selectedLiveStageId)!.layout,
    testRigs, selectedTestRigId, testRigSets, selectedTestRigSetId,
    favoriteRigIds: [...document.sections.favourites.data.rigIds], favoriteToneIds: [...document.sections.favourites.data.toneIds], favoriteBlockNames: [...document.sections.favourites.data.blockNames],
    favoriteLiveControlKeys: [...(document.sections.favourites.data.liveControlKeys ?? [])], liveControlPresets: clone(document.sections.stageHand.data.controlPresets ?? []),
    preferences: clone(document.sections.interfacePreferences.data), sidebarCollapsed: document.sections.interfacePreferences.data.sidebarCollapsed,
    savedWorkflows: clone(document.sections.savedWorkflows.data),
  };
}

export function assertRushLinkSyncDocument(value: unknown): asserts value is RushLinkSyncDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid RushLink Sync document.");
  const document = value as Partial<RushLinkSyncDocument>;
  if (document.format !== "rushlink-sync" || document.schemaVersion !== RUSHLINK_SYNC_SCHEMA_VERSION || typeof document.accountId !== "string" || !Number.isInteger(document.revision) || !Number.isInteger(document.baseRevision) || typeof document.updatedAt !== "string" || !validDate(document.updatedAt) || !document.sections) throw new Error("Unsupported RushLink Sync document.");
  for (const name of RUSHLINK_SYNC_SECTION_NAMES) {
    const section = document.sections[name];
    if (!section || typeof section.updatedAt !== "string" || !validDate(section.updatedAt) || typeof section.updatedBy !== "string" || section.data === undefined) throw new Error(`Invalid RushLink Sync section: ${name}.`);
  }
}
