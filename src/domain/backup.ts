import type { LiveLayout, LiveStage, Rig, Setlist, Snapshot, TestRigTemplate } from "./types";

export interface ArchivedTestSet { id: string; name: string; rigIds: string[] }
export interface RushLinkWorkspaceData {
  favoriteRigIds?: string[];
  favoriteToneIds?: string[];
  favoriteBlockNames?: string[];
  liveLayout?: LiveLayout;
  liveStages?: LiveStage[];
  selectedLiveStageId?: string;
  testRigs?: TestRigTemplate[];
  testRigSets?: ArchivedTestSet[];
  selectedTestRigSetId?: string;
  preferences?: object;
}

export interface RushLinkArchive {
  format: "rushlink-archive";
  version: 2;
  createdAt: string;
  appVersion: string;
  device?: { name: string; model: string; firmware: string; host: string };
  snapshots: Snapshot[];
  workspace: RushLinkWorkspaceData;
  deviceIndex: { rigs: Rig[]; setlists: Setlist[] };
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function validSnapshot(value: unknown): value is Snapshot {
  if (!record(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.createdAt !== "string") return false;
  if (value.payload === undefined) return true;
  return record(value.payload) && value.payload.version === 1 && typeof value.payload.capturedAt === "string" && record(value.payload.objects) && Array.isArray(value.payload.rigs) && Array.isArray(value.payload.setlists);
}

function cleanWorkspace(value: unknown): RushLinkWorkspaceData {
  if (!record(value)) return {};
  const result: RushLinkWorkspaceData = {};
  if (strings(value.favoriteRigIds)) result.favoriteRigIds = value.favoriteRigIds;
  if (strings(value.favoriteToneIds)) result.favoriteToneIds = value.favoriteToneIds;
  if (strings(value.favoriteBlockNames)) result.favoriteBlockNames = value.favoriteBlockNames;
  if (record(value.liveLayout) && Array.isArray(value.liveLayout.buttons)) result.liveLayout = value.liveLayout as unknown as LiveLayout;
  if (Array.isArray(value.liveStages)) result.liveStages = value.liveStages.filter((stage): stage is LiveStage => record(stage) && typeof stage.id === "string" && typeof stage.name === "string" && record(stage.layout) && Array.isArray(stage.layout.buttons)) as LiveStage[];
  if (typeof value.selectedLiveStageId === "string") result.selectedLiveStageId = value.selectedLiveStageId;
  if (Array.isArray(value.testRigs)) result.testRigs = value.testRigs as TestRigTemplate[];
  if (Array.isArray(value.testRigSets)) result.testRigSets = value.testRigSets.filter((item): item is ArchivedTestSet => record(item) && typeof item.id === "string" && typeof item.name === "string" && strings(item.rigIds));
  if (typeof value.selectedTestRigSetId === "string") result.selectedTestRigSetId = value.selectedTestRigSetId;
  if (record(value.preferences)) result.preferences = value.preferences;
  return result;
}

export function createRushLinkArchive(input: Omit<RushLinkArchive, "format" | "version" | "createdAt" | "appVersion">): RushLinkArchive {
  return { format: "rushlink-archive", version: 2, createdAt: new Date().toISOString(), appVersion: "0.1.0", ...structuredClone(input) };
}

export function parseRushLinkArchive(value: unknown): RushLinkArchive {
  if (!record(value)) throw new Error("This is not a RushLink JSON archive.");
  if (value.format === "rushlink-archive" && value.version === 2) {
    const snapshots = Array.isArray(value.snapshots) ? value.snapshots.filter(validSnapshot) : [];
    const deviceIndex = record(value.deviceIndex) ? value.deviceIndex : {};
    return {
      format: "rushlink-archive", version: 2,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      appVersion: typeof value.appVersion === "string" ? value.appVersion : "unknown",
      device: record(value.device) && typeof value.device.name === "string" ? value.device as RushLinkArchive["device"] : undefined,
      snapshots,
      workspace: cleanWorkspace(value.workspace),
      deviceIndex: {
        rigs: Array.isArray(deviceIndex.rigs) ? deviceIndex.rigs as Rig[] : [],
        setlists: Array.isArray(deviceIndex.setlists) ? deviceIndex.setlists as Setlist[] : [],
      },
    };
  }
  // Archives exported by the earlier Library page.
  if (value.version === 1 && Array.isArray(value.snapshots)) return createRushLinkArchive({ snapshots: value.snapshots.filter(validSnapshot), workspace: {}, deviceIndex: { rigs: Array.isArray(value.rigs) ? value.rigs as Rig[] : [], setlists: Array.isArray(value.setlists) ? value.setlists as Setlist[] : [] } });
  if (validSnapshot(value)) return createRushLinkArchive({ snapshots: [value], workspace: {}, deviceIndex: { rigs: [], setlists: [] } });
  throw new Error("The JSON file has no supported RushLink archive or snapshot payload.");
}

export function mergeSnapshots(current: Snapshot[], imported: Snapshot[]): Snapshot[] {
  const rows = new Map(current.map((snapshot) => [snapshot.id, snapshot]));
  for (const snapshot of imported) rows.set(snapshot.id, snapshot);
  return [...rows.values()].sort((left, right) => Date.parse(right.payload?.capturedAt ?? right.createdAt) - Date.parse(left.payload?.capturedAt ?? left.createdAt));
}

export const archiveSizeLabel = (value: unknown) => {
  const bytes = new Blob([JSON.stringify(value)]).size;
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
