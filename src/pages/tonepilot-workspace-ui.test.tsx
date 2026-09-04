import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCapabilities, demoDevice, demoRigs, testRigTemplates } from "../data/demo-data";
import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { ToneLabPage } from "./tone-lab";
import { TestRigEditorDialog, TestRigParameterEditor, TonePilotTestRigStudio } from "./tonepilot-test-rigs";
import { AppShell } from "../components/system/app-shell";

const tone: CloudTone = {
  id: "ui-tone", title: "QA Amp", author: "RushLink QA", description: "Amp capture", captureType: "amp", detectedType: "amp", tags: ["amp"], rating: 4, downloads: 10, source: "Tone3000", imageColor: "#62deea", remoteId: 77, remoteKind: "tone-group", createdAt: "2026-08-14T10:30:00Z",
};
const model: ToneModel = { id: "ui-model", remoteId: 9, name: "QA A2", architecture: "A2", url: "https://models.test/qa.nam" };

function resetTonePilot() {
  localStorage.clear();
  useAppStore.setState({
    device: { ...demoDevice, status: "ready" }, capabilities: structuredClone(demoCapabilities),
    liveSubtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: true }, meta: { properties: {} } } },
    liveSnapshot: null, rigs: structuredClone(demoRigs), selectedRigId: demoRigs[0].id,
    tones: [tone], selectedToneId: tone.id, toneModels: { [tone.id]: [model] }, selectedToneModelId: model.id,
    toneLoading: false, toneModelLoading: false, toneError: null, toneModelError: null, auditionError: null,
    toneUpdatedAtBySource: { tone3000: Date.now(), headRushCloud: Date.now() },
    testRigs: structuredClone(testRigTemplates), selectedTestRigId: testRigTemplates[0].id,
    testRigSets: [{ id: "reference", name: "Reference Run", rigIds: testRigTemplates.map((rig) => rig.id) }], selectedTestRigSetId: "reference",
    testRigReturn: null, auditioningToneId: null, auditionBusy: false,
  });
}

describe("TonePilot audition workspace UI", () => {
  beforeEach(() => { resetTonePilot(); vi.spyOn(deviceApi, "isNative").mockReturnValue(true); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("gates audition on provider login and explains the recovery action", () => {
    useAppStore.setState({ liveSubtree: { "/Evil/API/Tone3000": { value: { isLoggedIn: false }, meta: { properties: {} } } } });
    render(<ToneLabPage/>);
    expect(screen.getByRole("button", { name: /Audition on HeadRush/i })).toBeDisabled();
    expect(screen.getByText(/Sign in to Tone3000 on Flex Prime/i)).toBeInTheDocument();
  });

  it("keeps catalogue and audition errors visually separate", () => {
    useAppStore.setState({ toneError: "Catalogue request failed", auditionError: "Demo engine rejected the model" });
    render(<ToneLabPage/>);
    expect(screen.getByText("Catalogue request failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Demo engine rejected the model");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Catalogue request failed");
  });

  it("allows a basic device demo when the optional local plan is invalid", () => {
    const invalid = structuredClone(testRigTemplates[0]);
    invalid.blocks = invalid.blocks.filter((block) => block.name !== "Capture slot");
    useAppStore.setState({ testRigs: [invalid], selectedTestRigId: invalid.id });
    render(<ToneLabPage/>);
    expect(screen.getByText("Profile-only demo remains available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Audition on HeadRush/i })).toBeEnabled();
  });

  it("reacts immediately when provider readiness changes", () => {
    render(<ToneLabPage/>);
    const audition = screen.getByRole("button", { name: /Audition on HeadRush/i });
    expect(audition).toBeEnabled();
    act(() => useAppStore.setState({ device: { ...demoDevice, status: "syncing" } }));
    expect(audition).toBeDisabled();
    expect(screen.getByText(/finish syncing/i)).toBeInTheDocument();
  });

  it("presents audition and device save as a structured action dock", () => {
    const { container } = render(<ToneLabPage/>);
    const dock = container.querySelector(".audition-actions");
    expect(dock).toHaveAttribute("aria-label", "Tone audition actions");
    expect(dock?.querySelector(".audition-actions__transport")).toContainElement(screen.getByRole("button", { name: /Audition on HeadRush/i }));
    expect(dock?.querySelector(".audition-actions__secondary")).toContainElement(screen.getByRole("button", { name: /Save to device/i }));
    expect(screen.queryByRole("button", { name: /Record test phrase/i })).not.toBeInTheDocument();
  });

  it("keeps stop and restart together while a tone is active", () => {
    useAppStore.setState({ auditioningToneId: tone.id });
    const { container } = render(<ToneLabPage/>);
    const transport = container.querySelector(".audition-actions__transport");
    expect(transport).toHaveClass("is-active");
    expect(transport).toContainElement(screen.getByRole("button", { name: /^Stop$/i }));
    expect(transport).toContainElement(screen.getByRole("button", { name: /Audition again on HeadRush/i }));
  });

  it("uses clear HeadRush audition wording and invokes the selected tone once", () => {
    const audition = vi.spyOn(useAppStore.getState(), "auditionTone").mockResolvedValue();
    render(<ToneLabPage/>);

    const button = screen.getByRole("button", { name: "Audition on HeadRush" });
    fireEvent.click(button);

    expect(audition).toHaveBeenCalledTimes(1);
    expect(audition).toHaveBeenCalledWith(tone);
  });

  it("renders device file failures as text without allowing injected markup", () => {
    useAppStore.setState({ auditionError: "IR could not load <img src=x onerror=alert(1)>" });
    const { container } = render(<ToneLabPage/>);
    expect(screen.getByRole("alert")).toHaveTextContent("IR could not load <img src=x onerror=alert(1)>");
    expect(container.querySelector("img[src='x']")).not.toBeInTheDocument();
  });

  it("explains a missing Test Rig file while preserving the basic audition path", () => {
    const invalid = structuredClone(testRigTemplates[0]);
    invalid.blocks.find((block) => block.category === "ir")!.parameters.find((parameter) => parameter.id === "IR")!.value = "";
    useAppStore.setState({ testRigs: [invalid], selectedTestRigId: invalid.id });
    render(<ToneLabPage/>);
    expect(screen.getByText(/requires a selected ir file before auditioning/i)).toBeInTheDocument();
    expect(screen.getByText(/Profile-only demo remains available/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audition on HeadRush" })).toBeEnabled();
  });

  it("loads HeadRush Cloud only after its provider tab is selected", () => {
    useAppStore.setState({ toneUpdatedAtBySource: { tone3000: Date.now(), headRushCloud: null } });
    const refresh = vi.spyOn(useAppStore.getState(), "refreshToneServices").mockResolvedValue();
    const { container } = render(<ToneLabPage/>);
    const providerTabs = container.querySelector(".tone-provider-switcher");
    expect(providerTabs).toContainElement(screen.getByRole("tab", { name: /Tone3000/i }));
    expect(providerTabs).toContainElement(screen.getByRole("tab", { name: /^HeadRush Cloud$/i }));
    expect(providerTabs?.querySelector(".tone-provider-tabs")?.children).toHaveLength(2);
    expect(screen.queryByText("HeadRush Cloud loads when selected")).not.toBeInTheDocument();
    expect(screen.queryByText("Tone3000 catalogue")).not.toBeInTheDocument();
    expect(refresh.mock.calls.some((call) => call[3] === "HeadRush Cloud")).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^HeadRush Cloud$/i }), { button: 0, ctrlKey: false });
    expect(refresh.mock.calls.filter((call) => call[3] === "HeadRush Cloud")).toHaveLength(1);
  });

  it("requests a 50-item provider batch narrowed to amps when Amp is selected", () => {
    const refresh = vi.spyOn(useAppStore.getState(), "refreshToneServices").mockResolvedValue();
    render(<ToneLabPage/>);
    fireEvent.click(screen.getByRole("button", { name: /^Amp$/ }));
    expect(refresh).toHaveBeenCalledWith(expect.any(String), false, expect.objectContaining({ gear: ["amp"] }), "Tone3000");
    expect(screen.getAllByText(/next 50/i).length).toBeGreaterThan(0);
  });

  it("shows the provider publication date on each Tone3000 result", () => {
    render(<ToneLabPage/>);
    expect(screen.getByText(/Published .*2026/i)).toBeInTheDocument();
  });
});

describe("TonePilot Test Rig Studio UI", () => {
  beforeEach(() => resetTonePilot());
  afterEach(() => cleanup());

  it("renders an explicit responsive 14-slot reference plan", () => {
    const { container } = render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);
    expect(container.querySelector(".tp-config-chain--slots")?.children).toHaveLength(14);
    expect(screen.getByText(/Saved in RushLink until auditioning/i)).toBeInTheDocument();
    expect(screen.getByText(/Capture marker in plan slot/i)).toBeInTheDocument();
    expect(screen.queryByText(/Capture reference/i)).not.toBeInTheDocument();
  });

  it("shows a Test Rig as ready when one of multiple IR selectors has a file", () => {
    const rig = structuredClone(testRigTemplates[0]);
    const ir = rig.blocks.find((block) => block.category === "ir")!;
    const selected = ir.parameters.find((parameter) => parameter.deviceFile)!;
    ir.parameters.unshift({ ...selected, id: "IR1024", sourceProperty: "IR1024", value: "" });
    useAppStore.setState({ testRigs: [rig], selectedTestRigId: rig.id, testRigSets: [{ id: "reference", name: "Reference Run", rigIds: [rig.id] }], selectedTestRigSetId: "reference" });

    render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);

    expect(screen.getByText(/Capture marker in plan slot/i)).toBeInTheDocument();
    expect(screen.queryByText(/Test Rig needs attention/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires a selected ir file/i)).not.toBeInTheDocument();
  });

  it("opens the full 14-slot editor with the categorized device catalogue", () => {
    const { container } = render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: /Full editor/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".tp-editor-slots")?.children).toHaveLength(14);
    expect(screen.getByText("Compatible blocks")).toBeInTheDocument();
    expect(dialog.querySelector('[aria-label="Fixed Test Rig slot roles"]')).toHaveTextContent("DRIVE");
    expect(screen.getByRole("button", { name: /^Favourites$/i })).toBeInTheDocument();
    expect(container.querySelector(".tp-config-chain--slots")?.children).toHaveLength(14);
  });

  it("reflects controls when adding a compatible block and can refresh them from the device", async () => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    let reflectedMix = 0.4;
    const subtree = vi.spyOn(deviceApi, "subtree").mockImplementation(async (path) => ({
      [path ?? "/Evil/Engine/Patch/AIR_Delay"]: {
        meta: { properties: { Mix: { type: "number", minimum: 0, maximum: 1 } } },
        value: { order: ["Mix"], labels: ["Mix"], Mix: reflectedMix },
      },
    }));
    render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: /Full editor/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector<HTMLButtonElement>('[data-chain-slot="2"]')!);
    fireEvent.change(screen.getByPlaceholderText(/Search blocks/i), { target: { value: "AIR Delay" } });
    fireEvent.click(screen.getByText("AIR Delay").closest("button")!);

    await waitFor(() => expect(useAppStore.getState().testRigs[0].blocks.some((block) => block.slot === 2 && block.name === "AIR Delay")).toBe(true));
    expect(subtree).toHaveBeenCalledWith("/Evil/Engine/Patch/AIR_Delay");
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Mix"]')).toHaveValue("0.4");

    reflectedMix = 0.72;
    fireEvent.click(screen.getByRole("button", { name: /Read from device/i }));
    await waitFor(() => expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Mix"]')).toHaveValue("0.72"));
    expect(subtree).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector('.tp-editor-slot[data-chain-slot="2"]')).toHaveTextContent("AIR Delay");
  });

  it("keeps a newly added block usable when older firmware has no reflected schema", async () => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    vi.spyOn(deviceApi, "subtree").mockRejectedValue(new Error("object is not reflected"));
    render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: /Full editor/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector<HTMLButtonElement>('[data-chain-slot="2"]')!);
    fireEvent.change(screen.getByPlaceholderText(/Search blocks/i), { target: { value: "Flanger" } });
    fireEvent.click(screen.getByText("Flanger").closest("button")!);

    await waitFor(() => expect(useAppStore.getState().testRigs[0].blocks.find((block) => block.name === "Flanger")).toMatchObject({ slot: 2, parameters: [] }));
    expect(screen.getByText(/Controls are not cached yet/i)).toBeInTheDocument();
  });

  it("supports catalogue favourites without hiding the selected block", () => {
    render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: /Full editor/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector<HTMLButtonElement>('[data-chain-slot="2"]')!);
    fireEvent.change(screen.getByPlaceholderText(/Search blocks/i), { target: { value: "Flanger" } });
    fireEvent.click(screen.getByRole("button", { name: /Add Flanger to favourites/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Favourites$/i }));

    expect(useAppStore.getState().favoriteBlockNames).toContain("Flanger");
    expect(within(dialog.querySelector(".tp-editor-results")!).getByText("Flanger")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove Flanger from favourites/i })).toHaveClass("favorite");
  });

  it("shows a recoverable empty editor when its selected workspace was removed", () => {
    useAppStore.setState({ testRigs: [], selectedTestRigId: "" });
    const close = vi.fn();
    render(<TestRigEditorDialog open onClose={close}/>);
    expect(screen.getByText("No Test Rig selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drags ordinary effects directly in the visible Test Rig chain", () => {
    useAppStore.setState({ selectedTestRigId: "lead" });
    const { container } = render(<TonePilotTestRigStudio onBrowse={vi.fn()}/>);
    const blocks = [...container.querySelectorAll<HTMLButtonElement>(".tp-config-block")];
    const delay = blocks.find((block) => block.textContent?.includes("Dynamic Lead Delay"))!;
    const drive = blocks.find((block) => block.textContent?.includes("S1 Drive"))!;
    const target = [...container.querySelectorAll<HTMLElement>(".tp-config-slot-empty")].find((slot) => slot.querySelector("small")?.textContent === "11")!;
    const originalHitTest = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => target) });
    const pointerEvent = (type: "pointerDown" | "pointerMove" | "pointerUp", node: Element, clientX: number, clientY: number) => {
      const event = createEvent[type](node, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 7 }, button: { value: 0 }, clientX: { value: clientX }, clientY: { value: clientY } });
      fireEvent(node, event);
    };

    expect(delay).not.toHaveAttribute("draggable");
    expect(drive).toHaveClass("position-locked");
    pointerEvent("pointerDown", delay, 20, 20);
    pointerEvent("pointerMove", delay, 80, 80);
    expect(target).toHaveClass("drop-target");
    expect(document.querySelector(".slot-drag-preview")).toHaveTextContent(/Dynamic Lead Delay/i);
    pointerEvent("pointerUp", delay, 80, 80);

    expect(useAppStore.getState().testRigs.find((rig) => rig.id === "lead")?.blocks.find((block) => block.id === "lead-delay")?.slot).toBe(10);
    if (originalHitTest) Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalHitTest });
    else Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("uses modern sliders and keeps detailed block EQ collapsed", () => {
    const block = testRigTemplates[0].blocks.find((item) => item.name === "IR Loader")!;
    const change = vi.fn();
    const { container } = render(<TestRigParameterEditor parameters={block.parameters} onChange={change}/>);
    expect(container.querySelector(".value-knob")).not.toBeInTheDocument();
    expect(container.querySelector(".tp-parameter-section--files")).toHaveTextContent(/Loaded device file/i);
    expect(container.querySelector(".tp-parameter-grid--files .device-file-control--loaded")?.getAttribute("data-current-file")).toMatch(/\.wav$/i);
    expect(screen.getByText("Core controls")).toBeInTheDocument();
    expect(screen.getByText("Block EQ & routing").closest("details")).not.toHaveAttribute("open");
    const coreMix = container.querySelector<HTMLElement>("section.tp-parameter-section--core")!;
    fireEvent.change(coreMix.querySelector<HTMLInputElement>('input[aria-label="Mix"]')!, { target: { value: "5.5" } });
    expect(change).toHaveBeenCalledWith("Mix", 5.5);
  });

  it("keeps an active audition visible after navigating to another workspace", () => {
    useAppStore.setState({ page: "dashboard", auditioningToneId: tone.id, testRigReturn: { id: demoRigs[0].id, name: demoRigs[0].name, auditionSource: "Tone3000" } });
    render(<AppShell><div>Dashboard content</div></AppShell>);
    const active = screen.getByRole("button", { name: /Audition active/i });
    fireEvent.click(active);
    expect(useAppStore.getState().page).toBe("tone-cloud");
  });
});
