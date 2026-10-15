import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs, testRigTemplates } from "../data/demo-data";
import type { CloudTone, HeadRushSubtree, ToneModel } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore, type AuditionRigSaveOptions } from "./app-store";

const tone3000: CloudTone = {
  id: "tone-3000", title: "Test amp", author: "QA", description: "Amp capture", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 0, downloads: 0, source: "Tone3000", imageColor: "#38d", remoteId: 77, remoteKind: "tone-group",
};
const cloudTone: CloudTone = {
  ...tone3000, id: "cloud-clone", title: "Cloud clone", source: "HeadRush Cloud", remoteId: "cloud-42", remoteKind: "clone",
};
const model: ToneModel = { id: "model-1", remoteId: 123, name: "A2 model", architecture: "A2", url: "https://models.test/model.nam" };

const chainPath = "/Evil/Engine/Patch/Chain";
const namPath = "/Evil/Engine/Patch/Neural_Amp_Modeler";
const compPath = "/Evil/Engine/Patch/Gray_Comp";
const irPath = "/Evil/Engine/Patch/IR";
const verbPath = "/Evil/Engine/Patch/Spring_Reverb";

/** A device fixture that retains emitted parameters and snapshots the live
 * patch at save-as, rather than treating every successful HTTP write as proof. */
function reflectedAuditionFixture(options: { ignore?: { path: string; property: string }; resetOnDurableBind?: boolean; captureOnly?: boolean } = {}) {
  const moduleTypes = ["Empty Slot", "Neural Amp Modeler", "Gray Comp", "IR", "Spring Reverb"];
  const rig = structuredClone(testRigTemplates[0]);
  rig.id = "qa-verifiable-rig";
  rig.blocks = rig.blocks.filter((block) => ["input", "output"].includes(block.category) || block.name === "Capture slot"
    || (!options.captureOnly && ["Gray Comp", "IR", "Spring Reverb"].includes(block.model)));
  const nam = rig.blocks.find((block) => block.name === "Capture slot")!;
  nam.parameters.find((parameter) => parameter.id === "Output")!.value = 8;
  const comp = rig.blocks.find((block) => block.model === "Gray Comp");
  if (comp) comp.enabled = false;
  const device: Record<string, Record<string, unknown>> = {
    [chainPath]: { Routing: 0, ModuleType7: 1, ...(!options.captureOnly ? { ModuleType2: 2, ModuleType8: 3, ModuleType10: 4 } : {}) },
    [namPath]: { On: true, Input: .5, Output: .5, Threshold: .2, Gate: false, EQ: false, Bass: .5, Middle: .5, Treble: .5, Normalize: false, LightMode: false, LoadedClone: "temp-audition.nam", FileMissing: "" },
    [compPath]: { On: true, Sustain: .8, Level: .8 },
    [irPath]: { On: true, IR: "", FileMissing: "" },
    [verbPath]: { On: true, Mix: .8 },
    "/Evil/Engine/Patch/Rig": { Tempo: .5, TempoFromMaster: true },
  };
  const bool = { type: "boolean" } as const;
  const number = (minimum: number, maximum: number) => ({ type: "number" as const, minimum, maximum });
  const subtree: HeadRushSubtree = {
    "/Evil/API/Blocks": { value: { ModuleTypes: moduleTypes } },
    [namPath]: { meta: { properties: {
      On: bool, Input: number(-20, 20), Output: number(-40, 40), Threshold: number(-100, 0),
      Gate: bool, EQ: bool, Bass: number(0, 10), Middle: number(0, 10), Treble: number(0, 10), Normalize: bool, LightMode: bool,
      LoadedClone: { type: "string" }, FileMissing: { type: "string" },
    } } },
    [compPath]: { meta: { properties: { On: bool, Sustain: number(0, 100), Level: number(0, 100) } } },
    [irPath]: { meta: { properties: { On: bool, IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } }, FileMissing: { type: "string" }, Mix: number(0, 100) } } },
    [verbPath]: { meta: { properties: { On: bool, Mix: number(0, 100) } } },
  };
  for (const [path, object] of Object.entries(subtree)) object.value ??= { ...device[path] };
  let savedName = "";
  const storedFiles: string[] = [];
  const savedPatches: Array<Record<string, Record<string, unknown>>> = [];
  useAppStore.setState({
    device: { ...structuredClone(demoDevice), status: "ready" }, capabilities: null,
    liveSubtree: subtree, liveSnapshot: null, rigs: structuredClone(demoRigs), setlists: [],
    testRigs: [rig], selectedTestRigId: rig.id, tones: [tone3000], toneModels: { [tone3000.id]: [model] }, selectedToneModelId: model.id,
    captureOverride: "auto", auditioningToneId: tone3000.id, auditionBusy: false, testRigSyncBusy: false, testRigSyncError: null,
    testRigReturn: { id: demoRigs[0].id, name: demoRigs[0].name, auditionSource: "Tone3000", audition: {
      tone: structuredClone(tone3000), model: structuredClone(model), captureFile: { path: namPath, property: "LoadedClone", value: "temp-audition.nam" },
    } },
  });
  vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
  vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
  vi.spyOn(useAppStore.getState(), "refreshFull").mockResolvedValue();
  vi.spyOn(deviceApi, "subtree").mockImplementation(async (path = "") => subtree[path] ? { [path]: structuredClone(subtree[path]) } : {});
  const reads = vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => path === "/Evil/API/Rigs"
    ? { loadedColor: 1, ...device[path], loadedName: savedName || "Original", loadedID: savedName ? "saved-rig" : "original-rig", AllRigNames: savedName ? [savedName] : [], AllRigIds: savedName ? ["saved-rig"] : [] }
    : structuredClone(device[path] ?? {}));
  const writes = vi.spyOn(deviceApi, "setProperties").mockImplementation(async (path, values) => {
    if (options.resetOnDurableBind && path === namPath && Object.keys(values).length === 1 && typeof values.LoadedClone === "string") {
      device[namPath].Output = .5;
      device[namPath].On = false;
      device[verbPath].Mix = .9;
      device[chainPath].Routing = 1;
    }
    device[path] ??= {};
    for (const [property, value] of Object.entries(values)) {
      if (options.ignore?.path === path && options.ignore.property === property) continue;
      device[path][property] = value;
    }
    return { status: 200, body: {} };
  });
  vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: true });
  vi.spyOn(deviceApi, "listDeviceFiles").mockImplementation(async () => [...storedFiles]);
  const download = vi.spyOn(deviceApi, "downloadTone").mockImplementation(async (_tone, _model, name) => { storedFiles.push(`${name}.nam`); });
  vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
  const save = vi.spyOn(deviceApi, "saveRigAs").mockImplementation(async (name) => { savedPatches.push(structuredClone(device)); savedName = name; });
  return { device, subtree, rig, nam, reads, writes, download, save, savedPatches };
}

describe("complete Test Rig parameter confirmation", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    [namPath, "Output"], [namPath, "Normalize"], [compPath, "Level"], [verbPath, "Mix"],
  ])("refuses a successful HTTP acknowledgement that drops %s %s", async (path, property) => {
    const fixture = reflectedAuditionFixture({ ignore: { path, property } });
    const syncing = expect(useAppStore.getState().syncActiveTestRig()).rejects.toThrow(new RegExp(property + " settings"));
    await vi.runAllTimersAsync();
    await syncing;
    expect(useAppStore.getState().testRigSyncError).toContain(property);
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("refuses an IR whose reflected filename matches but the decoder reports FileMissing", async () => {
    const fixture = reflectedAuditionFixture();
    fixture.device[irPath].FileMissing = "Decoder rejected the file";
    const syncing = expect(useAppStore.getState().syncActiveTestRig()).rejects.toThrow(/Decoder rejected the file/);
    await vi.runAllTimersAsync();
    await syncing;
    expect(fixture.device[irPath].IR).toBe(fixture.rig.blocks.find((block) => block.model === "IR")!.parameters.find((parameter) => parameter.id === "IR")!.value);
  });

  it.each([
    [namPath, "LoadedClone", "Neural Amp Modeler/User/A2 model.nam"],
    [irPath, "IR", "Impulse Responses/User/CT-Fend312EMFDS-4217B.wav"],
  ])("rejects %s %s from a different folder even when its basename and FileMissing match", async (path, property, wrongFile) => {
    const fixture = reflectedAuditionFixture();
    const target = structuredClone(useAppStore.getState().testRigReturn!);
    target.audition!.captureFile!.value = "Neural Amp Modeler/Tone 3000/A2 model.nam";
    useAppStore.setState({ testRigReturn: target });
    const read = fixture.reads.getMockImplementation()!;
    fixture.reads.mockImplementation(async (requestedPath) => {
      const values = await read(requestedPath);
      return requestedPath === path ? { ...values, [property]: wrongFile, FileMissing: "" } : values;
    });
    const syncing = expect(useAppStore.getState().syncActiveTestRig()).rejects.toThrow(/did not finish loading/);
    await vi.runAllTimersAsync();
    await syncing;
    expect(fixture.writes).toHaveBeenCalledWith(path, expect.objectContaining({
      [property]: path === namPath ? target.audition!.captureFile!.value : "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav",
    }));
    expect(useAppStore.getState().testRigSyncError).toMatch(/did not finish loading/);
  });

  it("refuses parameter-bearing modules when reflection cannot provide their schema", async () => {
    const fixture = reflectedAuditionFixture();
    delete fixture.subtree[namPath].meta;
    const syncing = expect(useAppStore.getState().syncActiveTestRig()).rejects.toThrow(/did not expose the settings for Capture slot/);
    await vi.runAllTimersAsync();
    await syncing;
    expect(fixture.writes.mock.calls.filter(([path]) => path === namPath)).toEqual([]);
  });

  it("retries a delayed parameter reflection and tolerates float serialization noise", async () => {
    const fixture = reflectedAuditionFixture();
    const read = fixture.reads.getMockImplementation()!;
    let reads = 0;
    fixture.reads.mockImplementation(async (path) => {
      const values = await read(path);
      const configured = fixture.writes.mock.calls.some(([writtenPath, properties]) => writtenPath === namPath && "Output" in properties);
      return path === namPath && configured ? { ...values, Output: ++reads === 1 ? .5 : Number(values.Output) + 1e-8 } : values;
    });
    const syncing = useAppStore.getState().syncActiveTestRig();
    await vi.runAllTimersAsync();
    await syncing;
    expect(fixture.writes.mock.calls.filter(([path]) => path === namPath)).toHaveLength(2);
    expect(useAppStore.getState().testRigSyncError).toBeNull();
  });

  it("applies NAM output and verifies its file when the Test Rig has no surrounding FX", async () => {
    const fixture = reflectedAuditionFixture({ captureOnly: true });
    const syncing = useAppStore.getState().syncActiveTestRig();
    await vi.runAllTimersAsync();
    await syncing;
    expect(fixture.device[namPath]).toMatchObject({ On: true, Output: .6, LoadedClone: "temp-audition.nam" });
    expect(useAppStore.getState().testRigReturn).toMatchObject({ testRigApplied: true, audition: { captureFile: { path: namPath, value: "temp-audition.nam" } } });
  });

  it("saves the complete live chain and levels after permanent NAM loading resets host settings", async () => {
    const fixture = reflectedAuditionFixture({ resetOnDurableBind: true });
    const options: AuditionRigSaveOptions = { name: "Complete QA rig", color: 4, tempoMode: "fixed", tempoBpm: 120, programChange: -1 };
    const saving = expect(useAppStore.getState().saveAuditionRig(options)).resolves.toMatchObject({ name: options.name, rigId: "saved-rig" });
    await vi.runAllTimersAsync();
    await saving;
    expect(fixture.savedPatches).toHaveLength(1);
    const saved = fixture.savedPatches[0];
    expect(saved[namPath]).toMatchObject({ On: true, Output: .6, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" });
    expect(saved[compPath]).toMatchObject({ On: false, Sustain: .25, Level: .52 });
    expect(saved[verbPath]).toMatchObject({ On: true, Mix: .15 });
    expect(saved[irPath]).toMatchObject({ On: true, IR: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav", FileMissing: "" });
    expect(saved[chainPath].Routing).toBe(0);
    expect(Array.from({ length: 14 }, (_, slot) => saved[chainPath][`ModuleType${slot + 1}`] ?? 0)).toEqual([0, 2, 0, 0, 0, 0, 1, 3, 0, 4, 0, 0, 0, 0]);
    expect(saved["/Evil/Engine/Patch/Rig"]).toMatchObject({ TempoFromMaster: false, Tempo: (120 - 30) / 210 });
  });
});

describe("ToneMod audition lifecycle", () => {
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
        "/Evil/Engine/Patch/Amp": { meta: { properties: { On: { type: "boolean" } } } },
        "/Evil/Engine/Patch/Neural_Amp_Modeler": { value: { On: true }, meta: { properties: { On: { type: "boolean" } } } },
        "/Evil/Engine/Patch/IR": { value: { On: true, IR: "", IR2: "", Mix: 1 }, meta: { properties: { On: { type: "boolean" }, IR: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } }, IR2: { type: "string", "x-options": { fileType: 2, startPath: "Impulse Responses" } }, Mix: { type: "number", minimum: 0, maximum: 100 } } } },
        "/Evil/Engine/Patch/Spring_Reverb": { value: { On: true, Mix: .3, order: ["Mix"], labels: ["Mix"] }, meta: { properties: { On: { type: "boolean" }, Mix: { type: "number", minimum: 0, maximum: 100 } } } },
      },
    });
    const call = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: {} });
    let chainReads = 0;
    let grayCompReads = 0;
    let irReads = 0;
    const moduleWrites: Record<string, Record<string, unknown>> = {};
    vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => {
      if (path === "/Evil/Engine/Patch/Neural_Amp_Modeler") return { On: true, LoadedClone: "Neural Amp Modeler/Tone 3000/A2 model.nam", FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Gray_Comp") return { ...moduleWrites[path], On: ++grayCompReads > 1 };
      if (path === "/Evil/Engine/Patch/IR") return ++irReads < 3
        ? { ...moduleWrites[path], On: true, IR: "", FileMissing: "" }
        : { ...moduleWrites[path], On: true, IR: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav", FileMissing: "" };
      if (path !== "/Evil/Engine/Patch/Chain") return { ...moduleWrites[path], On: path !== "/Evil/Engine/Patch/Amp" };
      chainReads++;
      return chainReads === 1
        ? { ModuleType1: 55, ModuleType5: 19, ModuleType6: 9 }
        : { Routing: 0, ModuleType2: 21, ModuleType6: 2, ModuleType7: 19, ModuleType8: 9, ModuleType10: 39 };
    });
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockImplementation(async (path, values) => {
      moduleWrites[path] = { ...moduleWrites[path], ...values };
      return { status: 200, body: {} };
    });
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
    expect(setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Neural_Amp_Modeler", expect.objectContaining({ On: true }));
    expect(useAppStore.getState().testRigReturn?.audition?.captureFile?.value).toBe("Neural Amp Modeler/Tone 3000/A2 model.nam");
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
        "/Evil/Engine/Patch/Amp": { meta: { properties: { On: { type: "boolean" } } } },
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
        "/Evil/Engine/Patch/Amp": { meta: { properties: { On: { type: "boolean" } } } },
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
    vi.spyOn(deviceApi, "subtree").mockImplementation(async (path = "") => ({ [path]: { meta: { properties: { On: { type: "boolean" } } } } }));
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
