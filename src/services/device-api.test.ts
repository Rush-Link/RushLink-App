import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke, isTauri: tauri.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

import { DEFAULT_TONE3000_FILTERS, deviceApi, normalizeDeviceFilePath, tone3000ModelFilename } from "./device-api";
import { DeviceError } from "./device-errors";
import type { LiveButton } from "../domain/types";

const button = (action: LiveButton["action"], target?: string, active = false) => ({
  id: "control", label: "Control", action, target, active, switchType: "trigger", color: "cyan", icon: "zap",
}) as LiveButton;

describe("deviceApi browser adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tauri.invoke.mockReset();
    tauri.listen.mockReset();
    tauri.isTauri.mockReturnValue(false);
  });

  it("provides safe simulated fallbacks outside Tauri", async () => {
    expect(await deviceApi.discover()).toHaveLength(1);
    const connected = await deviceApi.connect("pedal.local");
    expect(connected.device.host).toBe("pedal.local");
    await expect(deviceApi.disconnect()).resolves.toBeUndefined();
    await expect(deviceApi.subtree("/x")).resolves.toEqual({});
    await expect(deviceApi.properties("/x")).resolves.toEqual({});
    await expect(deviceApi.setProperties("/x", { Enabled: true })).resolves.toMatchObject({ status: 200, body: { Enabled: true, simulated: true } });
    await expect(deviceApi.callMethod("/x", "run", [1])).resolves.toMatchObject({ body: { method: "run", arguments: [1] } });
    await expect(deviceApi.rawRequest("POST", "/api", { ok: true })).resolves.toMatchObject({ body: { route: "/api", method: "POST" } });
    await expect(deviceApi.executeLiveAction(button("custom"))).resolves.toMatchObject({ body: { simulated: true } });
    await expect(deviceApi.startEvents()).resolves.toBeUndefined();
    const unlisten = await deviceApi.onDeviceEvent(vi.fn());
    expect(unlisten()).toBeUndefined();
  });

  it("maps native bridge calls and optional arguments exactly", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "discover_devices") return [];
      if (command === "connect_device") return { device: {}, capabilities: {} };
      if (["get_subtree", "get_object_properties"].includes(command)) return {};
      if (["set_object_properties", "call_object_method", "device_request"].includes(command)) return { status: 200, body: {} };
      return undefined;
    });
    await deviceApi.discover();
    await deviceApi.connect("10.0.0.2");
    await deviceApi.disconnect();
    await deviceApi.subtree();
    await deviceApi.subtree("/Evil");
    await deviceApi.properties("/object");
    await deviceApi.setProperties("/object", { Gain: .5 });
    await deviceApi.callMethod("/object", "save", ["x"]);
    await deviceApi.rawRequest("PUT", "/api/v1/object", { value: 1 });
    expect(tauri.invoke.mock.calls).toEqual(expect.arrayContaining([
      ["discover_devices"], ["connect_device", { address: "10.0.0.2" }], ["disconnect_device"],
      ["get_subtree", { path: null }], ["get_subtree", { path: "/Evil" }],
      ["get_object_properties", { path: "/object" }],
      ["set_object_properties", { path: "/object", properties: { Gain: .5 } }],
      ["call_object_method", { path: "/object", method: "save", arguments: ["x"] }],
      ["device_request", { method: "PUT", route: "/api/v1/object", body: { value: 1 } }],
    ]));
  });

  it("normalizes reflected file, preset and footswitch responses", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: '["A","B"]' } });
    await expect(deviceApi.listDeviceFiles("/Rigs", "rig")).resolves.toEqual(["A", "B"]);
    expect(call).toHaveBeenLastCalledWith("/Evil/API/FileAccess", "ls", ["Rigs", 4]);
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: "not-json" } });
    await expect(deviceApi.listDeviceFiles("", 9)).resolves.toEqual([]);
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: '["Clean",4]' } });
    await expect(deviceApi.blockPresets("Amp")).resolves.toEqual(["Clean", "4"]);
    call
      .mockResolvedValueOnce({ status: 200, body: { methodReturnValue: '["Toggle","Hold"]' } })
      .mockResolvedValueOnce({ status: 200, body: { methodReturnValue: "[true,false]" } });
    await expect(deviceApi.footswitchOperations(2, "Amp")).resolves.toEqual([
      { label: "Toggle", isDisabled: false }, { label: "Hold", isDisabled: true },
    ]);
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: {} } }).mockResolvedValueOnce({ status: 200, body: {} });
    await expect(deviceApi.footswitchOperations(0, "None")).resolves.toEqual([]);
  });

  it("lists folders alongside filtered NAM files and retains normalized nested paths", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    call
      .mockResolvedValueOnce({ status: 200, body: { methodReturnValue: '[" User ","Tone 3000","user","."]' } })
      .mockResolvedValueOnce({ status: 200, body: { methodReturnValue: '["Chug.nam","Ola Satan Model 50.nam"]' } });

    await expect(deviceApi.listDeviceDirectory("\\Neural Amp Modeler\\User\\", "nam")).resolves.toEqual({
      path: "Neural Amp Modeler/User",
      folders: [{ name: "User", type: "folder" }, { name: "Tone 3000", type: "folder" }],
      files: [{ name: "Chug.nam", type: "file" }, { name: "Ola Satan Model 50.nam", type: "file" }],
      entries: [
        { name: "User", type: "folder" }, { name: "Tone 3000", type: "folder" },
        { name: "Chug.nam", type: "file" }, { name: "Ola Satan Model 50.nam", type: "file" },
      ],
    });
    expect(call.mock.calls.slice(-2)).toEqual([
      ["/Evil/API/FileAccess", "ls", ["Neural Amp Modeler/User", 0]],
      ["/Evil/API/FileAccess", "ls", ["Neural Amp Modeler/User", 9]],
    ]);
    expect(normalizeDeviceFilePath("/Neural Amp Modeler/../Rigs//User")).toBe("Rigs/User");
  });

  it("delegates device helper operations using confirmed endpoints", async () => {
    const set = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const props = vi.spyOn(deviceApi, "properties").mockResolvedValue({ Note: "A" });
    const call = vi.spyOn(deviceApi, "callMethod").mockImplementation(async (_path, method, args = []) => {
      if (method === "canSaveNewRig" || method === "saveRigAs") {
        return { status: 200, body: { methodReturnValue: true } };
      }
      if (method === "saveSetlist") {
        const payload = JSON.parse(String(args[0])) as { id: string };
        return { status: 200, body: { methodReturnValue: payload.id } };
      }
      return { status: 200, body: {} };
    });
    await deviceApi.setDeviceTuner(true);
    await expect(deviceApi.tunerValues()).resolves.toEqual({ Note: "A" });
    await deviceApi.loadBlockPreset("Amp", "Lead");
    await deviceApi.createBlockPreset("Amp", 7, "Lead", true);
    await deviceApi.renameBlockPreset("Amp", "Lead", "Solo");
    await deviceApi.deleteBlockPreset("Amp", "Solo");
    await expect(deviceApi.canSaveNewRig()).resolves.toBe(true);
    await deviceApi.saveRigAs("  New Rig  ");
    await deviceApi.saveSetlist("s1", "Show", ["r1", "r2"]);
    await deviceApi.saveSetlist("", "New Setlist", []);
    expect(set).toHaveBeenCalledWith("/Evil/Engine/AudioCtrl/Input", { TunerOn: true });
    expect(props).toHaveBeenCalledWith("/Evil/Engine/FFTCtrl");
    expect(call).toHaveBeenCalledWith("/Evil/API/Rigs", "canSaveNewRig", [true]);
    expect(call).toHaveBeenCalledWith("/Evil/API/Rigs", "saveRigAs", ["New Rig", -1]);
    expect(call).toHaveBeenCalledWith("/Evil/API/Setlists", "saveSetlist", [JSON.stringify({ id: "s1", name: "Show", data: [{ id: "r1", order: 0 }, { id: "r2", order: 1 }] }), ""]);
    const newSetlistCall = call.mock.calls.find(([, method, args]) => method === "saveSetlist" && args?.[1] === "New Setlist");
    expect(newSetlistCall).toBeDefined();
    const newSetlistPayload = JSON.parse(String(newSetlistCall?.[2]?.[0])) as { id: string; name: string; data: unknown[] };
    expect(newSetlistPayload).toMatchObject({ name: "", data: [] });
    expect(newSetlistPayload.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("preserves raw setlist documents and validates reflected save results", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    const songView = {
      id: "setlist-1",
      name: "Show",
      viewType: "song",
      data: [{ song_id: "song-1", order: 0, rigs: [{ id: "rig-1", order: 0 }] }],
    };

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: "setlist-2" } });
    await expect(deviceApi.saveSetlistDocument(songView, "Show Copy")).resolves.toBe("setlist-2");
    expect(call).toHaveBeenLastCalledWith("/Evil/API/Setlists", "saveSetlist", [JSON.stringify(songView), "Show Copy"]);

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: false } });
    await expect(deviceApi.canSaveNewRig()).resolves.toBe(false);
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: false } });
    await expect(deviceApi.saveRigAs("Rejected Rig")).rejects.toThrow("rejected by the device");
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: false } });
    await expect(deviceApi.saveSetlistDocument(songView)).rejects.toThrow("rejected by the device");
    await expect(deviceApi.saveRigAs("   ")).rejects.toThrow("Enter a rig name");
    await expect(deviceApi.saveSetlist("", "   ", [])).rejects.toThrow("Enter a setlist name");
  });

  it("rejects malformed persistence returns instead of treating an HTTP 200 as success", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    const malformed = { status: 200, body: {} };

    call.mockResolvedValueOnce(malformed);
    await expect(deviceApi.canSaveNewRig()).rejects.toMatchObject({
      code: "invalid-response",
      action: "Checking whether a new rig can be saved",
      technicalMessage: "Expected a boolean result; received object",
    });

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: "accepted" } });
    await expect(deviceApi.saveRigAs("New rig")).rejects.toMatchObject({
      code: "invalid-response",
      action: "Saving rig to HeadRush",
      technicalMessage: "Expected a boolean success result; received string",
    });

    for (const methodReturnValue of ["", "   ", true, null]) {
      call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue } });
      await expect(deviceApi.saveSetlistDocument({ id: "setlist-1", name: "Show", data: [] })).rejects.toMatchObject({
        code: "invalid-response",
        action: "Saving setlist to HeadRush",
        technicalMessage: expect.stringContaining("Expected a non-empty setlist ID"),
      });
    }
  });

  it("writes tuner mute, checks HTTP status and confirms the device state", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke
      .mockResolvedValueOnce({ status: 200, body: { TunerMuting: true } })
      .mockResolvedValueOnce({ TunerMuting: true });
    await expect(deviceApi.setTunerMuted(true)).resolves.toBe(true);
    expect(tauri.invoke).toHaveBeenNthCalledWith(1, "set_object_properties", { path: "/Evil/Engine/AudioCtrl/Tuner", properties: { TunerMuting: true } });
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "get_object_properties", { path: "/Evil/Engine/AudioCtrl/Tuner" });

    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValueOnce({ status: 500, body: { reason: "Internal Server Error" } });
    await expect(deviceApi.setTunerMuted(false)).rejects.toMatchObject({ code: "http", status: 500, recoverable: true });
  });

  it("builds Tone3000 and HeadRush Cloud requests without leaking incompatible filters", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    call.mockResolvedValue({ status: 200, body: { methodReturnValue: '{"items":[]}' } });
    const filters = { ...DEFAULT_TONE3000_FILTERS, architecture: 2 as const, sizes: ["full"], format: "nam", verified: true, sortMode: 3 as const };
    await expect(deviceApi.searchTone3000("mesa", 3, 20, filters)).resolves.toEqual({ items: [] });
    const request = JSON.parse((call.mock.calls.at(-1)?.[2]?.[0] as string));
    expect(request).toMatchObject({ page: 3, pageSize: 20, query: "mesa", sortMode: 3, filters: { sizes: [], format: "nam", verified: true } });
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: "plain" } });
    await expect(deviceApi.fetchTone3000Models(42, 1)).resolves.toBe("plain");
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: { items: [] } } });
    await deviceApi.listHeadRushCloud("lead", "next", 12, { releaseTypes: ["PUBLIC", "BETA"], unsupportedCapabilities: ["CORE"] });
    const cloudArgs = call.mock.calls.at(-1)?.[2] as unknown[];
    expect(cloudArgs.slice(0, 2)).toEqual(["items", "v2"]);
    expect(cloudArgs[2]).toEqual(expect.arrayContaining(["page_token", "include_release_types", "unsupported_capabilities"]));
    expect(cloudArgs[3]).toEqual(expect.arrayContaining(["next", "PUBLIC", "BETA", "CORE"]));
  });

  it("selects the right tone download command and validates Tone3000 models", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockImplementation(async (_path, method) => ({
      status: 200,
      body: {
        methodReturnValue: method === "downloadModelToDevice"
          ? JSON.stringify({ success: true })
          : true,
      },
    }));
    await expect(deviceApi.downloadTone({ source: "Tone3000", remoteId: 1 })).rejects.toThrow("Choose a compatible");
    await deviceApi.downloadTone({ source: "Tone3000" }, { remoteId: 9, name: "A2", url: "https://tone/model" });
    await deviceApi.downloadTone({ source: "HeadRush Cloud", remoteId: "rig" });
    await deviceApi.downloadTone({ source: "HeadRush Cloud", remoteId: "clone", remoteKind: "clone" });
    expect(call).toHaveBeenCalledWith("/Evil/API/Tone3000", "downloadModelToDevice", [9, "https://tone/model", "model.nam"]);
    expect(call).toHaveBeenCalledWith("/Evil/Cloud/Master", "downloadRig", ["rig", ""]);
    expect(call).toHaveBeenCalledWith("/Evil/Cloud/Master", "downloadClone", ["clone", ""]);
    expect(tone3000ModelFilename({ remoteId: 9, name: "A2", url: "relative", metadata: { file_name: "Fortin/Nameless.nam" } })).toBe("FortinNameless.nam");
    expect(tone3000ModelFilename({ remoteId: 12, name: "Clean capture", url: "relative" })).toBe("Clean capture.nam");
  });

  it("rejects semantic provider download failures instead of reporting a durable file", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    const model = { remoteId: 9, name: "Exact NAM", url: "https://tone3000/model.nam" };

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: JSON.stringify({ success: false, errorMessage: "write failed" }) } });
    await expect(deviceApi.downloadTone({ source: "Tone3000", remoteId: 1 }, model)).rejects.toThrow("write failed");

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: false } });
    await expect(deviceApi.downloadTone({ source: "HeadRush Cloud", remoteId: "clone", remoteKind: "clone" }, undefined, "Saved clone")).rejects.toThrow(/rejected by the device/i);

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: { success: false, message: "cloud storage full" } } });
    await expect(deviceApi.downloadTone({ source: "HeadRush Cloud", remoteId: "rig", remoteKind: "rig" }, undefined, "Saved rig")).rejects.toMatchObject({
      code: "invalid-response",
      action: "HeadRush Cloud rig download",
      technicalMessage: "Expected a boolean success result; received object",
    });

    await expect(deviceApi.downloadTone({ source: "HeadRush Cloud", remoteKind: "clone" }, undefined, "No id")).rejects.toThrow(/no usable device identifier/i);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("requires explicit provider success envelopes for durable downloads", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    const tone3000 = { source: "Tone3000", remoteId: 1 };
    const model = { remoteId: 9, name: "Exact NAM", url: "https://tone3000/model.nam" };

    for (const methodReturnValue of [undefined, {}, { success: "true" }, { success: null }]) {
      call.mockResolvedValueOnce({ status: 200, body: methodReturnValue === undefined ? {} : { methodReturnValue } });
      await expect(deviceApi.downloadTone(tone3000, model)).rejects.toMatchObject({
        code: "invalid-response",
        action: "Tone3000 model download",
        technicalMessage: "Expected a confirmed Tone3000 success response; received object",
      });
    }

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: "true" } });
    await expect(deviceApi.downloadTone({ source: "HeadRush Cloud", remoteId: "json-true", remoteKind: "rig" })).resolves.toBeUndefined();

    for (const methodReturnValue of [undefined, {}, "accepted", 1, null]) {
      call.mockResolvedValueOnce({ status: 200, body: methodReturnValue === undefined ? {} : { methodReturnValue } });
      await expect(deviceApi.downloadTone({ source: "HeadRush Cloud", remoteId: "cloud-rig", remoteKind: "rig" })).rejects.toMatchObject({
        code: "invalid-response",
        action: "HeadRush Cloud rig download",
        technicalMessage: expect.stringContaining("Expected a boolean success result"),
      });
    }
  });

  it("validates semantic Tone3000 demo failures and confirmed provider routes", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    const tone = { id: "tone", source: "Tone3000" as const, remoteId: 7, remoteKind: "tone-group" as const };
    const model = { remoteId: 9, url: "https://tone/model" };
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: JSON.stringify({ success: false, errorMessage: "Model is incompatible" }) } });
    await expect(deviceApi.startToneDemo(tone, model)).rejects.toThrow("Model is incompatible");
    call.mockResolvedValueOnce({ status: 503, body: {} });
    await expect(deviceApi.startToneDemo(tone, model)).rejects.toMatchObject({ code: "http", status: 503 });
    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: JSON.stringify({ success: true }) } });
    await expect(deviceApi.startToneDemo(tone, model)).resolves.toBeUndefined();
    expect(call).toHaveBeenLastCalledWith("/Evil/API/Tone3000", "startDemo", [JSON.stringify({ modelId: 9, url: model.url })]);

    call.mockResolvedValueOnce({ status: 200, body: { methodReturnValue: false } });
    await expect(deviceApi.stopToneDemo("Tone3000")).rejects.toThrow("rejected");
    call.mockResolvedValueOnce({ status: 200, body: {} });
    await expect(deviceApi.stopToneDemo("HeadRush Cloud")).resolves.toBeUndefined();
    expect(call).toHaveBeenLastCalledWith("/Evil/Cloud/Master", "stopDemo", []);
  });

  it("selects HeadRush Cloud rig and clone demo routes and requires native ids", async () => {
    tauri.isTauri.mockReturnValue(true);
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    await deviceApi.startToneDemo({ id: "rig", source: "HeadRush Cloud", remoteId: "remote-rig", remoteKind: "rig" });
    await deviceApi.startToneDemo({ id: "clone", source: "HeadRush Cloud", remoteId: "remote-clone", remoteKind: "clone" });
    expect(call).toHaveBeenNthCalledWith(1, "/Evil/Cloud/Master", "startDemo", ["remote-rig"]);
    expect(call).toHaveBeenNthCalledWith(2, "/Evil/Cloud/Master", "startCloneDemo", ["remote-clone"]);
    await expect(deviceApi.startToneDemo({ id: "missing", source: "HeadRush Cloud", remoteKind: "rig" })).rejects.toThrow("no usable device identifier");
  });

  it("executes only confirmed native live actions", async () => {
    tauri.isTauri.mockReturnValue(true);
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    const sceneWriteTimes: number[] = [];
    const set = vi.spyOn(deviceApi, "setProperties").mockImplementation(async (_path, properties) => {
      if (Object.keys(properties).some((property) => property.startsWith("SceneActive"))) sceneWriteTimes.push(performance.now());
      return { status: 200, body: {} };
    });
    await deviceApi.executeLiveAction(button("drums", "fill"));
    await expect(deviceApi.executeLiveAction(button("drums", "unknown"))).resolves.toMatchObject({ status: 202 });
    for (const scene of "ABCDEF") await deviceApi.executeLiveAction(button("scene", scene));
    await expect(deviceApi.executeLiveAction(button("scene", "?"))).rejects.toThrow("Invalid scene target");
    await deviceApi.executeLiveAction(button("tuner", "mute", true));
    await expect(deviceApi.executeLiveAction(button("looper", "open"))).resolves.toMatchObject({ body: { deviceWrite: false } });
    expect(call).toHaveBeenCalledWith("/Evil/Engine/DrumsCtrl", "playFill");
    for (const [scene, index] of [..."ABCDEF"].map((value, index) => [value, index] as const)) {
      expect(set).toHaveBeenCalledWith("/Evil/Engine/FootSwitch", { [`SceneActive${index + 1}`]: true });
      expect(button("scene", scene).target).toBe(scene);
    }
    expect(sceneWriteTimes).toHaveLength(6);
    expect(sceneWriteTimes.slice(1).every((time, index) => time - sceneWriteTimes[index] >= 300)).toBe(true);
    expect(set).toHaveBeenCalledWith("/Evil/Engine/AudioCtrl/Tuner", { TunerMuting: false });
  });

  it("calculates bounded tap tempo from recent taps", async () => {
    tauri.isTauri.mockReturnValue(true);
    const set = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_500).mockReturnValueOnce(11_000).mockReturnValueOnce(11_100);
    await expect(deviceApi.executeLiveAction(button("tap-tempo"))).resolves.toMatchObject({ status: 202 });
    await deviceApi.executeLiveAction(button("tap-tempo"));
    expect(set).toHaveBeenLastCalledWith("/Evil/Engine/Tempo", { Tempo: 120 });
    await expect(deviceApi.executeLiveAction(button("tap-tempo"))).resolves.toMatchObject({ status: 202 });
    await deviceApi.executeLiveAction(button("tap-tempo"));
    expect(set).toHaveBeenLastCalledWith("/Evil/Engine/Tempo", { Tempo: 240 });
  });

  it("subscribes and safely tears down both native event channels", async () => {
    tauri.isTauri.mockReturnValue(true);
    const unlistenDevice = vi.fn(); const unlistenError = vi.fn();
    let deviceHandler: ((event: { payload: unknown }) => void) | undefined;
    let errorHandler: ((event: { payload: unknown }) => void) | undefined;
    tauri.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => void) => {
      if (name === "device-event") { deviceHandler = handler; return unlistenDevice; }
      errorHandler = handler; return unlistenError;
    });
    const onEvent = vi.fn(); const onError = vi.fn();
    const stop = await deviceApi.onDeviceEvent(onEvent, onError);
    deviceHandler?.({ payload: { type: "change" } }); errorHandler?.({ payload: "offline" }); stop();
    expect(onEvent).toHaveBeenCalledWith({ type: "change" });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "offline", recoverable: true }));
    expect(unlistenDevice).toHaveBeenCalled(); expect(unlistenError).toHaveBeenCalled();
    await deviceApi.startEvents();
    expect(tauri.invoke).toHaveBeenCalledWith("start_device_events");
  });

  it("normalizes native bridge failures and rejects malformed responses", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockRejectedValueOnce("operation timed out");
    await expect(deviceApi.properties("/object")).rejects.toMatchObject({ code: "timeout", action: "Reading device controls" });

    tauri.invoke.mockRejectedValueOnce("No HeadRush device is connected");
    await expect(deviceApi.setProperties("/object", { Gain: 1 })).rejects.toMatchObject({ code: "offline" });

    tauri.invoke.mockResolvedValueOnce([]);
    await expect(deviceApi.subtree()).rejects.toMatchObject({ code: "invalid-response", recoverable: true });

    tauri.invoke.mockResolvedValueOnce({ status: 404, body: {} });
    const unavailable = await deviceApi.callMethod("/object", "run").catch((error) => error);
    expect(unavailable).toBeInstanceOf(DeviceError);
    expect(unavailable).toMatchObject({ code: "unavailable", status: 404 });
  });

  it("tears down a partial realtime subscription when the second listener fails", async () => {
    tauri.isTauri.mockReturnValue(true);
    const unlisten = vi.fn();
    tauri.listen.mockResolvedValueOnce(unlisten).mockRejectedValueOnce(new Error("listener unavailable"));
    await expect(deviceApi.onDeviceEvent(vi.fn(), vi.fn())).rejects.toMatchObject({ code: "unavailable" });
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
