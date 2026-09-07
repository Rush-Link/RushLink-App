import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs, testRigTemplates } from "../data/demo-data";
import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "./app-store";

const tone3000: CloudTone = {
  id: "tone-3000", title: "Test amp", author: "QA", description: "Amp capture", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 0, downloads: 0, source: "Tone3000", imageColor: "#38d", remoteId: 77, remoteKind: "tone-group",
};
const cloudTone: CloudTone = {
  ...tone3000, id: "cloud-clone", title: "Cloud clone", source: "HeadRush Cloud", remoteId: "cloud-42", remoteKind: "clone",
};
const model: ToneModel = { id: "model-1", remoteId: 123, name: "A2 model", architecture: "A2", url: "https://models.test/model.nam" };

describe("TonePilot audition lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useAppStore.setState({
      device: structuredClone(demoDevice),
      capabilities: null,
      rigs: structuredClone(demoRigs),
      selectedRigId: demoRigs[0].id,
      liveSnapshot: null,
      liveSubtree: null,
      tones: [tone3000, cloudTone],
      toneModels: { [tone3000.id]: [model] },
      selectedToneModelId: model.id,
      testRigs: structuredClone(testRigTemplates),
      selectedTestRigId: "missing",
      auditioningToneId: null,
      auditionBusy: false,
      toneError: null,
      auditionError: null,
      testRigReturn: null,
    });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
  });
  afterEach(() => vi.useRealTimers());

  it("starts a Tone3000 demo and creates a return target only after success", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    await useAppStore.getState().auditionTone(tone3000);

    expect(call).toHaveBeenCalledWith("/Evil/API/Tone3000", "startDemo", [JSON.stringify({ modelId: model.remoteId, url: model.url })]);
    expect(useAppStore.getState()).toMatchObject({ auditioningToneId: tone3000.id, auditionBusy: false, auditionError: null });
    expect(useAppStore.getState().testRigReturn).toMatchObject({ id: demoRigs[0].id, auditionSource: "Tone3000" });
  });

  it("loads the selected Test Rig FX around the temporary device capture", async () => {
    const moduleTypes = Array.from({ length: 60 }, () => "");
    Object.assign(moduleTypes, { 0: "Empty Slot", 2: "Amp", 9: "IR", 19: "Neural Amp Modeler", 21: "Gray Comp", 39: "Spring Reverb" });
    useAppStore.setState({
      selectedTestRigId: testRigTemplates[0].id,
      liveSubtree: {
        "/Evil/API/Blocks": { value: { ModuleTypes: moduleTypes }, meta: { properties: {} } },
        "/Evil/Engine/Patch/Gray_Comp": { value: { On: true, Sustain: .5, Level: .5, order: ["Sustain", "Level"], labels: ["Sustain", "Level"] }, meta: { properties: { On: { type: "boolean" }, Sustain: { type: "number", minimum: 0, maximum: 100 }, Level: { type: "number", minimum: 0, maximum: 100 } } } },
        "/Evil/Engine/Patch/Neural_Amp_Modeler": { value: { On: true }, meta: { properties: { On: { type: "boolean" } } } },
        "/Evil/Engine/Patch/IR": { value: { On: true, IR: "", IR2: "", Mix: 1 }, meta: { properties: { On: { type: "boolean" }, IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } }, IR2: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } }, Mix: { type: "number", minimum: 0, maximum: 100 } } } },
        "/Evil/Engine/Patch/Spring_Reverb": { value: { On: true, Mix: .3, order: ["Mix"], labels: ["Mix"] }, meta: { properties: { On: { type: "boolean" }, Mix: { type: "number", minimum: 0, maximum: 100 } } } },
      },
    });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    let chainReads = 0;
    let grayCompReads = 0;
    let irReads = 0;
    vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => {
      if (path === "/Evil/Engine/Patch/Neural_Amp_Modeler") return { On: true, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Gray_Comp") return { On: ++grayCompReads > 1 };
      if (path === "/Evil/Engine/Patch/IR") return ++irReads < 3
        ? { On: true, IR: "", FileMissing: "" }
        : { On: true, IR: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav", FileMissing: "" };
      if (path !== "/Evil/Engine/Patch/Chain") return { On: path !== "/Evil/Engine/Patch/Amp" };
      chainReads++;
      return chainReads === 1
        ? { ModuleType1: 55, ModuleType5: 19, ModuleType6: 9 }
        : { Routing: 0, ModuleType2: 21, ModuleType6: 2, ModuleType7: 19, ModuleType8: 9, ModuleType10: 39 };
    });
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();

    await useAppStore.getState().auditionTone(tone3000);

    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [0, 0]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [1, 21]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [5, 2]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [6, 19]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [7, 9]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [9, 39]);
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", { ModuleType7: 19 });
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", { Routing: 0 });
    expect(call.mock.calls.findIndex(([, method, args]) => method === "setModuleTypeInternal" && args?.[0] === 6)).toBeLessThan(
      call.mock.calls.findIndex(([, method, args]) => method === "setModuleTypeInternal" && args?.[0] === 4 && args?.[1] === 0),
    );
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Gray_Comp", expect.objectContaining({ On: true, Sustain: .25, Level: .52 }));
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Neural_Amp_Modeler", expect.objectContaining({ On: true, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam" }));
    expect(setProperties.mock.calls.filter(([path]) => path === "/Evil/Engine/Patch/Gray_Comp")).toHaveLength(2);
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Spring_Reverb", expect.objectContaining({ On: true, Mix: .15 }));
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/IR", expect.objectContaining({ On: true, IR: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav" }));
    const irWrite = setProperties.mock.calls.find(([path]) => path === "/Evil/Engine/Patch/IR");
    expect(irWrite?.[1]).not.toHaveProperty("IR2");
    expect(irReads).toBeGreaterThanOrEqual(3);
    expect(useAppStore.getState().testRigReturn).toMatchObject({ testRigApplied: true, testRigMessage: expect.stringMatching(/Applied 4 Test Rig FX/) });
  });

  it("repairs a blank persisted IR before starting the provider audition", async () => {
    const legacy = structuredClone(testRigTemplates[0]);
    legacy.blocks.find((block) => block.category === "ir")!.parameters.find((parameter) => parameter.id === "IR")!.value = "";
    useAppStore.setState({ testRigs: [legacy], selectedTestRigId: legacy.id });
    vi.spyOn(deviceApi, "callMethod").mockRejectedValue(new Error("stop after preflight"));

    await expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow("stop after preflight");

    expect(useAppStore.getState().testRigs[0].blocks.find((block) => block.category === "ir")?.parameters.find((parameter) => parameter.id === "IR")?.value)
      .toBe("Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav");
  });

  it("reports the requested IR and device reason after the bounded load wait expires", async () => {
    vi.useFakeTimers();
    const moduleTypes = Array.from({ length: 60 }, () => "");
    Object.assign(moduleTypes, { 0: "Empty Slot", 2: "Amp", 9: "IR", 19: "Neural Amp Modeler", 21: "Gray Comp", 39: "Spring Reverb" });
    useAppStore.setState({
      selectedTestRigId: testRigTemplates[0].id,
      liveSubtree: {
        "/Evil/API/Blocks": { value: { ModuleTypes: moduleTypes }, meta: { properties: {} } },
        "/Evil/Engine/Patch/Gray_Comp": { value: { On: true }, meta: { properties: { On: { type: "boolean" } } } },
        "/Evil/Engine/Patch/Neural_Amp_Modeler": { value: { On: true }, meta: { properties: { On: { type: "boolean" }, LoadedClone: { type: "string" } } } },
        "/Evil/Engine/Patch/IR": { value: { On: true, IR: "" }, meta: { properties: { On: { type: "boolean" }, IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } } } } },
        "/Evil/Engine/Patch/Spring_Reverb": { value: { On: true }, meta: { properties: { On: { type: "boolean" } } } },
      },
    });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => {
      if (path === "/Evil/Engine/Patch/Chain") return { Routing: 0, ModuleType2: 21, ModuleType6: 2, ModuleType7: 19, ModuleType8: 9, ModuleType10: 39 };
      if (path === "/Evil/Engine/Patch/Neural_Amp_Modeler") return { On: true, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" };
      if (path === "/Evil/Engine/Patch/IR") return { On: true, IR: "", FileMissing: "Decoder rejected the file" };
      if (path === "/Evil/Engine/Patch/Amp") return { On: false };
      return { On: true };
    });

    const rejection = expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow(
      'IR Loader is present, but HeadRush did not finish loading "CT-Fend312EMFDS-4217B.wav". The device reported: Decoder rejected the file.',
    );
    await vi.runAllTimersAsync();
    await rejection;

    expect(call).toHaveBeenCalledWith("/Evil/API/Tone3000", "stopDemo", []);
    expect(useAppStore.getState().auditionError).not.toMatch(/load\s*\.$/i);
  });

  it("debounces and applies an edited NAM output to the active chain without restarting the provider", async () => {
    vi.useFakeTimers();
    const moduleTypes = Array.from({ length: 60 }, () => "");
    Object.assign(moduleTypes, { 0: "Empty Slot", 2: "Amp", 9: "IR", 19: "Neural Amp Modeler", 21: "Gray Comp", 39: "Spring Reverb" });
    useAppStore.setState({
      selectedTestRigId: testRigTemplates[0].id,
      auditioningToneId: tone3000.id,
      testRigReturn: { id: demoRigs[0].id, name: demoRigs[0].name, auditionSource: "Tone3000" },
      liveSubtree: {
        "/Evil/API/Blocks": { value: { ModuleTypes: moduleTypes }, meta: { properties: {} } },
        "/Evil/Engine/Patch/Gray_Comp": { value: { On: true }, meta: { properties: { On: { type: "boolean" } } } },
        "/Evil/Engine/Patch/Neural_Amp_Modeler": { value: { On: true, Output: .5 }, meta: { properties: { On: { type: "boolean" }, Output: { type: "number", minimum: -40, maximum: 40, "x-options": { grid: .1 } } } } },
        "/Evil/Engine/Patch/IR": { value: { On: true, IR: "" }, meta: { properties: { On: { type: "boolean" }, IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } } } } },
        "/Evil/Engine/Patch/Spring_Reverb": { value: { On: true }, meta: { properties: { On: { type: "boolean" } } } },
      },
    });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => path === "/Evil/Engine/Patch/Neural_Amp_Modeler"
      ? { On: true, Output: .6, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" }
      : path === "/Evil/Engine/Patch/IR"
        ? { On: true, IR: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav", FileMissing: "" }
      : path === "/Evil/Engine/Patch/Chain"
        ? { Routing: 0, ModuleType2: 21, ModuleType6: 2, ModuleType7: 19, ModuleType8: 9, ModuleType10: 39 }
        : { On: path !== "/Evil/Engine/Patch/Amp" });
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();

    const capture = useAppStore.getState().testRigs[0].blocks.find((block) => block.name === "Capture slot")!;
    useAppStore.getState().updateTestRigParameter(capture.id, "Output", 8);
    await vi.runAllTimersAsync();

    expect(call).not.toHaveBeenCalledWith("/Evil/API/Tone3000", "stopDemo", []);
    expect(call).not.toHaveBeenCalledWith("/Evil/API/Tone3000", "startDemo", expect.any(Array));
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Neural_Amp_Modeler", expect.objectContaining({ Output: .6 }));
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Spring_Reverb", expect.objectContaining({ On: true }));
    expect(useAppStore.getState().auditioningToneId).toBe(tone3000.id);
    expect(useAppStore.getState()).toMatchObject({ testRigSyncBusy: false, testRigSyncError: null, testRigSyncedAt: expect.any(Number) });
  });

  it("waits for a delayed NAM host and builds the complete chain without a cached subtree", async () => {
    const moduleTypes = Array.from({ length: 60 }, () => "");
    Object.assign(moduleTypes, { 0: "Empty Slot", 2: "Amp", 9: "IR", 19: "Neural Amp Modeler", 21: "Gray Comp", 39: "Spring Reverb" });
    useAppStore.setState({ selectedTestRigId: testRigTemplates[0].id, liveSubtree: null });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    let chainReads = 0;
    const properties = vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => {
      if (path === "/Evil/API/Blocks") return { ModuleTypes: moduleTypes };
      if (path === "/Evil/Engine/Patch/Neural_Amp_Modeler") return { On: true, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" };
      if (path !== "/Evil/Engine/Patch/Chain") return { On: path !== "/Evil/Engine/Patch/Amp" };
      chainReads++;
      if (chainReads === 1) return { ModuleType1: 55 };
      if (chainReads === 2) return { ModuleType1: 55, ModuleType5: 19, ModuleType6: 9 };
      return { Routing: 0, ModuleType2: 21, ModuleType6: 2, ModuleType7: 19, ModuleType8: 9, ModuleType10: 39 };
    });
    vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });

    await useAppStore.getState().auditionTone(tone3000);

    expect(properties).toHaveBeenCalledWith("/Evil/API/Blocks");
    expect(chainReads).toBeGreaterThanOrEqual(3);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [1, 21]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [6, 19]);
    expect(call).toHaveBeenCalledWith("/Evil/Engine/Patch/Chain", "setModuleTypeInternal", [9, 39]);
    expect(useAppStore.getState().testRigReturn).toMatchObject({ testRigApplied: true, testRigMessage: expect.stringMatching(/Loaded A2 model\.nam in the Neural Amp Modeler host/) });
  });

  it("does not leave a false session when the demo fails to start", async () => {
    vi.spyOn(deviceApi, "callMethod").mockRejectedValue(new Error("device rejected demo"));
    await expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow("device rejected demo");

    expect(useAppStore.getState()).toMatchObject({ auditioningToneId: null, auditionBusy: false, auditionError: "device rejected demo", toneError: null, testRigReturn: null });
  });

  it("stops the temporary demo when applying its surrounding FX fails", async () => {
    const moduleTypes = Array.from({ length: 60 }, () => "");
    Object.assign(moduleTypes, { 0: "Empty Slot", 2: "Amp", 9: "IR", 19: "Neural Amp Modeler", 21: "Gray Comp", 39: "Spring Reverb" });
    useAppStore.setState({ selectedTestRigId: testRigTemplates[0].id, liveSubtree: { "/Evil/API/Blocks": { value: { ModuleTypes: moduleTypes }, meta: { properties: {} } } } });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => path === "/Evil/Engine/Patch/Neural_Amp_Modeler"
      ? { On: true, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" }
      : { ModuleType5: 19, ModuleType6: 9 });
    vi.spyOn(deviceApi, "setProperties").mockRejectedValue(new Error("FX write rejected"));

    await expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow("FX write rejected");

    expect(call).toHaveBeenCalledWith("/Evil/API/Tone3000", "stopDemo", []);
    expect(useAppStore.getState()).toMatchObject({ auditioningToneId: null, auditionBusy: false, testRigReturn: null, auditionError: "FX write rejected" });
  });

  it("stops the previous provider before switching tones and preserves the original return rig", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    await useAppStore.getState().auditionTone(tone3000);
    const original = useAppStore.getState().testRigReturn;
    await useAppStore.getState().auditionTone(cloudTone);

    expect(call.mock.calls.slice(-2)).toEqual([
      ["/Evil/API/Tone3000", "stopDemo", []],
      ["/Evil/Cloud/Master", "startCloneDemo", ["cloud-42"]],
    ]);
    expect(useAppStore.getState().testRigReturn).toMatchObject({ id: original?.id, auditionSource: "HeadRush Cloud" });
    expect(useAppStore.getState().auditioningToneId).toBe(cloudTone.id);
  });

  it("finishes the session by stopping the provider and reloading the original rig", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    await useAppStore.getState().auditionTone(tone3000);
    await useAppStore.getState().finishToneTestSession();

    expect(call).toHaveBeenCalledWith("/Evil/API/Tone3000", "stopDemo", []);
    expect(call).toHaveBeenCalledWith("/Evil/API/Rigs", "loadRigConfirm", [demoRigs[0].id, ""]);
    expect(useAppStore.getState()).toMatchObject({ auditioningToneId: null, auditionBusy: false, testRigReturn: null });
  });

  it("keeps the return target available when restoration fails", async () => {
    const call = vi.spyOn(deviceApi, "callMethod");
    call.mockResolvedValueOnce({ status: 200, body: {} });
    await useAppStore.getState().auditionTone(tone3000);
    call.mockResolvedValueOnce({ status: 200, body: {} }).mockRejectedValueOnce(new Error("restore failed"));

    await expect(useAppStore.getState().finishToneTestSession()).rejects.toThrow("restore failed");
    expect(useAppStore.getState().testRigReturn).toMatchObject({ id: demoRigs[0].id });
    expect(useAppStore.getState()).toMatchObject({ auditioningToneId: null, auditionBusy: false, auditionError: "restore failed" });
  });

  it("rejects disconnected devices but allows a basic demo without a reference plan", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    useAppStore.setState({ device: null });
    await expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow("Connect Flex Prime");

    useAppStore.setState({ device: structuredClone(demoDevice), selectedTestRigId: "missing" });
    await expect(useAppStore.getState().auditionTone(tone3000)).resolves.toBeUndefined();
    expect(call).toHaveBeenCalledWith("/Evil/API/Tone3000", "startDemo", expect.any(Array));
  });

  it("checks provider login before disturbing an active session", async () => {
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    useAppStore.setState({
      liveSubtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: false }, meta: { properties: {} } } },
      auditioningToneId: cloudTone.id,
      testRigReturn: { id: demoRigs[0].id, name: demoRigs[0].name, auditionSource: "HeadRush Cloud" },
    });
    await expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow("Sign in");
    expect(call).not.toHaveBeenCalled();
    expect(useAppStore.getState().auditioningToneId).toBe(cloudTone.id);
  });

  it("resolves model readiness before creating an unsaved-state snapshot", async () => {
    const snapshot = vi.spyOn(useAppStore.getState(), "createSnapshot");
    useAppStore.setState({ toneModels: { [tone3000.id]: [] }, selectedToneModelId: null, toneModelError: "No compatible model" });
    await expect(useAppStore.getState().auditionTone(tone3000)).rejects.toThrow("No compatible model");
    expect(snapshot).not.toHaveBeenCalled();
  });
});
