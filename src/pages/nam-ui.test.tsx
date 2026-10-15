import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { demoDevice, demoRigs, testRigTemplates } from "../data/demo-data";
import { parametersForObject } from "../domain/headrush-reflection";
import type { CloudTone, HeadRushObject } from "../domain/types";
import { ParameterControl } from "../components/system/controls";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { EditorPage } from "./editor";
import { ToneLabPage } from "./tone-lab";
import { TestRigEditorDialog, ToneModTestRigStudio } from "./tonemod-test-rigs";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

const moduleTypes = ["Empty Slot", "Neural Amp Modeler", "Neural Amp Modeler 2"];
const tone: CloudTone = { id: "nam-tone", title: "NAM tone", author: "QA", description: "amp", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 0, downloads: 0, source: "Tone3000", imageColor: "#62deea", remoteId: 1 };
const namObject: HeadRushObject = {
  value: { LoadedClone: "Neural Amp Modeler/Other.nam", LoadedClone2: "Neural Amp Modeler/Second.nam", Doubling: true, LightMode: true, Output: 0.5, order: ["LoadedClone", "LoadedClone2", "Doubling", "LightMode", "Output"], labels: ["NAM file", "Second NAM file", "Doubling", "Lite Mode", "Output"] },
  meta: { properties: {
    LoadedClone: { type: "string", "x-options": { fileType: 10, startPath: "Neural Amp Modeler" } },
    LoadedClone2: { type: "string", "x-options": { fileType: 10, startPath: "Neural Amp Modeler" } },
    Doubling: { type: "boolean" }, LightMode: { type: "boolean" }, Output: { type: "number", minimum: -40, maximum: 40 },
  } },
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useAppStore.setState({
    device: { ...demoDevice, status: "ready" }, rigs: [structuredClone(demoRigs[0])], selectedRigId: demoRigs[0].id,
    selectedBlockId: null, rigHistory: {}, historyPreview: null, pendingWrites: [], favoriteBlockNames: [],
    liveSubtree: {
      "/Evil/API/Blocks": { value: { ModuleTypes: moduleTypes } },
      "/Evil/Engine/Patch/Neural_Amp_Modeler": structuredClone(namObject),
      "/Evil/Engine/Patch/Neural_Amp_Modeler_2": structuredClone(namObject),
      "/Evil/API/Tone3000": { value: { isLoggedIn: true } },
    }, liveSnapshot: null,
    testRigs: structuredClone(testRigTemplates), selectedTestRigId: testRigTemplates[0].id,
    testRigSets: [{ id: "nam-reference", name: "NAM reference", rigIds: [testRigTemplates[0].id] }], selectedTestRigSetId: "nam-reference",
    toneModels: {}, tones: [], selectedToneId: null, selectedToneModelId: null,
    auditioningToneId: null, auditionBusy: false, auditionError: null, testRigReturn: null, testRigSyncBusy: false, testRigSyncError: null,
  });
  vi.spyOn(deviceApi, "isNative").mockReturnValue(false);
  vi.spyOn(deviceApi, "blockPresets").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Multiple NAM host UI", () => {
  it("offers the second reflected NAM host in the standard chain and prevents reusing the first", async () => {
    const rig = structuredClone(demoRigs[0]);
    rig.blocks = rig.blocks.filter((block) => block.slot !== 8);
    rig.blocks.push({ id: "nam-first", name: "Neural Amp Modeler", model: "Neural Amp Modeler", category: "clone", color: "#ffad69", enabled: true, slot: 8, moduleTypeId: 1, parameters: [] });
    useAppStore.setState({ rigs: [rig] });
    const add = vi.spyOn(useAppStore.getState(), "addBlock").mockResolvedValue();
    render(<EditorPage/>);
    fireEvent.click(document.querySelector<HTMLElement>('[data-chain-slot="9"] .add-block')!);
    fireEvent.change(screen.getByPlaceholderText(/Search effects and models/i), { target: { value: "Neural Amp Modeler" } });
    const results = document.querySelector(".block-browser__grid")!;
    expect(within(results as HTMLElement).getByRole("button", { name: /NAM DSP host 1.*Neural Amp Modeler$/i })).toBeDisabled();
    fireEvent.click(within(results as HTMLElement).getByRole("button", { name: /NAM DSP host 2.*Neural Amp Modeler 2/i }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ name: "Neural Amp Modeler 2", moduleTypeId: 2, slot: 9 })));
  });

  it("saves model priority, DSP instance and a movable audition chain position", () => {
    render(<ToneModTestRigStudio onBrowse={vi.fn()}/>);
    fireEvent.change(screen.getByRole("combobox", { name: "Preferred NAM model" }), { target: { value: "nam2-lite" } });
    fireEvent.change(screen.getByRole("combobox", { name: "NAM DSP host" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Audition chain slot" }), { target: { value: "2" } });
    const rig = useAppStore.getState().testRigs[0];
    expect(rig).toMatchObject({ namPreference: "nam2-lite", namInstance: 2, captureSlot: 2 });
    expect(rig.blocks.find((block) => block.name === "Capture slot")?.slot).toBe(2);
    expect(screen.getByText("Capture marker in plan slot 3")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Audition chain slot" }).querySelector('option[value="3"]')).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Preferred NAM model" }), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Model architecture"), { target: { value: "A1" } });
    expect(useAppStore.getState().testRigs[0]).toMatchObject({ namPreference: "other", namOtherModel: "A1" });
    expect(screen.getByText(/up to 2 Full NAM files or 4 Lite files/i)).toBeInTheDocument();
  });

  it("adds an independent NAM in an ordinary test slot with both file controls editable", async () => {
    render(<TestRigEditorDialog open onClose={vi.fn()}/>);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector<HTMLElement>('[data-chain-slot="2"]')!);
    fireEvent.change(screen.getByPlaceholderText(/Search blocks/i), { target: { value: "Neural Amp Modeler" } });
    const catalogue = dialog.querySelector(".tp-editor-results")!;
    expect(within(catalogue as HTMLElement).getByRole("button", { name: /NAM host 1.*Neural Amp Modeler$/i })).toBeDisabled();
    fireEvent.click(within(catalogue as HTMLElement).getByRole("button", { name: /NAM host 2.*Neural Amp Modeler 2/i }));
    await waitFor(() => expect(useAppStore.getState().testRigs[0].blocks.find((block) => block.slot === 2)).toMatchObject({ model: "Neural Amp Modeler 2", sourcePath: "/Evil/Engine/Patch/Neural_Amp_Modeler_2" }));
    expect(within(dialog).getByRole("button", { name: /Change NAM file, currently Other.nam/i })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Change Second NAM file, currently Second.nam/i })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Remove Neural Amp Modeler 2/i })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Duplicate/i })).toBeDisabled();
  });

  it("protects the provider's primary file while retaining the host's second NAM file", () => {
    const rig = structuredClone(testRigTemplates[0]);
    rig.blocks.find((block) => block.name === "Capture slot")!.parameters = parametersForObject(namObject);
    useAppStore.setState({ testRigs: [rig] });
    render(<TestRigEditorDialog open onClose={vi.fn()}/>);
    expect(screen.queryByRole("button", { name: /Change NAM file, currently Other.nam/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Change Second NAM file, currently Second.nam/i })).toBeEnabled();
  });

  it("automatically reveals secondary host controls without importing the live rig's NAM file", () => {
    const rig = structuredClone(testRigTemplates[0]);
    const marker = rig.blocks.find((block) => block.name === "Capture slot")!;
    marker.parameters.find((parameter) => parameter.id === "Output")!.value = 6;
    marker.parameters.find((parameter) => parameter.id === "Doubling")!.value = false;
    const object = structuredClone(namObject);
    object.value!.Doubling = false;
    object.value!.Output2 = 0.5;
    object.value!.LightMode2 = true;
    object.value!.CalibrateInput2 = false;
    object.value!.disabled = ["LoadedClone2", "Output2", "LightMode2", "CalibrateInput2"];
    object.meta!.properties!.Output2 = { type: "number", minimum: -40, maximum: 40 };
    object.meta!.properties!.LightMode2 = { type: "boolean", "x-options": { strings: ["Full", "Lite"] } };
    object.meta!.properties!.LightMode = { type: "boolean", "x-options": { strings: ["Full", "Lite"] } };
    object.meta!.properties!.Doubling = { type: "boolean", "x-options": { strings: ["Single", "Double"] } };
    object.meta!.properties!.CalibrateInput2 = { type: "boolean", "x-options": { strings: ["Off", "On"] } };
    useAppStore.setState({ testRigs: [rig], liveSubtree: { ...useAppStore.getState().liveSubtree, "/Evil/Engine/Patch/Neural_Amp_Modeler": object } });
    render(<TestRigEditorDialog open onClose={vi.fn()}/>);
    const secondary = screen.getByRole("button", { name: /Choose Second NAM file/i });
    expect(secondary).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Output" })).toHaveValue("6");
    expect(screen.getByRole("combobox", { name: "Lite Mode" })).toHaveValue("Full");
    expect(screen.getByRole("combobox", { name: "Doubling" })).toHaveValue("Single");
    fireEvent.change(screen.getByRole("combobox", { name: "Doubling" }), { target: { value: "Double" } });
    expect(screen.getByRole("button", { name: /Choose Second NAM file/i })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Output2" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Calibrate Input2" })).toBeDisabled();
    const parameters = useAppStore.getState().testRigs[0].blocks.find((block) => block.name === "Capture slot")!.parameters;
    expect(parameters.find((parameter) => parameter.id === "LoadedClone2")?.value).toBe("");
    expect(parameters.find((parameter) => parameter.id === "LoadedClone")).toBeUndefined();
  });

  it("disables firmware-controlled Lite selectors and suppresses their writes", () => {
    const change = vi.fn();
    const object = structuredClone(namObject);
    object.value!.disabled = ["LightMode"];
    render(<ParameterControl parameter={parametersForObject(object).find((parameter) => parameter.id === "LightMode")!} onChange={change}/>);
    const lite = screen.getByRole("switch", { name: "Lite Mode" });
    expect(lite).toBeDisabled();
    fireEvent.click(lite);
    expect(change).not.toHaveBeenCalled();
  });

  it("does not schedule another host update when polling replaces an unchanged schema", () => {
    const update = vi.spyOn(useAppStore.getState(), "updateTestRigBlock");
    render(<TestRigEditorDialog open onClose={vi.fn()}/>);
    expect(update).toHaveBeenCalledTimes(1);
    const tree = structuredClone(useAppStore.getState().liveSubtree!);
    tree["/Evil/Engine/Patch/Neural_Amp_Modeler"].value!.Output = 0.8;
    tree["/Evil/Engine/Patch/Neural_Amp_Modeler"].value!.LoadedClone2 = "Neural Amp Modeler/Unrelated.nam";
    act(() => useAppStore.setState({ liveSubtree: tree }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("slider", { name: "Output" })).toHaveValue("0");
    expect(screen.queryByText("Unrelated.nam")).not.toBeInTheDocument();
  });

  it("shows firmware-forced Lite mode while retaining the Full model preference", () => {
    const rig = structuredClone(testRigTemplates[0]);
    rig.namPreference = "nam2";
    const object = structuredClone(namObject);
    object.value!.disabled = ["LightMode"];
    useAppStore.setState({ testRigs: [rig], liveSubtree: { ...useAppStore.getState().liveSubtree, "/Evil/Engine/Patch/Neural_Amp_Modeler": object } });
    render(<TestRigEditorDialog open onClose={vi.fn()}/>);
    expect(screen.getByRole("switch", { name: "Lite Mode" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Lite Mode" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Preferred NAM model" })).toHaveValue("nam2");
  });

  it("shows the preferred model and lets an exact manual choice override the preference", () => {
    const rig = structuredClone(testRigTemplates[0]);
    rig.namPreference = "nam2";
    useAppStore.setState({ testRigs: [rig], tones: [tone], selectedToneId: tone.id,
      toneModels: { [tone.id]: [{ id: "legacy", name: "Legacy A1", architecture: "A1", remoteId: 1, url: "https://models.test/a1.nam" }, { id: "a2", name: "Full A2", architecture: "A2", remoteId: 2, url: "https://models.test/a2.nam" }] },
      selectedToneModelId: "legacy", toneModelLoading: false, toneLoading: false, toneError: null, toneModelError: null,
    });
    vi.spyOn(useAppStore.getState(), "loadToneModels").mockResolvedValue();
    render(<ToneLabPage/>);
    const picker = within(document.querySelector<HTMLElement>(".tone-model-options")!);
    expect(picker.getByRole("button", { name: /Full A2/i })).toHaveClass("selected");
    fireEvent.click(picker.getByRole("button", { name: /Legacy A1/i }));
    expect(picker.getByRole("button", { name: /Legacy A1/i })).toHaveClass("selected");
    expect(useAppStore.getState().testRigs[0].namPreference).toBe("auto");
    expect(useAppStore.getState().selectedToneModelId).toBe("legacy");
  });
});

describe("Firmware 5.2 Tone3000 browser sign-in", () => {
  it("opens the device-provided validated login URL only when the new method is reflected", async () => {
    const tree = structuredClone(useAppStore.getState().liveSubtree!);
    tree["/Evil/API/Tone3000"] = { value: { isLoggedIn: false }, meta: { "x-methods": { startLoginGetAuthUrl: {} } } };
    useAppStore.setState({ liveSubtree: tree, tones: [tone], selectedToneId: tone.id, toneLoading: false, toneModelLoading: false, toneError: null, toneModelError: null });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    const start = vi.spyOn(deviceApi, "startTone3000Login").mockResolvedValue("https://www.tone3000.com/activate?code=example");
    render(<ToneLabPage/>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Tone3000" }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://www.tone3000.com/activate?code=example"));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: "Tone3000 sign-in status" })).toHaveTextContent(/Complete Tone3000 sign-in in your browser/i);
  });

  it("retains the on-device sign-in instruction on firmware without the browser login method", () => {
    const tree = structuredClone(useAppStore.getState().liveSubtree!);
    tree["/Evil/API/Tone3000"] = { value: { isLoggedIn: false } };
    useAppStore.setState({ liveSubtree: tree, tones: [tone], selectedToneId: tone.id, toneLoading: false, toneModelLoading: false, toneError: null, toneModelError: null });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    vi.spyOn(useAppStore.getState(), "loadToneModels").mockResolvedValue();
    render(<ToneLabPage/>);
    expect(screen.queryByRole("button", { name: "Sign in to Tone3000" })).not.toBeInTheDocument();
    expect(screen.getByText(/Sign in to Tone3000 on Flex Prime/i)).toBeInTheDocument();
  });

  it("keeps browser sign-in retryable when the device rejects the request", async () => {
    const tree = structuredClone(useAppStore.getState().liveSubtree!);
    tree["/Evil/API/Tone3000"] = { value: { isLoggedIn: false }, meta: { "x-methods": { startLoginGetAuthUrl: {} } } };
    useAppStore.setState({ liveSubtree: tree, tones: [tone], selectedToneId: tone.id, toneLoading: false, toneModelLoading: false, toneError: null, toneModelError: null });
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    vi.spyOn(useAppStore.getState(), "loadToneModels").mockResolvedValue();
    vi.spyOn(deviceApi, "startTone3000Login").mockRejectedValue(new Error("Sign-in request rejected"));
    render(<ToneLabPage/>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Tone3000" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Tone3000 sign-in status" })).toHaveTextContent(/Sign-in request rejected/i));
    expect(screen.getByRole("button", { name: "Sign in to Tone3000" })).toBeEnabled();
  });
});
