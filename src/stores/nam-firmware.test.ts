import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs, testRigTemplates } from "../data/demo-data";
import type { HeadRushSubtree, RigBlock, ToneModel } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { migratePersistedTestRigNamControls, useAppStore } from "./app-store";

const chainPath = "/Evil/Engine/Patch/Chain";
const host1 = "/Evil/Engine/Patch/Neural_Amp_Modeler";
const host2 = `${host1}_2`;
const modelA1: ToneModel = { id: "a1", remoteId: 1, name: "Legacy", architecture: "A1", url: "https://tone3000.com/legacy.nam" };
const modelA2: ToneModel = { id: "a2", remoteId: 2, name: "Modern", architecture: "A2", url: "https://tone3000.com/modern.nam" };

function multiNamFixture(doubled = false) {
  const rig = structuredClone(testRigTemplates[0]);
  rig.namInstance = 2;
  rig.namPreference = "nam2-lite";
  rig.blocks = rig.blocks.filter((block) => ["input", "output"].includes(block.category) || block.name === "Capture slot");
  const capture = rig.blocks.find((block) => block.name === "Capture slot")!;
  capture.parameters = [
    { id: "Output", sourceProperty: "Output", label: "Output", value: 6, normalized: true, min: -40, max: 40, writable: true },
    { id: "Doubling", label: "Doubling", value: doubled, writable: true },
    ...(doubled ? [{ id: "LoadedClone2", label: "Second NAM", value: "Neural Amp Modeler/User/second.nam", writable: true, deviceFile: { fileType: 9, startPath: "Neural Amp Modeler" } }] : []),
  ];
  const extra: RigBlock = { id: "additional-nam", name: "Neural Amp Modeler", model: "Neural Amp Modeler", category: "clone", color: "#ffaa66", enabled: true, slot: 2, parameters: [
    { id: "LoadedClone", label: "NAM file", value: "Neural Amp Modeler/User/pedal.nam", writable: true, deviceFile: { fileType: 9, startPath: "Neural Amp Modeler" } },
    { id: "Output", label: "Output", value: -4, normalized: true, min: -40, max: 40, writable: true },
    { id: "LightMode", label: "Lite", value: false, writable: true },
    { id: "Doubling", label: "Doubling", value: doubled, writable: true },
    ...(doubled ? [{ id: "LoadedClone2", label: "Second NAM", value: "Neural Amp Modeler/User/boost.nam", writable: true, deviceFile: { fileType: 9, startPath: "Neural Amp Modeler" } }] : []),
  ] };
  rig.blocks.push(extra);
  const values: Record<string, Record<string, unknown>> = {
    [chainPath]: { Routing: 0, ModuleType1: 1 },
    [host1]: { On: true, Output: .5, LoadedClone: "Neural Amp Modeler/temporary.nam", FileMissing: "", Doubling: false, LoadedClone2: "", FileMissing2: "", LightMode: false, LightMode2: false, OutputMode: 2, CalibrateInput: false },
    [host2]: { On: true, Output: .5, LoadedClone: "", FileMissing: "", Doubling: false, LoadedClone2: "", FileMissing2: "", LightMode: false, LightMode2: false, OutputMode: 2, CalibrateInput: false },
  };
  const bool = { type: "boolean" };
  const schema = { On: bool, Doubling: bool, LightMode: bool, LightMode2: bool, CalibrateInput: bool,
    Output: { type: "number", minimum: -40, maximum: 40 }, OutputMode: { type: "integer", "x-options": { strings: ["Raw", "Calibrated", "Normalize"] } },
    LoadedClone: { type: "string", "x-options": { fileType: 9, startPath: "Neural Amp Modeler" } },
    LoadedClone2: { type: "string", "x-options": { fileType: 9, startPath: "Neural Amp Modeler" } },
    FileMissing: { type: "string", readOnly: true }, FileMissing2: { type: "string", readOnly: true },
  };
  const subtree: HeadRushSubtree = { "/Evil/API/Blocks": { value: { ModuleTypes: ["Empty Slot", "Neural Amp Modeler", "Neural Amp Modeler 2"] } },
    [host1]: { meta: { properties: schema }, value: { ...values[host1], disabled: ["LoadedClone2", "LightMode2"] } },
    [host2]: { meta: { properties: schema }, value: { ...values[host2], disabled: ["LoadedClone2", "LightMode2"] } },
  };
  const tone = { id: "modern-tone", title: "Modern", author: "QA", description: "amp", captureType: "amp" as const, detectedType: "amp" as const, tags: ["amp"], rating: 0, downloads: 0, source: "Tone3000" as const, remoteId: 7, imageColor: "#ffaa66" };
  useAppStore.setState({ device: { ...demoDevice, status: "ready" }, liveSubtree: subtree, liveSnapshot: null, rigs: structuredClone(demoRigs),
    testRigs: [rig], selectedTestRigId: rig.id, tones: [tone], toneModels: { [tone.id]: [modelA1, modelA2] }, selectedToneId: tone.id, selectedToneModelId: modelA1.id,
    auditioningToneId: tone.id, captureOverride: "auto", testRigSyncBusy: false, testRigSyncError: null,
    testRigReturn: { id: "original", name: "Original", audition: { tone, model: modelA2, captureFile: { path: host1, property: "LoadedClone", value: "Neural Amp Modeler/temporary.nam" } } },
  });
  vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
  vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => structuredClone(values[path] ?? {}));
  vi.spyOn(deviceApi, "subtree").mockImplementation(async (path = "") => path && subtree[path] ? { [path]: { ...subtree[path], value: {
    ...values[path], disabled: values[path].Doubling ? [] : ["LoadedClone2", "LightMode2"],
  } } } : subtree);
  const writes = vi.spyOn(deviceApi, "setProperties").mockImplementation(async (path, properties) => {
    values[path] ??= {};
    Object.assign(values[path], properties);
    return { status: 200, body: {} };
  });
  const methods = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: true });
  return { rig, capture, extra, values, writes, methods };
}

describe("5.2 NAM orchestration", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); localStorage.clear(); });
  afterEach(async () => { useAppStore.setState({ auditioningToneId: null }); await vi.runAllTimersAsync(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("moves the provider file to host 2 and retains a different file and level on host 1", async () => {
    const fixture = multiNamFixture();
    const sync = useAppStore.getState().syncActiveTestRig();
    await vi.runAllTimersAsync();
    await sync;
    expect(fixture.values[host2]).toMatchObject({ LoadedClone: "Neural Amp Modeler/temporary.nam", Output: .575, LightMode: true });
    expect(fixture.values[host1]).toMatchObject({ LoadedClone: "Neural Amp Modeler/User/pedal.nam", Output: .45 });
    expect(useAppStore.getState().testRigReturn?.audition?.captureFile?.path).toBe(host2);
    expect(fixture.values[chainPath]).toMatchObject({ ModuleType3: 1, ModuleType7: 2, ModuleType1: 0 });
  });

  it("refreshes doubled host schemas before binding both second files and enforces four Lite lanes", async () => {
    const fixture = multiNamFixture(true);
    const sync = useAppStore.getState().syncActiveTestRig();
    await vi.runAllTimersAsync();
    await sync;
    expect(fixture.values[host1]).toMatchObject({ Doubling: true, LoadedClone2: "Neural Amp Modeler/User/boost.nam", LightMode: true, LightMode2: true });
    expect(fixture.values[host2]).toMatchObject({ Doubling: true, LoadedClone2: "Neural Amp Modeler/User/second.nam", LightMode: true, LightMode2: true });
    expect(fixture.writes.mock.calls.some(([path, properties]) => path === host2 && properties.LoadedClone === "Neural Amp Modeler/temporary.nam")).toBe(true);
  });

  it("keeps host preferences and chain position across subsequent block edits", () => {
    multiNamFixture();
    useAppStore.setState({ auditioningToneId: null });
    useAppStore.getState().updateTestRigDetails({ namPreference: "nam2", namInstance: 2, captureSlot: 4 });
    useAppStore.getState().updateTestRigBlock("additional-nam", { enabled: false });
    const rig = useAppStore.getState().testRigs[0];
    expect(rig).toMatchObject({ namPreference: "nam2", namInstance: 2, captureSlot: 4 });
    expect(rig.blocks.find((block) => block.name === "Capture slot")?.slot).toBe(4);
    expect(useAppStore.getState().selectedToneModelId).toBe(modelA2.id);
  });

  it("preserves user-owned second NAM files during persisted-plan repair", () => {
    const fixture = multiNamFixture(true);
    const repaired = migratePersistedTestRigNamControls([fixture.rig])[0];
    const capture = repaired.blocks.find((block) => block.name === "Capture slot")!;
    expect(capture.parameters.find((parameter) => parameter.id === "LoadedClone2")).toMatchObject({ value: "Neural Amp Modeler/User/second.nam", deviceFile: { fileType: 9 } });
    expect(capture.parameters.some((parameter) => parameter.id === "LoadedClone")).toBe(false);
  });

  it("allocates the unused NAM host instead of moving an existing standard-chain host", async () => {
    const fixture = multiNamFixture();
    useAppStore.setState({ auditioningToneId: null, rigs: [{ ...demoRigs[0], blocks: [{ ...fixture.extra, slot: 2, moduleTypeId: 1, sourcePath: host1 }] }], selectedRigId: demoRigs[0].id });
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
    await useAppStore.getState().addBlock({ ...fixture.extra, id: "new", slot: 5, moduleTypeId: 1 });
    expect(fixture.methods).toHaveBeenCalledWith(chainPath, "setModuleTypeInternal", [5, 2]);
    expect(fixture.values[chainPath].ModuleType6).toBe(2);
  });

  it("reassigns the extra host's preview path and preserves its file when the audition host changes", () => {
    const fixture = multiNamFixture();
    useAppStore.setState({ auditioningToneId: null });
    useAppStore.getState().updateTestRigDetails({ namInstance: 1 });
    const extra = useAppStore.getState().testRigs[0].blocks.find((block) => block.id === fixture.extra.id)!;
    expect(extra).toMatchObject({ model: "Neural Amp Modeler 2", sourcePath: host2, moduleTypeId: 2 });
    expect(extra.parameters.find((parameter) => parameter.id === "LoadedClone")).toMatchObject({ value: "Neural Amp Modeler/User/pedal.nam", deviceObjectPath: host2 });
  });

  it("rejects a third independent Test Rig NAM host before changing the saved plan", () => {
    const fixture = multiNamFixture();
    useAppStore.setState({ auditioningToneId: null });
    useAppStore.getState().addTestRigBlock({ ...fixture.extra, id: "third-host", slot: 4 }, 4);
    expect(useAppStore.getState().testRigs[0].blocks.some((block) => block.id === "third-host")).toBe(false);
  });

  it("restores both Full preferences when reducing a four-lane rig to two single hosts", async () => {
    const fixture = multiNamFixture();
    fixture.rig.namPreference = "nam2";
    Object.assign(fixture.values[host1], { Doubling: true, LightMode: true, LightMode2: true });
    Object.assign(fixture.values[host2], { Doubling: true, LightMode: true, LightMode2: true });
    const subtree = vi.mocked(deviceApi.subtree).getMockImplementation()!;
    vi.mocked(deviceApi.subtree).mockImplementation(async (path = "") => {
      const result = await subtree(path) as HeadRushSubtree;
      const lanes = [host1, host2].reduce((count, host) => count + (fixture.values[host].Doubling ? 2 : 1), 0);
      if (result[path]?.value && lanes > 2) result[path].value!.disabled = ["LightMode", "LightMode2"];
      return result;
    });
    const sync = useAppStore.getState().syncActiveTestRig();
    await vi.runAllTimersAsync();
    await sync;
    expect(fixture.values[host1]).toMatchObject({ Doubling: false, LightMode: false });
    expect(fixture.values[host2]).toMatchObject({ Doubling: false, LightMode: false });
  });

  it("loads the A2 file before applying Full mode to a host previously carrying A1", async () => {
    const fixture = multiNamFixture();
    fixture.rig.namPreference = "nam2";
    Object.assign(fixture.values[host2], { LoadedClone: "Neural Amp Modeler/legacy.nam", LightMode: true });
    const subtree = vi.mocked(deviceApi.subtree).getMockImplementation()!;
    vi.mocked(deviceApi.subtree).mockImplementation(async (path = "") => {
      const result = await subtree(path) as HeadRushSubtree;
      if (result[path]?.value && String(fixture.values[path].LoadedClone).endsWith("legacy.nam")) result[path].value!.disabled = ["LightMode"];
      return result;
    });
    const sync = useAppStore.getState().syncActiveTestRig();
    await vi.runAllTimersAsync();
    await sync;
    expect(fixture.values[host2]).toMatchObject({ LoadedClone: "Neural Amp Modeler/temporary.nam", LightMode: false });
  });

  it("rejects a known A1 model with multiple NAM hosts before starting a provider demo", async () => {
    const fixture = multiNamFixture();
    fixture.rig.namPreference = "other";
    fixture.rig.namOtherModel = "A1";
    const demo = vi.spyOn(deviceApi, "startToneDemo");
    await expect(useAppStore.getState().auditionTone(useAppStore.getState().tones[0])).rejects.toThrow("NAM A1 supports one native capture");
    expect(demo).not.toHaveBeenCalled();
  });
});
