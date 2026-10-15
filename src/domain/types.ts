export type DeviceModel = "Prime" | "Prime Flex" | "Core";
export type ConnectionStatus = "offline" | "discovering" | "syncing" | "ready" | "error" | "demo";
export type WriteMode = "ask" | "immediate" | "staged";
export type CaptureType = "auto" | "amp" | "effect" | "amp+ir" | "ir" | "full-rig" | "unknown";
export type BlockCategory =
  | "input" | "output" | "vocal"
  | "amp" | "cab" | "ir" | "clone"
  | "overdrive" | "distortion" | "drive"
  | "eq" | "compressor"
  | "delay" | "reverb" | "chorus" | "phaser" | "vibrato" | "modulation"
  | "filter" | "pitch" | "dynamics" | "rhythmic" | "synth"
  | "utility" | "fx-loop";

export interface DeviceInfo {
  id: string;
  name: string;
  model: DeviceModel;
  host: string;
  firmware: string;
  productCode: string;
  status: ConnectionStatus;
  latencyMs: number;
  capabilities: string[];
}

export interface Parameter {
  id: string;
  label: string;
  value: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: string[];
  choiceValues?: Array<string | number | boolean>;
  writable?: boolean;
  sourceProperty?: string;
  normalized?: boolean;
  normalizeAlgo?: number;
  inverted?: boolean;
  rawValue?: number | string | boolean;
  deviceFile?: {
    fileType: number;
    startPath: string;
  };
  deviceObjectPath?: string;
}

export interface RigBlock {
  id: string;
  name: string;
  model: string;
  category: BlockCategory;
  color: string;
  enabled: boolean;
  slot: number;
  parameters: Parameter[];
  sourcePath?: string;
  moduleTypeId?: number;
  empty?: boolean;
  presetName?: string;
  canDouble?: boolean;
  doubled?: boolean;
}

export interface Rig {
  id: string;
  name: string;
  author: string;
  color: string;
  tags: string[];
  tempo: number;
  favorite: boolean;
  modified: string;
  blocks: RigBlock[];
}

export interface SetlistItem {
  id: string;
  rigId: string;
  title: string;
  notes?: string;
  /** Legacy RushLink-only metadata. Flex Prime setlist APIs do not read or write tuning. */
  tuning?: string;
}

export interface Setlist {
  id: string;
  name: string;
  items: SetlistItem[];
}

export type LiveActionType =
  | "rig-prev" | "rig-next" | "scene" | "block-toggle" | "tuner"
  | "tap-tempo" | "looper" | "drums" | "practice" | "expression" | "snapshot" | "custom";

export type LiveSwitchType = "trigger" | "toggle" | "momentary" | "hold" | "multi";
export type LiveGesture = "press" | "release" | "hold" | "double";
export type LiveDeckLayout = "1x4" | "2x3" | "1x3" | "2x2";
export type LiveDeckFootprint = "1x1" | "1x2" | "1x3" | "1x4" | "2x2" | "2x3";

export interface LiveActionBinding {
  action: LiveActionType;
  target?: string;
  label?: string;
}

export interface MidiCommand {
  type: "cc" | "pc" | "note";
  channel: number;
  number: number;
  value: number;
  releaseValue?: number;
}

export interface LiveButton {
  id: string;
  label: string;
  subtitle: string;
  action: LiveActionType;
  color: string;
  accentColor?: string;
  icon: string;
  active?: boolean;
  target?: string;
  switchType?: LiveSwitchType;
  holdMs?: number;
  multiFunction?: boolean;
  tapBinding?: LiveActionBinding;
  holdBinding?: LiveActionBinding;
  doubleBinding?: LiveActionBinding;
  widget?: "tuner" | "practice" | "looper" | "drums";
  widgetLayout?: LiveDeckLayout;
  widgetActions?: string[];
  widgetSize?: LiveDeckFootprint;
  width?: 1 | 2;
  midi: MidiCommand;
}

export interface LiveControlPreset {
  id: string;
  name: string;
  createdAt: string;
  button: Omit<LiveButton, "id">;
}

export interface LiveStageSpacing {
  columnGap: number;
  rowGap: number;
  insetTop: number;
  insetRight: number;
  insetBottom: number;
  insetLeft: number;
}

export interface LiveLayout {
  model: DeviceModel;
  rows: number;
  columns: number;
  firstRowColumns: number;
  buttons: Array<LiveButton | null>;
  locked: boolean;
  spacing?: LiveStageSpacing;
}

export interface LiveStage {
  id: string;
  name: string;
  rigId?: string;
  layout: LiveLayout;
}

export interface CloudTone {
  id: string;
  title: string;
  author: string;
  description: string;
  captureType: Exclude<CaptureType, "auto">;
  detectedType: Exclude<CaptureType, "auto">;
  tags: string[];
  rating: number;
  downloads: number;
  source: "Tone3000" | "HeadRush Cloud";
  imageColor: string;
  downloaded?: boolean;
  remoteId?: string | number;
  remoteKind?: "rig" | "clone" | "tone-group";
  imageUrl?: string;
  gear?: string;
  createdAt?: string;
  updatedAt?: string;
  modelCount?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ToneModel {
  id: string;
  remoteId: number;
  name: string;
  architecture: string;
  url: string;
  description?: string;
  gear?: string;
  sizeBytes?: number;
  createdAt?: string;
  calibrated?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export type NamPreference = "auto" | "nam2" | "nam2-lite" | "other";

export interface TestRigTemplate {
  id: string;
  name: string;
  description: string;
  blocks: RigBlock[];
  /** Architecture/runtime priority for the provider's auditioned capture. */
  namPreference?: NamPreference;
  /** Model ID, name or architecture selected when namPreference is other. */
  namOtherModel?: string;
  /** One-based reflected NAM DSP host, independent of its chain position. */
  namInstance?: number;
  /** Zero-based audition host position. Older templates use slot 6. */
  captureSlot?: number;
}

export interface PendingWrite {
  id: string;
  path: string;
  property: string;
  previous: unknown;
  value: unknown;
  createdAt: string;
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  device: string;
  rigCount: number;
  setlistCount: number;
  size: string;
  payload?: {
    version: 1;
    capturedAt: string;
    objects: Record<string, Record<string, unknown>>;
    rigs: Rig[];
    setlists: Setlist[];
  };
}

export interface DiagnosticEvent {
  id: string;
  time: string;
  level: "info" | "success" | "warning" | "error";
  source: string;
  message: string;
  detail?: string;
}

export interface DeviceCapabilities {
  product: string;
  firmware: string;
  objectCount: number;
  propertyCount: number;
  methodCount: number;
  flags: Record<string, boolean>;
  rawObjects: string[];
}

export interface HeadRushPropertyMeta {
  type?: string;
  minimum?: number;
  maximum?: number;
  readOnly?: boolean;
  "x-options"?: {
    default?: unknown;
    format?: string;
    grid?: number;
    normalizeAlgo?: number;
    strings?: string[];
    fileType?: number;
    startPath?: string;
  };
}

export interface HeadRushObject {
  meta?: { properties?: Record<string, HeadRushPropertyMeta>; "x-methods"?: Record<string, unknown> };
  value?: Record<string, unknown>;
}

export type HeadRushSubtree = Record<string, HeadRushObject>;

export interface LiveFootswitch {
  number: number;
  label: string;
  module: string;
  operation: string;
  enabled: boolean;
  mode: "toggle" | "hold" | "scene" | "unknown";
  color: string;
  sceneActive: boolean;
}

export interface LiveSetlistSummary {
  id: string;
  name: string;
  count: number;
  loaded: boolean;
}

export interface LiveRigSummary {
  id: string;
  srId?: string;
  name: string;
  color: string;
  loaded: boolean;
}

export interface RigHistoryEntry {
  id: string;
  rigId: string;
  createdAt: string;
  description: string;
  before: Rig;
  after: Rig;
  saved: boolean;
}

export interface LiveDeviceSnapshot {
  syncedAt: string;
  objectCount: number;
  deviceName: string;
  firmware: string;
  rig: Rig;
  routing: { id: number; label: string; stereo: boolean; tails: boolean; locked: boolean };
  rigLibrary: LiveRigSummary[];
  setlists: LiveSetlistSummary[];
  loadedSetlistId: string;
  loadedSetlistName: string;
  footswitches: LiveFootswitch[];
  currentScene: number;
  drums: { playing: boolean; muted: boolean; kit: string; style: string };
  storage: { usedPercent: number; usedLabel: string; capacityLabel: string };
  cpuPercent: number;
  cloud: { loggedIn: boolean; loading: boolean; demo: string };
  tone3000: { loggedIn: boolean; searching: boolean };
  settings: {
    audio: Record<string, unknown>;
    general: Record<string, unknown>;
    midi: Record<string, unknown>;
    expression: Record<string, unknown>;
    pedal1: Record<string, unknown>;
    pedal2: Record<string, unknown>;
  };
}
