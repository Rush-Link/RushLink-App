import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice, demoRigs, demoSetlists } from "../data/demo-data";
import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore, type AuditionRigSaveOptions } from "./app-store";

const activeTone: CloudTone = {
  id: "active-tone",
  title: "Auditioned Amp",
  author: "QA",
  description: "Active TonePilot audition",
  captureType: "amp",
  detectedType: "amp",
  tags: ["amp"],
  rating: 0,
  downloads: 0,
  source: "Tone3000",
  imageColor: "#38d",
  remoteId: 77,
  remoteKind: "tone-group",
};

const activeModel: ToneModel = {
  id: "active-model",
  remoteId: 901,
  name: "Exact active NAM",
  architecture: "A2",
  url: "https://tone3000.example/models/exact-active.nam",
};

const activeCapture = {
  path: "/Evil/Engine/Patch/Neural_Amp_Modeler",
  property: "LoadedClone" as const,
  value: "Neural Amp Modeler/Tone 3000 Demo/exact-active.nam",
};

const durableTone3000Path = "Neural Amp Modeler/Tone 3000/Exact active NAM.nam";

const saveOptions: AuditionRigSaveOptions = {
  name: "  Saved Audition  ",
  color: 4,
  tempoMode: "fixed",
  tempoBpm: 126,
  programChange: 11,
};

const returnTarget = {
  id: demoRigs[0].id,
  name: demoRigs[0].name,
  snapshotId: "return-snapshot",
  auditionSource: "Tone3000" as const,
  testRigApplied: true,
  audition: {
    tone: structuredClone(activeTone),
    model: structuredClone(activeModel),
    captureFile: { ...activeCapture },
  },
};

function resetActiveAudition() {
  localStorage.clear();
  useAppStore.setState({
    device: { ...demoDevice, status: "ready" },
    capabilities: null,
    liveSubtree: null,
    liveSnapshot: null,
    rigs: structuredClone(demoRigs),
    selectedRigId: demoRigs[0].id,
    setlists: structuredClone(demoSetlists),
    selectedSetlistId: demoSetlists[0].id,
    tones: [activeTone],
    toneModels: { [activeTone.id]: [activeModel] },
    selectedToneId: activeTone.id,
    selectedToneModelId: activeModel.id,
    auditioningToneId: activeTone.id,
    auditionBusy: false,
    auditionError: null,
    testRigReturn: { ...returnTarget },
    diagnostics: [],
  });
}

function mockSuccessfulRigSave(savedRigId = "saved-rig") {
  let rigRead = 0;
  const properties = vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => {
    if (path === activeCapture.path) return { On: true, LoadedClone: durableTone3000Path, FileMissing: "" };
    if (path === "/Evil/Engine/Patch/Rig") return { TempoFromMaster: true, Tempo: 0.42 };
    if (path !== "/Evil/API/Rigs") return {};
    rigRead += 1;
    if (rigRead === 1) return {
      AllRigNames: demoRigs.map((rig) => rig.name),
      AllRigIds: demoRigs.map((rig) => rig.id),
      availableProgMIDICC: [0, 1, 11, 12, 127],
      loadedProgMIDICC: -1,
    };
    return {
      loadedID: savedRigId,
      loadedName: "Saved Audition",
      AllRigNames: [...demoRigs.map((rig) => rig.name), "Saved Audition"],
      AllRigIds: [...demoRigs.map((rig) => rig.id), savedRigId],
    };
  });
  const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
  const downloadTone = vi.spyOn(deviceApi, "downloadTone").mockResolvedValue();
  const canSaveNewRig = vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
  const saveRigAs = vi.spyOn(deviceApi, "saveRigAs").mockResolvedValue();
  const getSetlist = vi.spyOn(deviceApi, "getSetlist");
  const saveSetlistDocument = vi.spyOn(deviceApi, "saveSetlistDocument").mockResolvedValue("saved-setlist");
  const refreshFull = vi.spyOn(useAppStore.getState(), "refreshFull").mockResolvedValue();
  const startToneDemo = vi.spyOn(deviceApi, "startToneDemo").mockResolvedValue();
  const stopToneDemo = vi.spyOn(deviceApi, "stopToneDemo").mockResolvedValue();
  return { properties, setProperties, downloadTone, canSaveNewRig, saveRigAs, getSetlist, saveSetlistDocument, refreshFull, startToneDemo, stopToneDemo };
}

function expectSessionPreserved() {
  expect(useAppStore.getState()).toMatchObject({
    auditioningToneId: activeTone.id,
    auditionBusy: false,
    auditionError: null,
    testRigReturn: {
      ...returnTarget,
      audition: {
        ...returnTarget.audition,
        captureFile: { ...activeCapture, value: expect.any(String) },
      },
    },
  });
}

describe("TonePilot save audition as a HeadRush rig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetActiveAudition();
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    vi.spyOn(deviceApi, "listDeviceFiles").mockResolvedValue([]);
    vi.spyOn(useAppStore.getState(), "syncActiveTestRig").mockResolvedValue();
  });

  it("requires an active audition before making any device mutation", async () => {
    useAppStore.setState({ auditioningToneId: null });
    const properties = vi.spyOn(deviceApi, "properties");
    const setProperties = vi.spyOn(deviceApi, "setProperties");
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs");

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow(/Start an audition/i);

    expect(properties).not.toHaveBeenCalled();
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();
    expect(useAppStore.getState().auditionBusy).toBe(false);
  });

  it.each([
    ["colour below the device range", { color: 0 }, /valid HeadRush rig colour/i],
    ["colour above the device range", { color: 10 }, /valid HeadRush rig colour/i],
    ["fractional colour", { color: 2.5 }, /valid HeadRush rig colour/i],
    ["unknown tempo source", { tempoMode: "preset" as AuditionRigSaveOptions["tempoMode"] }, /valid rig tempo source/i],
    ["tempo below the device range", { tempoBpm: 29 }, /between 30 and 240 BPM/i],
    ["tempo above the device range", { tempoBpm: 241 }, /between 30 and 240 BPM/i],
    ["non-finite tempo", { tempoBpm: Number.NaN }, /between 30 and 240 BPM/i],
    ["MIDI value below Off", { programChange: -2 }, /MIDI Program Change/i],
    ["MIDI value above the device range", { programChange: 128 }, /MIDI Program Change/i],
    ["fractional MIDI value", { programChange: 4.5 }, /MIDI Program Change/i],
  ])("rejects %s before performing device I/O", async (_case, patch, message) => {
    const properties = vi.spyOn(deviceApi, "properties");
    const canSaveNewRig = vi.spyOn(deviceApi, "canSaveNewRig");
    const downloadTone = vi.spyOn(deviceApi, "downloadTone");
    const setProperties = vi.spyOn(deviceApi, "setProperties");
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs");
    const getSetlist = vi.spyOn(deviceApi, "getSetlist");

    await expect(useAppStore.getState().saveAuditionRig({ ...saveOptions, ...patch })).rejects.toThrow(message);

    expect(properties).not.toHaveBeenCalled();
    expect(canSaveNewRig).not.toHaveBeenCalled();
    expect(downloadTone).not.toHaveBeenCalled();
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();
    expect(getSetlist).not.toHaveBeenCalled();
    expect(useAppStore.getState().auditionBusy).toBe(false);
  });

  it("writes exact HeadRush rig options, saves the chain, and leaves the audition running", async () => {
    const mocks = mockSuccessfulRigSave();
    const laterSelection: ToneModel = { ...activeModel, id: "later-model", remoteId: 999, name: "Later selection", url: "https://tone3000.example/models/later.nam" };
    useAppStore.setState({
      tones: [{ ...activeTone, id: "later-tone", remoteId: 999, title: "Later catalogue choice" }],
      selectedToneId: "later-tone",
      toneModels: { [activeTone.id]: [laterSelection] },
      selectedToneModelId: laterSelection.id,
    });

    const result = await useAppStore.getState().saveAuditionRig(saveOptions);

    expect(mocks.properties).toHaveBeenNthCalledWith(1, "/Evil/API/Rigs");
    expect(mocks.properties).toHaveBeenNthCalledWith(2, activeCapture.path);
    expect(mocks.properties).toHaveBeenNthCalledWith(3, "/Evil/Engine/Patch/Rig");
    expect(mocks.properties).toHaveBeenNthCalledWith(4, "/Evil/API/Rigs");
    expect(mocks.canSaveNewRig).toHaveBeenCalledOnce();
    expect(mocks.downloadTone).toHaveBeenCalledWith(activeTone, activeModel, "Exact active NAM");
    expect(mocks.setProperties).toHaveBeenNthCalledWith(1, activeCapture.path, {
      LoadedClone: durableTone3000Path,
    });
    expect(mocks.setProperties).toHaveBeenNthCalledWith(2, "/Evil/API/Rigs", {
      loadedColor: 4,
      loadedProgMIDICC: 11,
    });
    expect(mocks.setProperties).toHaveBeenNthCalledWith(3, "/Evil/Engine/Patch/Rig", {
      TempoFromMaster: false,
      Tempo: expect.closeTo((126 - 30) / 210, 10),
    });
    expect(mocks.saveRigAs).toHaveBeenCalledWith("Saved Audition");
    expect(mocks.downloadTone.mock.invocationCallOrder[0]).toBeLessThan(mocks.saveRigAs.mock.invocationCallOrder[0]);
    expect(mocks.setProperties.mock.invocationCallOrder[2]).toBeLessThan(mocks.saveRigAs.mock.invocationCallOrder[0]);
    expect(mocks.getSetlist).not.toHaveBeenCalled();
    expect(mocks.saveSetlistDocument).not.toHaveBeenCalled();
    expect(mocks.refreshFull).toHaveBeenCalledWith("manual");
    expect(result).toMatchObject({ rigId: "saved-rig", name: "Saved Audition" });
    expect(result.warning).toBeUndefined();
    expect(mocks.startToneDemo).not.toHaveBeenCalled();
    expect(mocks.stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("downloads an extensionless native model name and binds the resulting .nam file before saving", async () => {
    const mocks = mockSuccessfulRigSave();
    mocks.downloadTone.mockRestore();
    const callMethod = vi.spyOn(deviceApi, "callMethod").mockImplementation(async (_path, method, args = []) => {
      if (method === "downloadModelToDevice") {
        expect(args).toEqual([activeModel.remoteId, activeModel.url, "Exact active NAM"]);
        // The device controls the suffix; passing a .nam filename here would
        // create a different file from the one the rig's host is loading.
        expect(`${args[2]}.nam`).toBe("Exact active NAM.nam");
        return { status: 200, body: { methodReturnValue: JSON.stringify({ success: true }) } };
      }
      throw new Error(`Unexpected device method: ${method}`);
    });

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).resolves.toMatchObject({ rigId: "saved-rig" });

    expect(callMethod).toHaveBeenCalledOnce();
    expect(mocks.setProperties).toHaveBeenCalledWith(activeCapture.path, { LoadedClone: durableTone3000Path });
    expect(mocks.saveRigAs).toHaveBeenCalledWith("Saved Audition");
    expect(callMethod.mock.invocationCallOrder[0]).toBeLessThan(mocks.saveRigAs.mock.invocationCallOrder[0]);
  });

  it("preserves existing NAM files from other models with the same display name", async () => {
    const mocks = mockSuccessfulRigSave();
    const storedModels = new Map([["Exact active NAM.nam", 800], ["EXACT ACTIVE NAM 2.NAM", 801]]);
    let loadedFile = activeCapture.value;
    vi.mocked(deviceApi.listDeviceFiles).mockImplementation(async () => [...storedModels.keys()].map((name) => `Neural Amp Modeler/Tone 3000/${name}`));
    mocks.downloadTone.mockImplementation(async (_tone, model, name) => { storedModels.set(`${name}.nam`, model!.remoteId); });
    const originalRead = mocks.properties.getMockImplementation()!;
    mocks.properties.mockImplementation(async (path) => path === activeCapture.path ? { LoadedClone: loadedFile, FileMissing: "" } : originalRead(path));
    mocks.setProperties.mockImplementation(async (path, properties) => {
      if (path === activeCapture.path) loadedFile = String(properties.LoadedClone);
      return { status: 200, body: {} };
    });

    await useAppStore.getState().saveAuditionRig(saveOptions);

    expect(storedModels).toEqual(new Map([["Exact active NAM.nam", 800], ["EXACT ACTIVE NAM 2.NAM", 801], ["Exact active NAM 3.nam", activeModel.remoteId]]));
    expect(mocks.downloadTone).toHaveBeenCalledWith(activeTone, activeModel, "Exact active NAM 3");
    expect(mocks.setProperties).toHaveBeenCalledWith(activeCapture.path, { LoadedClone: "Neural Amp Modeler/Tone 3000/Exact active NAM 3.nam" });
    expect(mocks.saveRigAs).toHaveBeenCalledWith("Saved Audition");
  });

  it("uses another available source name when saving the same audition again", async () => {
    const mocks = mockSuccessfulRigSave();
    const storedFiles: string[] = [];
    let loadedFile = activeCapture.value;
    vi.mocked(deviceApi.listDeviceFiles).mockImplementation(async () => [...storedFiles]);
    mocks.downloadTone.mockImplementation(async (_tone, _model, name) => { storedFiles.push(`${name}.nam`); });
    const originalRead = mocks.properties.getMockImplementation()!;
    mocks.properties.mockImplementation(async (path) => path === activeCapture.path ? { LoadedClone: loadedFile, FileMissing: "" } : originalRead(path));
    mocks.setProperties.mockImplementation(async (path, properties) => {
      if (path === activeCapture.path) loadedFile = String(properties.LoadedClone);
      return { status: 200, body: {} };
    });

    await useAppStore.getState().saveAuditionRig(saveOptions);
    await useAppStore.getState().saveAuditionRig({ ...saveOptions, programChange: -1, overwrite: true });

    expect(storedFiles).toEqual(["Exact active NAM.nam", "Exact active NAM 2.nam"]);
    expect(mocks.downloadTone).toHaveBeenNthCalledWith(1, activeTone, activeModel, "Exact active NAM");
    expect(mocks.downloadTone).toHaveBeenNthCalledWith(2, activeTone, activeModel, "Exact active NAM 2");
    expect(mocks.setProperties).toHaveBeenCalledWith(activeCapture.path, { LoadedClone: "Neural Amp Modeler/Tone 3000/Exact active NAM 2.nam" });
    expect(mocks.saveRigAs).toHaveBeenCalledTimes(2);
  });

  it("does not download or save when existing NAM filenames cannot be checked", async () => {
    const mocks = mockSuccessfulRigSave();
    vi.mocked(deviceApi.listDeviceFiles).mockRejectedValue(new Error("Device file listing failed"));

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow("Device file listing failed");

    expect(mocks.downloadTone).not.toHaveBeenCalled();
    expect(mocks.setProperties).not.toHaveBeenCalled();
    expect(mocks.saveRigAs).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("omits MIDI assignment when the device does not expose it and Off is selected", async () => {
    const mocks = mockSuccessfulRigSave();
    let rigRead = 0;
    mocks.properties.mockReset().mockImplementation(async (path) => {
      if (path === activeCapture.path) return { On: true, LoadedClone: durableTone3000Path, FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Rig") return { TempoFromMaster: true, Tempo: 0.42 };
      if (path !== "/Evil/API/Rigs") return {};
      rigRead += 1;
      if (rigRead === 1) return {
        AllRigNames: demoRigs.map((rig) => rig.name),
        AllRigIds: demoRigs.map((rig) => rig.id),
        loadedColor: 7,
      };
      return {
        loadedID: "saved-without-midi",
        loadedName: "Saved Audition",
        AllRigNames: [...demoRigs.map((rig) => rig.name), "Saved Audition"],
        AllRigIds: [...demoRigs.map((rig) => rig.id), "saved-without-midi"],
      };
    });

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, programChange: -1 });

    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/API/Rigs", { loadedColor: saveOptions.color });
    expect(mocks.setProperties).not.toHaveBeenCalledWith(
      "/Evil/API/Rigs",
      expect.objectContaining({ loadedProgMIDICC: expect.anything() }),
    );
    expect(mocks.saveRigAs).toHaveBeenCalledWith("Saved Audition");
    expect(result.rigId).toBe("saved-without-midi");
    expectSessionPreserved();
  });

  it("rejects a MIDI assignment when the device does not expose saved-rig MIDI programs", async () => {
    const properties = vi.spyOn(deviceApi, "properties").mockResolvedValue({
      AllRigNames: demoRigs.map((rig) => rig.name),
      AllRigIds: demoRigs.map((rig) => rig.id),
    });
    const canSaveNewRig = vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
    const downloadTone = vi.spyOn(deviceApi, "downloadTone");
    const setProperties = vi.spyOn(deviceApi, "setProperties");
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs");

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow(/did not expose MIDI Program assignment/i);

    expect(properties).toHaveBeenCalledWith("/Evil/API/Rigs");
    expect(canSaveNewRig).toHaveBeenCalledOnce();
    expect(downloadTone).not.toHaveBeenCalled();
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("preserves every flat setlist rig before appending the saved audition", async () => {
    const placeholderSetlist = { ...structuredClone(demoSetlists[0]), items: [{ id: "placeholder", rigId: "", title: "Rig 1" }] };
    useAppStore.setState({ setlists: [placeholderSetlist], selectedSetlistId: placeholderSetlist.id });
    const mocks = mockSuccessfulRigSave();
    mocks.getSetlist.mockResolvedValue(JSON.stringify({
      id: placeholderSetlist.id,
      name: placeholderSetlist.name,
      author: "",
      readonly: false,
      version: "1.0.0",
      rigs: ["device-rig-1", "device-rig-2"],
      rig_names: ["Device Clean", "Device Lead"],
    }));

    const result = await useAppStore.getState().saveAuditionRig({
      ...saveOptions,
      setlistId: placeholderSetlist.id,
      tempoMode: "current",
    });

    expect(mocks.setProperties).toHaveBeenNthCalledWith(3, "/Evil/Engine/Patch/Rig", { TempoFromMaster: true });
    expect(mocks.getSetlist).toHaveBeenCalledWith(placeholderSetlist.id);
    expect(mocks.saveSetlistDocument).toHaveBeenCalledWith({
      id: placeholderSetlist.id,
      name: placeholderSetlist.name,
      data: [
        { id: "device-rig-1", order: 0 },
        { id: "device-rig-2", order: 1 },
        { id: "saved-rig", order: 2 },
      ],
    });
    expect(result).toMatchObject({ rigId: "saved-rig", setlistName: placeholderSetlist.name });
    expect(mocks.startToneDemo).not.toHaveBeenCalled();
    expect(mocks.stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("preserves song-view rows and empty songs, then creates a new song for the saved rig", async () => {
    const songSetlist = { id: "song-set", name: "Song View Show", items: [] };
    useAppStore.setState({ setlists: [songSetlist], selectedSetlistId: songSetlist.id });
    const mocks = mockSuccessfulRigSave();
    mocks.getSetlist.mockResolvedValue({
      id: songSetlist.id,
      name: songSetlist.name,
      author: "",
      readonly: false,
      version: "1.0.0",
      songs: [
        { song_id: "song-one", song_name: "Opener", rigs: ["rig-a", "rig-b"], rig_names: ["Clean", "Lead"] },
        { song_id: "song-empty", song_name: "Intermission", rigs: [], rig_names: [] },
      ],
    });

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, setlistId: songSetlist.id });

    expect(mocks.saveSetlistDocument).toHaveBeenCalledOnce();
    const document = mocks.saveSetlistDocument.mock.calls[0][0];
    expect(document).toEqual({
      id: songSetlist.id,
      name: songSetlist.name,
      data: [
        { song_id: "song-one", song_name: "Opener", rig_id: "rig-a", rig_name: "Clean", empty_song: false },
        { song_id: "song-one", song_name: "Opener", rig_id: "rig-b", rig_name: "Lead", empty_song: false },
        { song_id: "song-empty", song_name: "Intermission", rig_id: "", rig_name: "", empty_song: true },
        { song_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i), song_name: "Saved Audition", rig_id: "saved-rig", rig_name: "Saved Audition", empty_song: false },
      ],
    });
    expect(result).toMatchObject({ rigId: "saved-rig", setlistName: songSetlist.name });
    expect(mocks.startToneDemo).not.toHaveBeenCalled();
    expect(mocks.stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("reports a partial warning when setlist insertion fails after the rig was saved", async () => {
    const setlist = structuredClone(demoSetlists[1]);
    useAppStore.setState({ setlists: [setlist], selectedSetlistId: setlist.id });
    const mocks = mockSuccessfulRigSave();
    mocks.getSetlist.mockResolvedValue({
      id: setlist.id,
      name: setlist.name,
      author: "",
      readonly: false,
      version: "1.0.0",
      rigs: ["rig-before"],
      rig_names: ["Before"],
    });
    mocks.saveSetlistDocument.mockRejectedValue(new Error("setlist write rejected"));

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, setlistId: setlist.id });

    expect(mocks.saveRigAs).toHaveBeenCalledWith("Saved Audition");
    expect(result).toMatchObject({ rigId: "saved-rig", name: "Saved Audition" });
    expect(result.setlistName).toBeUndefined();
    expect(result.warning).toMatch(/saved to Rigs.*could not be added/i);
    expect(useAppStore.getState().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", source: "TonePilot", detail: expect.stringContaining("setlist write rejected") }),
    ]));
    expect(mocks.refreshFull).toHaveBeenCalledWith("manual");
    expect(mocks.startToneDemo).not.toHaveBeenCalled();
    expect(mocks.stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it.each([
    ["malformed", (id: string, name: string) => ({ id, name, author: "", readonly: false, version: "1.0.0", rigs: ["rig-before"] })],
    ["read-only", (id: string, name: string) => ({ id, name, author: "", readonly: true, version: "1.0.0", rigs: ["rig-before"], rig_names: ["Before"] })],
    ["wrong-ID", (_id: string, name: string) => ({ id: "another-setlist", name, author: "", readonly: false, version: "1.0.0", rigs: ["rig-before"], rig_names: ["Before"] })],
  ])("does not replace a %s setlist response after the rig itself has been saved", async (_case, response) => {
    const setlist = structuredClone(demoSetlists[0]);
    useAppStore.setState({ setlists: [setlist], selectedSetlistId: setlist.id });
    const mocks = mockSuccessfulRigSave();
    mocks.getSetlist.mockResolvedValue(response(setlist.id, setlist.name));

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, setlistId: setlist.id });

    expect(mocks.saveRigAs).toHaveBeenCalledWith("Saved Audition");
    expect(mocks.getSetlist).toHaveBeenCalledWith(setlist.id);
    expect(mocks.saveSetlistDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rigId: "saved-rig", name: "Saved Audition" });
    expect(result.setlistName).toBeUndefined();
    expect(result.warning).toMatch(/saved to Rigs.*could not be added/i);
    expect(mocks.refreshFull).toHaveBeenCalledWith("manual");
    expectSessionPreserved();
  });

  it("keeps duplicate setlist placements because one rig may be used more than once in a show", async () => {
    const setlist = structuredClone(demoSetlists[0]);
    useAppStore.setState({ setlists: [setlist], selectedSetlistId: setlist.id });
    const mocks = mockSuccessfulRigSave();
    mocks.getSetlist.mockResolvedValue({
      id: setlist.id,
      name: setlist.name,
      author: "",
      readonly: false,
      version: "1.0.0",
      rigs: ["saved-rig"],
      rig_names: ["Saved Audition"],
    });

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, setlistId: setlist.id });

    expect(mocks.saveSetlistDocument).toHaveBeenCalledWith({
      id: setlist.id,
      name: setlist.name,
      data: [
        { id: "saved-rig", order: 0 },
        { id: "saved-rig", order: 1 },
      ],
    });
    expect(result.setlistName).toBe(setlist.name);
    expectSessionPreserved();
  });

  it("rejects a full rig library before changing metadata or saving anything", async () => {
    const properties = vi.spyOn(deviceApi, "properties").mockResolvedValue({
      AllRigNames: demoRigs.map((rig) => rig.name),
      AllRigIds: demoRigs.map((rig) => rig.id),
      availableProgMIDICC: [0, 1, 11, 12, 127],
      loadedProgMIDICC: -1,
    });
    const canSaveNewRig = vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(false);
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs").mockResolvedValue();
    const saveSetlistDocument = vi.spyOn(deviceApi, "saveSetlistDocument").mockResolvedValue("saved-setlist");
    const refreshFull = vi.spyOn(useAppStore.getState(), "refreshFull").mockResolvedValue();
    const startToneDemo = vi.spyOn(deviceApi, "startToneDemo").mockResolvedValue();
    const stopToneDemo = vi.spyOn(deviceApi, "stopToneDemo").mockResolvedValue();

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow(/library cannot accept another rig/i);

    expect(properties).toHaveBeenCalledOnce();
    expect(canSaveNewRig).toHaveBeenCalledOnce();
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();
    expect(saveSetlistDocument).not.toHaveBeenCalled();
    expect(refreshFull).not.toHaveBeenCalled();
    expect(startToneDemo).not.toHaveBeenCalled();
    expect(stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("requires overwrite confirmation for a duplicate name and skips the capacity check once confirmed", async () => {
    const duplicateLibrary = {
      AllRigNames: [...demoRigs.map((rig) => rig.name), "saved audition"],
      AllRigIds: [...demoRigs.map((rig) => rig.id), "existing-duplicate-rig"],
      availableProgMIDICC: [0, 1, 11, 12, 127],
      loadedProgMIDICC: -1,
    };
    let rigRead = 0;
    const properties = vi.spyOn(deviceApi, "properties").mockImplementation(async (path) => {
      if (path === activeCapture.path) return { On: true, LoadedClone: durableTone3000Path, FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Rig") return { TempoFromMaster: true, Tempo: 0.42 };
      if (path !== "/Evil/API/Rigs") return {};
      rigRead += 1;
      if (rigRead <= 2) return duplicateLibrary;
      return { ...duplicateLibrary, loadedID: "existing-duplicate-rig", loadedName: "Saved Audition" };
    });
    vi.spyOn(deviceApi, "downloadTone").mockResolvedValue();
    const canSaveNewRig = vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs").mockResolvedValue();
    const refreshFull = vi.spyOn(useAppStore.getState(), "refreshFull").mockResolvedValue();
    const startToneDemo = vi.spyOn(deviceApi, "startToneDemo").mockResolvedValue();
    const stopToneDemo = vi.spyOn(deviceApi, "stopToneDemo").mockResolvedValue();

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow(/already exists.*Confirm replacement/i);

    expect(canSaveNewRig).not.toHaveBeenCalled();
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, overwrite: true });

    expect(properties).toHaveBeenCalledTimes(5);
    expect(canSaveNewRig).not.toHaveBeenCalled();
    expect(setProperties).toHaveBeenCalledTimes(3);
    expect(saveRigAs).toHaveBeenCalledOnce();
    expect(saveRigAs).toHaveBeenCalledWith("Saved Audition");
    expect(refreshFull).toHaveBeenCalledWith("manual");
    expect(result).toMatchObject({ rigId: "existing-duplicate-rig", name: "Saved Audition" });
    expect(startToneDemo).not.toHaveBeenCalled();
    expect(stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("rejects an unavailable MIDI program before either metadata write or the rig save", async () => {
    const properties = vi.spyOn(deviceApi, "properties").mockResolvedValue({
      AllRigNames: demoRigs.map((rig) => rig.name),
      AllRigIds: demoRigs.map((rig) => rig.id),
      availableProgMIDICC: [0, 1, 12, 127],
      loadedProgMIDICC: -1,
    });
    const canSaveNewRig = vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs").mockResolvedValue();
    const saveSetlistDocument = vi.spyOn(deviceApi, "saveSetlistDocument").mockResolvedValue("saved-setlist");
    const startToneDemo = vi.spyOn(deviceApi, "startToneDemo").mockResolvedValue();
    const stopToneDemo = vi.spyOn(deviceApi, "stopToneDemo").mockResolvedValue();

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow(/MIDI Program 12 is already assigned/i);

    expect(properties).toHaveBeenCalledOnce();
    expect(canSaveNewRig).toHaveBeenCalledOnce();
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();
    expect(saveSetlistDocument).not.toHaveBeenCalled();
    expect(startToneDemo).not.toHaveBeenCalled();
    expect(stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("restores the previous rig options and tempo when the tempo metadata write fails", async () => {
    const mocks = mockSuccessfulRigSave();
    mocks.properties.mockReset().mockImplementation(async (path) => {
      if (path === activeCapture.path) return { On: true, LoadedClone: durableTone3000Path, FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Rig") return { TempoFromMaster: true, Tempo: 0.42 };
      if (path === "/Evil/API/Rigs") return {
        AllRigNames: demoRigs.map((rig) => rig.name),
        AllRigIds: demoRigs.map((rig) => rig.id),
        availableProgMIDICC: [0, 1, 11, 12, 127],
        loadedColor: 8,
        loadedProgMIDICC: 12,
      };
      return {};
    });
    mocks.setProperties.mockReset().mockImplementation(async (path, values) => {
      const isNewTempo = path === "/Evil/Engine/Patch/Rig" && values.TempoFromMaster === false;
      return { status: isNewTempo ? 500 : 200, body: {} };
    });

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow(/Updating rig tempo failed/i);

    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/API/Rigs", { loadedColor: 4, loadedProgMIDICC: 11 });
    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Rig", {
      TempoFromMaster: false,
      Tempo: expect.closeTo((126 - 30) / 210, 10),
    });
    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/API/Rigs", { loadedColor: 8, loadedProgMIDICC: 12 });
    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Rig", { TempoFromMaster: true, Tempo: 0.42 });
    expect(mocks.saveRigAs).not.toHaveBeenCalled();
    expect(mocks.refreshFull).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("rolls metadata back when HeadRush rejects save-as after accepting the temporary options", async () => {
    const mocks = mockSuccessfulRigSave();
    mocks.properties.mockReset().mockImplementation(async (path) => {
      if (path === activeCapture.path) return { On: true, LoadedClone: durableTone3000Path, FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Rig") return { TempoFromMaster: false, Tempo: 0.25 };
      if (path === "/Evil/API/Rigs") return {
        AllRigNames: demoRigs.map((rig) => rig.name),
        AllRigIds: demoRigs.map((rig) => rig.id),
        availableProgMIDICC: [0, 1, 11, 12, 127],
        loadedColor: 6,
        loadedProgMIDICC: 1,
      };
      return {};
    });
    mocks.saveRigAs.mockRejectedValue(new Error("device rejected save-as"));

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow("device rejected save-as");

    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/API/Rigs", { loadedColor: 6, loadedProgMIDICC: 1 });
    expect(mocks.setProperties).toHaveBeenCalledWith("/Evil/Engine/Patch/Rig", { TempoFromMaster: false, Tempo: 0.25 });
    expect(mocks.saveSetlistDocument).not.toHaveBeenCalled();
    expect(mocks.refreshFull).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("waits for the latest Test Rig sync before downloading a durable source or saving", async () => {
    const mocks = mockSuccessfulRigSave();
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
    const syncActiveTestRig = vi.mocked(useAppStore.getState().syncActiveTestRig);
    syncActiveTestRig.mockReset().mockReturnValueOnce(syncGate);

    const saving = useAppStore.getState().saveAuditionRig(saveOptions);
    await vi.waitFor(() => expect(syncActiveTestRig).toHaveBeenCalledOnce());

    expect(mocks.downloadTone).not.toHaveBeenCalled();
    expect(mocks.setProperties).not.toHaveBeenCalled();
    expect(mocks.saveRigAs).not.toHaveBeenCalled();

    releaseSync();
    await saving;

    expect(mocks.downloadTone).toHaveBeenCalledOnce();
    expect(mocks.saveRigAs).toHaveBeenCalledOnce();
    expect(syncActiveTestRig.mock.invocationCallOrder[0]).toBeLessThan(mocks.downloadTone.mock.invocationCallOrder[0]);
    expect(syncActiveTestRig.mock.invocationCallOrder[0]).toBeLessThan(mocks.saveRigAs.mock.invocationCallOrder[0]);
    expectSessionPreserved();
  });

  it("reports a refresh warning without retrying or rolling back an already-saved rig", async () => {
    const mocks = mockSuccessfulRigSave();
    mocks.refreshFull.mockRejectedValue(new Error("device refresh timed out"));

    const result = await useAppStore.getState().saveAuditionRig(saveOptions);

    expect(mocks.saveRigAs).toHaveBeenCalledOnce();
    expect(mocks.setProperties).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ rigId: "saved-rig", name: "Saved Audition" });
    expect(result.warning).toMatch(/was saved.*could not refresh the device library/i);
    expect(useAppStore.getState().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", source: "TonePilot", detail: expect.stringContaining("device refresh timed out") }),
    ]));
    expectSessionPreserved();
  });

  it("waits for the post-save rig identity and never appends a stale loaded ID to the setlist", async () => {
    const setlist = structuredClone(demoSetlists[0]);
    useAppStore.setState({ setlists: [setlist], selectedSetlistId: setlist.id });
    const mocks = mockSuccessfulRigSave("unused-immediate-id");
    let rigRead = 0;
    mocks.properties.mockReset().mockImplementation(async (path) => {
      if (path === activeCapture.path) return { On: true, LoadedClone: durableTone3000Path, FileMissing: "" };
      if (path === "/Evil/Engine/Patch/Rig") return { TempoFromMaster: true, Tempo: 0.42 };
      if (path !== "/Evil/API/Rigs") return {};
      rigRead += 1;
      if (rigRead === 1) return {
        AllRigNames: demoRigs.map((rig) => rig.name),
        AllRigIds: demoRigs.map((rig) => rig.id),
        availableProgMIDICC: [0, 1, 11, 12, 127],
        loadedProgMIDICC: -1,
        loadedID: "rig-loaded-before-save",
        loadedName: "Previously Loaded Rig",
      };
      if (rigRead === 2) return {
        AllRigNames: demoRigs.map((rig) => rig.name),
        AllRigIds: demoRigs.map((rig) => rig.id),
        loadedID: "stale-loaded-id",
        loadedName: "Previously Loaded Rig",
      };
      return {
        AllRigNames: [...demoRigs.map((rig) => rig.name), "Saved Audition"],
        AllRigIds: [...demoRigs.map((rig) => rig.id), "saved-after-delay"],
        loadedID: "saved-after-delay",
        loadedName: "Saved Audition",
      };
    });
    mocks.getSetlist.mockResolvedValue({
      id: setlist.id,
      name: setlist.name,
      author: "",
      readonly: false,
      version: "1.0.0",
      rigs: ["existing-setlist-rig"],
      rig_names: ["Existing Rig"],
    });

    const result = await useAppStore.getState().saveAuditionRig({ ...saveOptions, setlistId: setlist.id });

    expect(mocks.properties).toHaveBeenCalledTimes(5);
    expect(mocks.saveSetlistDocument).toHaveBeenCalledWith({
      id: setlist.id,
      name: setlist.name,
      data: [
        { id: "existing-setlist-rig", order: 0 },
        { id: "saved-after-delay", order: 1 },
      ],
    });
    expect(JSON.stringify(mocks.saveSetlistDocument.mock.calls[0][0])).not.toContain("stale-loaded-id");
    expect(result).toMatchObject({ rigId: "saved-after-delay", setlistName: setlist.name });
    expect(mocks.startToneDemo).not.toHaveBeenCalled();
    expect(mocks.stopToneDemo).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("does not mutate rig metadata or save when the exact Tone3000 model cannot be downloaded", async () => {
    vi.spyOn(deviceApi, "properties").mockResolvedValue({
      AllRigNames: demoRigs.map((rig) => rig.name),
      AllRigIds: demoRigs.map((rig) => rig.id),
      availableProgMIDICC: [11],
      loadedProgMIDICC: -1,
    });
    vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
    const downloadTone = vi.spyOn(deviceApi, "downloadTone").mockRejectedValue(new Error("device file write rejected"));
    const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
    const saveRigAs = vi.spyOn(deviceApi, "saveRigAs").mockResolvedValue();

    await expect(useAppStore.getState().saveAuditionRig(saveOptions)).rejects.toThrow("device file write rejected");

    expect(downloadTone).toHaveBeenCalledWith(activeTone, activeModel, "Exact active NAM");
    expect(setProperties).not.toHaveBeenCalled();
    expect(saveRigAs).not.toHaveBeenCalled();
    expectSessionPreserved();
  });

  it("fails safely when a downloaded HeadRush Cloud clone cannot be located for durable rebinding", async () => {
    vi.useFakeTimers();
    try {
      const cloudClone: CloudTone = {
        ...activeTone,
        id: "cloud-clone",
        source: "HeadRush Cloud",
        remoteId: "cloud-77",
        remoteKind: "clone",
        title: "Cloud clone",
        gear: "AMP_CLONE_TYPE_STANDARD",
      };
      useAppStore.setState({
        tones: [],
        auditioningToneId: cloudClone.id,
        testRigReturn: {
          ...returnTarget,
          auditionSource: "HeadRush Cloud",
          audition: {
            tone: cloudClone,
            captureFile: {
              path: "/Evil/Engine/Patch/Amp_Clone",
              property: "LoadedClone",
              value: "HeadRush Cloud Demo/cloud-77.clone",
            },
          },
        },
      });
      vi.spyOn(deviceApi, "properties").mockResolvedValue({
        AllRigNames: demoRigs.map((rig) => rig.name),
        AllRigIds: demoRigs.map((rig) => rig.id),
        availableProgMIDICC: [11],
        loadedProgMIDICC: -1,
      });
      vi.spyOn(deviceApi, "canSaveNewRig").mockResolvedValue(true);
      const listDeviceFiles = vi.spyOn(deviceApi, "listDeviceFiles").mockResolvedValue([]);
      const downloadTone = vi.spyOn(deviceApi, "downloadTone").mockResolvedValue();
      const setProperties = vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: {} });
      const saveRigAs = vi.spyOn(deviceApi, "saveRigAs").mockResolvedValue();

      const saving = useAppStore.getState().saveAuditionRig(saveOptions);
      const rejected = expect(saving).rejects.toThrow(/file could not be verified.*not saved/i);
      await vi.runAllTimersAsync();
      await rejected;

      expect(listDeviceFiles).toHaveBeenCalledWith("Amp Clones/HeadRush Cloud", "clone");
      expect(downloadTone).toHaveBeenCalledWith(cloudClone, undefined, "Saved Audition");
      expect(setProperties).not.toHaveBeenCalled();
      expect(saveRigAs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
