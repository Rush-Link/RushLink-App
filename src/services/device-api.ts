import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CloudTone, DeviceCapabilities, DeviceInfo, LiveButton, LiveGesture, ToneModel } from "../domain/types";
import { demoCapabilities, demoDevice } from "../data/demo-data";
import { drumMethodForTarget, tunerPropertyForTarget } from "../domain/stage-actions";
import { invalidDeviceResponse, normalizeDeviceError } from "./device-errors";

export interface Tone3000SearchFilters {
  architecture: 1 | 2;
  calibrated: boolean;
  gear: string[];
  sizes: string[];
  format: string;
  tags: string[];
  makes: string[];
  creators: string[];
  verified: boolean;
  sortMode: 0 | 1 | 2 | 3;
}

export const DEFAULT_TONE3000_FILTERS: Tone3000SearchFilters = {
  architecture: 2,
  calibrated: false,
  gear: [],
  sizes: [],
  format: "",
  tags: [],
  makes: [],
  creators: [],
  verified: false,
  sortMode: 0,
};

export interface ConnectResult {
  device: DeviceInfo;
  capabilities: DeviceCapabilities;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export type DeviceFileKind = "folders" | "all" | "ir" | "audio" | "rig" | "setlist" | "preset" | "amp-clone" | "superclone" | "nam" | "clone" | "reverb" | "midi-preset";
export interface DeviceFileEntry { name: string; type: "folder" | "file" }
export interface DeviceDirectoryListing { path: string; folders: DeviceFileEntry[]; files: DeviceFileEntry[]; entries: DeviceFileEntry[] }
const DEVICE_FILE_KIND: Record<DeviceFileKind, number> = {
  folders: 0, all: 1, ir: 2, audio: 3, rig: 4, setlist: 5, preset: 6,
  "amp-clone": 7, superclone: 8, nam: 9, clone: 10, reverb: 12,
  "midi-preset": 13,
};

export function normalizeDeviceFilePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    const clean = segment.trim();
    if (!clean || clean === ".") continue;
    if (clean === "..") { segments.pop(); continue; }
    segments.push(clean);
  }
  return segments.join("/");
}

export function tone3000ModelFilename(model: { remoteId: number; name: string; url: string; metadata?: Record<string, string | number | boolean> }): string {
  const explicit = [model.metadata?.filename, model.metadata?.file_name, model.metadata?.fileName].find((value) => typeof value === "string" && value.trim());
  let urlName = "";
  try { urlName = decodeURIComponent(new URL(model.url).pathname.split("/").filter(Boolean).at(-1) ?? ""); } catch { /* A provider-relative URL can still use its model name. */ }
  const source = String(explicit ?? (urlName || model.name || String(model.remoteId))).replace(/[<>:"/\\|?*]/g, "").trim() || String(model.remoteId);
  return /\.nam$/i.test(source) ? source : `${source}.nam`;
}

function uniqueDeviceNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const clean = name.trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || clean === "." || clean === ".." || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}
let liveTempoTaps: number[] = [];
const SCENE_WRITE_SETTLE_MS = 350;
let sceneWriteReadyAt = 0;
let sceneWriteQueue: Promise<unknown> = Promise.resolve();

function queueSceneWrite(write: () => Promise<ApiResponse>): Promise<ApiResponse> {
  const run = async () => {
    const remaining = sceneWriteReadyAt - performance.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    const response = await write();
    // Flex Prime can acknowledge a scene before the audio engine is ready for
    // the next one. Serializing rapid taps prevents the second flag being lost.
    sceneWriteReadyAt = performance.now() + SCENE_WRITE_SETTLE_MS;
    return response;
  };
  const queued = sceneWriteQueue.then(run, run);
  sceneWriteQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

const native = () => isTauri();

async function invokeDevice<T>(command: string, args: Record<string, unknown> | undefined, action: string): Promise<T> {
  try {
    return args === undefined ? await invoke<T>(command) : await invoke<T>(command, args);
  } catch (error) {
    throw normalizeDeviceError(error, action);
  }
}

function responseFor(value: unknown, action: string): ApiResponse {
  if (!value || typeof value !== "object" || typeof (value as ApiResponse).status !== "number" || !("body" in value)) {
    throw invalidDeviceResponse(action, "a device response with status and body", value);
  }
  const response = value as ApiResponse;
  if (response.status < 200 || response.status >= 300) {
    throw normalizeDeviceError(`Device returned HTTP ${response.status}`, action);
  }
  return response;
}

function objectFor(value: unknown, action: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidDeviceResponse(action, "an object", value);
  return value as Record<string, unknown>;
}

function reflectedReturn(response: ApiResponse): unknown {
  const body = response.body as { methodReturnValue?: unknown } | undefined;
  const result = body?.methodReturnValue ?? response.body;
  if (typeof result !== "string") return result;
  try { return JSON.parse(result); } catch { return result; }
}

function assertMethodResponse(response: ApiResponse, action: string): unknown {
  return reflectedReturn(responseFor(response, action));
}

function assertTone3000Envelope(response: ApiResponse, action: string, requireConfirmedSuccess = false): void {
  const result = assertMethodResponse(response, action);
  if (result === false) throw new Error(`${action} was rejected by Tone3000.`);
  if (!result || typeof result !== "object" || !("success" in result)) {
    if (requireConfirmedSuccess) throw invalidDeviceResponse(action, "a confirmed Tone3000 success response", result);
    return;
  }
  const envelope = result as { success?: boolean; errorMessage?: unknown };
  if (envelope.success === false) throw new Error(typeof envelope.errorMessage === "string" && envelope.errorMessage.trim() ? envelope.errorMessage : `${action} was rejected by Tone3000.`);
  if (requireConfirmedSuccess && envelope.success !== true) throw invalidDeviceResponse(action, "a confirmed Tone3000 success response", result);
}

function assertProviderDownloadResponse(response: ApiResponse, action: string): void {
  const result = assertMethodResponse(response, action);
  if (result === false) throw new Error(`${action} was rejected by the device.`);
  if (result !== true) throw invalidDeviceResponse(action, "a boolean success result", result);
}

const reflectedDocumentId = () => globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
  const random = Math.floor(Math.random() * 16);
  return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
});

export const deviceApi = {
  isNative: native,

  async discover(): Promise<DeviceInfo[]> {
    if (!native()) return [{ ...demoDevice }];
    const result = await invokeDevice<unknown>("discover_devices", undefined, "Scanning for HeadRush devices");
    if (!Array.isArray(result)) throw invalidDeviceResponse("Scanning for HeadRush devices", "a device list", result);
    if (result.some((item) => !item || typeof item !== "object")) throw invalidDeviceResponse("Scanning for HeadRush devices", "valid device entries", result);
    return result as DeviceInfo[];
  },

  async connect(address: string): Promise<ConnectResult> {
    if (!native()) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { device: { ...demoDevice, host: address || demoDevice.host }, capabilities: demoCapabilities };
    }
    const result = await invokeDevice<unknown>("connect_device", { address }, "Connecting to HeadRush");
    if (!result || typeof result !== "object" || !("device" in result) || !("capabilities" in result)
      || !(result as ConnectResult).device || typeof (result as ConnectResult).device !== "object"
      || !(result as ConnectResult).capabilities || typeof (result as ConnectResult).capabilities !== "object") {
      throw invalidDeviceResponse("Connecting to HeadRush", "device identity and capabilities", result);
    }
    return result as ConnectResult;
  },

  async disconnect(): Promise<void> {
    if (native()) await invokeDevice("disconnect_device", undefined, "Disconnecting HeadRush");
  },

  async subtree(path?: string): Promise<Record<string, unknown>> {
    if (!native()) return {};
    return objectFor(await invokeDevice("get_subtree", { path: path ?? null }, "Refreshing device state"), "Refreshing device state");
  },

  async properties(path: string): Promise<Record<string, unknown>> {
    if (!native()) return {};
    return objectFor(await invokeDevice("get_object_properties", { path }, "Reading device controls"), "Reading device controls");
  },

  async setProperties(path: string, properties: Record<string, unknown>): Promise<ApiResponse> {
    if (!native()) return { status: 200, body: { ...properties, simulated: true } };
    return responseFor(await invokeDevice("set_object_properties", { path, properties }, "Applying device change"), "Applying device change");
  },

  async callMethod(path: string, method: string, args: unknown[] = []): Promise<ApiResponse> {
    if (!native()) return { status: 200, body: { method, arguments: args, simulated: true } };
    return responseFor(await invokeDevice("call_object_method", { path, method, arguments: args }, "Running device action"), "Running device action");
  },

  async listDeviceFiles(path = "", kind: DeviceFileKind | number = "folders"): Promise<string[]> {
    const fileType = typeof kind === "number" ? kind : DEVICE_FILE_KIND[kind];
    const result = reflectedReturn(await this.callMethod("/Evil/API/FileAccess", "ls", [normalizeDeviceFilePath(path), fileType]));
    return Array.isArray(result) ? uniqueDeviceNames(result.map(String)) : [];
  },

  async listDeviceDirectory(path = "", kind: DeviceFileKind = "all"): Promise<DeviceDirectoryListing> {
    const normalizedPath = normalizeDeviceFilePath(path);
    // FileAccess exposes folders (type 0) and files (type 1+) as separate
    // listings. The pedal's own browser requests both for every directory.
    const [folderNames, fileNames] = await Promise.all([
      this.listDeviceFiles(normalizedPath, "folders"),
      kind === "folders" ? Promise.resolve([]) : this.listDeviceFiles(normalizedPath, kind),
    ]);
    const folderKeys = new Set(folderNames.map((name) => name.toLocaleLowerCase()));
    const folders = folderNames.map((name): DeviceFileEntry => ({ name, type: "folder" }));
    const files = fileNames.filter((name) => !folderKeys.has(name.toLocaleLowerCase())).map((name): DeviceFileEntry => ({ name, type: "file" }));
    return { path: normalizedPath, folders, files, entries: [...folders, ...files] };
  },

  async setDeviceTuner(active: boolean): Promise<void> {
    await this.setProperties("/Evil/Engine/AudioCtrl/Input", { TunerOn: active });
  },

  async setTunerMuted(muted: boolean): Promise<boolean> {
    const response = await this.setProperties("/Evil/Engine/AudioCtrl/Tuner", { TunerMuting: muted });
    assertMethodResponse(response, muted ? "Mute tuner outputs" : "Unmute tuner outputs");
    if (!native()) return muted;
    const confirmed = await this.properties("/Evil/Engine/AudioCtrl/Tuner");
    return confirmed.TunerMuting === true;
  },

  async tunerValues(): Promise<Record<string, unknown>> {
    return this.properties("/Evil/Engine/FFTCtrl");
  },

  async footswitchOperations(index: number, module: string): Promise<Array<{ label: string; isDisabled: boolean }>> {
    const [operationResult, enableResult] = await Promise.all([
      this.callMethod("/Evil/Engine/FootSwitch", "operationList", [index, module]),
      this.callMethod("/Evil/Engine/FootSwitch", "operationEnableList", [index, module]),
    ]);
    const operations = reflectedReturn(operationResult);
    const enabled = reflectedReturn(enableResult);
    if (!Array.isArray(operations)) return [];
    return operations.map((operation, operationIndex) => ({
      label: String(operation),
      isDisabled: Array.isArray(enabled) && enabled[operationIndex] === false,
    }));
  },

  async executeLiveAction(button: LiveButton, gesture: LiveGesture = "release"): Promise<ApiResponse> {
    if (!native()) return { status: 200, body: { action: button.action, target: button.target, gesture, simulated: true } };
    if (button.action === "drums") {
      const method = drumMethodForTarget(button.target, gesture);
      if (!method) return { status: 202, body: { action: button.action, target: button.target, deviceWrite: false, reason: "No reflected drum method" } };
      return this.callMethod("/Evil/Engine/DrumsCtrl", method);
    }
    if (button.action === "scene") {
      const scene = "ABCDEF".indexOf((button.target ?? "A").toUpperCase());
      if (scene < 0) throw new Error(`Invalid scene target: ${button.target ?? ""}`);
      // LastScene/LastSceneState are reflected bookkeeping values: writing them
      // changes the readback but does not apply a scene to the audio engine.
      // The device web app and live pedal both activate scenes through the
      // per-scene flag; the engine then updates LastScene and all active flags.
      return queueSceneWrite(() => this.setProperties("/Evil/Engine/FootSwitch", { [`SceneActive${scene + 1}`]: true }));
    }
    if (button.action === "tuner") {
      const target = tunerPropertyForTarget(button.target);
      return this.setProperties(target.path, { [target.property]: !button.active });
    }
    if (button.action === "tap-tempo") {
      const now = performance.now();
      liveTempoTaps = [...liveTempoTaps.filter((tap) => now - tap < 2_500), now].slice(-6);
      if (liveTempoTaps.length < 2) return { status: 202, body: { action: button.action, waitingForNextTap: true } };
      const intervals = liveTempoTaps.slice(1).map((tap, index) => tap - liveTempoTaps[index]);
      const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
      const bpm = Math.max(30, Math.min(240, Math.round(60_000 / average)));
      return this.setProperties("/Evil/Engine/Tempo", { Tempo: bpm });
    }
    // The reflected Flex Prime contract does not expose a generic virtual-footpress
    // method. Other actions remain local unless they have a confirmed object/property
    // target, preventing guessed writes to a real pedal.
    return { status: 202, body: { action: button.action, deviceWrite: false, reason: "No confirmed reflected action" } };
  },

  async startEvents(): Promise<void> {
    if (native()) await invokeDevice("start_device_events", undefined, "Starting live device updates");
  },

  async onDeviceEvent(onEvent: (event: unknown) => void, onError?: (error: unknown) => void): Promise<UnlistenFn> {
    if (!native()) return () => undefined;
    let unlistenEvent: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;
    try {
      unlistenEvent = await listen("device-event", (event) => onEvent(event.payload));
      unlistenError = await listen("device-connection-error", (event) => onError?.(normalizeDeviceError(event.payload, "Live device updates")));
      return () => { unlistenEvent?.(); unlistenError?.(); };
    } catch (error) {
      unlistenEvent?.();
      unlistenError?.();
      throw normalizeDeviceError(error, "Starting live device updates");
    }
  },

  async getSetlist(id: string): Promise<unknown> {
    return reflectedReturn(await this.callMethod("/Evil/API/Setlists", "getSetlist", [id]));
  },

  async canSaveNewRig(): Promise<boolean> {
    const result = assertMethodResponse(
      await this.callMethod("/Evil/API/Rigs", "canSaveNewRig", [true]),
      "Checking whether a new rig can be saved",
    );
    if (typeof result !== "boolean") throw invalidDeviceResponse("Checking whether a new rig can be saved", "a boolean result", result);
    return result;
  },

  async saveRigAs(name: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Enter a rig name.");
    const result = assertMethodResponse(
      await this.callMethod("/Evil/API/Rigs", "saveRigAs", [trimmedName, -1]),
      "Saving rig to HeadRush",
    );
    if (result === false) throw new Error("Saving rig to HeadRush was rejected by the device.");
    if (result !== true) throw invalidDeviceResponse("Saving rig to HeadRush", "a boolean success result", result);
  },

  async blockPresets(blockName: string): Promise<string[]> {
    const result = reflectedReturn(await this.callMethod("/Evil/API/Blocks", "blockPresets", [blockName]));
    return Array.isArray(result) ? result.map(String) : [];
  },

  async loadBlockPreset(blockName: string, presetName: string): Promise<void> {
    await this.callMethod("/Evil/API/Blocks", "loadBlockPreset", [blockName, presetName, 0]);
  },

  async createBlockPreset(blockName: string, moduleTypeId: number, presetName: string, overwrite = false): Promise<void> {
    await this.callMethod("/Evil/API/Blocks", "createPreset", [blockName, moduleTypeId, presetName, overwrite]);
  },

  async renameBlockPreset(blockName: string, oldName: string, newName: string): Promise<void> {
    await this.callMethod("/Evil/API/Blocks", "renamePreset", [blockName, oldName, newName]);
  },

  async deleteBlockPreset(blockName: string, presetName: string): Promise<void> {
    await this.callMethod("/Evil/API/Blocks", "deletePreset", [blockName, presetName]);
  },

  async saveSetlist(id: string, name: string, rigIds: string[]): Promise<string> {
    const creating = !id;
    const saveAsName = creating ? name.trim() : "";
    if (creating && !saveAsName) throw new Error("Enter a setlist name.");
    const payload = { id: creating ? reflectedDocumentId() : id, name: creating ? "" : name, data: rigIds.map((rigId, order) => ({ id: rigId, order })) };
    return this.saveSetlistDocument(payload, saveAsName);
  },

  async saveSetlistDocument(payload: Record<string, unknown>, saveAsName = ""): Promise<string> {
    const result = assertMethodResponse(
      await this.callMethod("/Evil/API/Setlists", "saveSetlist", [JSON.stringify(payload), saveAsName]),
      "Saving setlist to HeadRush",
    );
    if (result === false) throw new Error("Saving setlist to HeadRush was rejected by the device.");
    if (typeof result !== "string" || !result.trim()) throw invalidDeviceResponse("Saving setlist to HeadRush", "a non-empty setlist ID", result);
    return result.trim();
  },

  async downloadTone(
    tone: { source: string; remoteId?: string | number; remoteKind?: string },
    model?: { remoteId: number; name: string; url: string; metadata?: Record<string, string | number | boolean> },
    downloadName = "",
  ): Promise<void> {
    if (tone.source === "Tone3000") {
      if (!model) throw new Error("Choose a compatible Tone3000 model first.");
      assertTone3000Envelope(
        await this.callMethod("/Evil/API/Tone3000", "downloadModelToDevice", [model.remoteId, model.url, tone3000ModelFilename(model)]),
        "Tone3000 model download",
        true,
      );
      return;
    }
    const remoteId = tone.remoteId;
    if (remoteId === null || remoteId === undefined || String(remoteId).trim() === "") {
      throw new Error("This HeadRush Cloud item has no usable device identifier.");
    }
    const method = tone.remoteKind === "clone" ? "downloadClone" : "downloadRig";
    assertProviderDownloadResponse(
      await this.callMethod("/Evil/Cloud/Master", method, [String(remoteId), downloadName.trim()]),
      tone.remoteKind === "clone" ? "HeadRush Cloud clone download" : "HeadRush Cloud rig download",
    );
  },

  async startToneDemo(tone: Pick<CloudTone, "id" | "source" | "remoteId" | "remoteKind">, model?: Pick<ToneModel, "remoteId" | "url">): Promise<void> {
    if (tone.source === "Tone3000") {
      if (!model) throw new Error("Choose a compatible Tone3000 model before auditioning.");
      const response = await this.callMethod("/Evil/API/Tone3000", "startDemo", [JSON.stringify({ modelId: model.remoteId, url: model.url })]);
      assertTone3000Envelope(response, "Tone3000 audition");
      return;
    }
    const remoteId = tone.remoteId ?? (!native() ? tone.id : null);
    if (remoteId === null || remoteId === undefined || String(remoteId).trim() === "") throw new Error("This HeadRush Cloud item has no usable device identifier.");
    const method = tone.remoteKind === "clone" ? "startCloneDemo" : "startDemo";
    assertMethodResponse(await this.callMethod("/Evil/Cloud/Master", method, [String(remoteId)]), "HeadRush Cloud audition");
  },

  async stopToneDemo(source: CloudTone["source"]): Promise<void> {
    if (source === "Tone3000") {
      assertTone3000Envelope(await this.callMethod("/Evil/API/Tone3000", "stopDemo", []), "Stopping Tone3000 audition");
      return;
    }
    assertMethodResponse(await this.callMethod("/Evil/Cloud/Master", "stopDemo", []), "Stopping HeadRush Cloud audition");
  },

  async searchTone3000(query = "", page = 1, pageSize = 25, filters: Tone3000SearchFilters = DEFAULT_TONE3000_FILTERS): Promise<unknown> {
    const request = {
      filters: {
        architecture: filters.architecture,
        calibrated: filters.calibrated,
        gear: filters.gear,
        sizes: filters.architecture === 1 ? filters.sizes : [],
        format: filters.format || undefined,
        tags: filters.tags,
        makes: filters.makes,
        creators: filters.creators,
        verified: filters.verified,
      },
      page,
      pageSize,
      query,
      sortMode: filters.sortMode,
      feedMode: "browse",
    };
    return reflectedReturn(await this.callMethod("/Evil/API/Tone3000", "searchTones", [JSON.stringify(request)]));
  },

  async fetchTone3000Models(toneId: number, architecture: 1 | 2): Promise<unknown> {
    return reflectedReturn(await this.callMethod("/Evil/API/Tone3000", "fetchModels", [JSON.stringify({ toneId, architecture })]));
  },

  async listHeadRushCloud(query = "", pageToken?: string, pageSize = 100, compatibility?: { releaseTypes?: string[]; unsupportedCapabilities?: string[] }): Promise<unknown> {
    const names: string[] = ["page_size", "filter", "include_incompatible_versions"];
    const values: string[] = [String(pageSize), query, "true"];
    if (pageToken) { names.push("page_token"); values.push(pageToken); }
    const releaseTypes = compatibility?.releaseTypes?.length ? compatibility.releaseTypes : ["RELEASE_TYPE_PUBLIC"];
    for (const releaseType of releaseTypes) { names.push("include_release_types"); values.push(releaseType); }
    for (const capability of compatibility?.unsupportedCapabilities ?? []) { names.push("unsupported_capabilities"); values.push(capability); }
    return reflectedReturn(await this.callMethod("/Evil/Cloud/Master", "requestGet", ["items", "v2", names, values]));
  },

  async rawRequest(method: "GET" | "POST" | "PUT", route: string, body?: unknown): Promise<ApiResponse> {
    if (!native()) return { status: 200, body: { route, method, body, simulated: true } };
    return responseFor(await invokeDevice("device_request", { method, route, body: body ?? null }, "Requesting device data"), "Requesting device data");
  },
};
