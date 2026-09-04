import { beforeEach, describe, expect, it } from "vitest";
import { defaultLiveLayout, defaultLiveStage, testRigTemplates } from "../data/demo-data";
import { useAppStore } from "./app-store";
import { applyRushLinkSyncDocument, captureRushLinkSyncDocument } from "./sync-adapter";

describe("RushLink Sync store adapter", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      liveStages: [structuredClone(defaultLiveStage)], liveLayout: structuredClone(defaultLiveLayout), selectedLiveStageId: defaultLiveStage.id,
      testRigs: structuredClone(testRigTemplates), selectedTestRigId: testRigTemplates[0].id,
      testRigSets: [], selectedTestRigSetId: "", favoriteRigIds: [], favoriteToneIds: [], favoriteBlockNames: [], favoriteLiveControlKeys: [], liveControlPresets: [], savedWorkflows: [],
      liveSubtree: { "/temporary": { value: { sessionOnly: true } } },
    });
  });

  it("applies portable settings while preserving the local device address and write policy", () => {
    const original = useAppStore.getState().preferences;
    const document = captureRushLinkSyncDocument("account-a", "desktop", null, "2026-08-29T10:00:00.000Z");
    document.sections.interfacePreferences.data.density = "stage";
    document.sections.interfacePreferences.data.sidebarCollapsed = true;
    document.sections.favourites.data.toneIds = ["tone-from-ios"];
    applyRushLinkSyncDocument(document);
    const state = useAppStore.getState();
    expect(state.preferences.density).toBe("stage");
    expect(state.sidebarCollapsed).toBe(true);
    expect(state.favoriteToneIds).toEqual(["tone-from-ios"]);
    expect(state.preferences.address).toBe(original.address);
    expect(state.preferences.writeMode).toBe(original.writeMode);
    expect(state.liveSubtree?.["/temporary"]?.value?.sessionOnly).toBe(true);
  });

  it("round-trips reusable controls and StageHand favourites between clients", () => {
    const { id: _id, ...button } = structuredClone(defaultLiveLayout.buttons[0]!);
    useAppStore.setState({
      favoriteLiveControlKeys: ["preset:lead"],
      liveControlPresets: [{ id: "lead", name: "Lead control", createdAt: "2026-08-29T10:00:00.000Z", button }],
    });
    const document = captureRushLinkSyncDocument("account-a", "desktop", null, "2026-08-29T10:00:00.000Z");
    useAppStore.setState({ favoriteLiveControlKeys: [], liveControlPresets: [] });
    applyRushLinkSyncDocument(document);
    expect(useAppStore.getState().favoriteLiveControlKeys).toEqual(["preset:lead"]);
    expect(useAppStore.getState().liveControlPresets[0]).toMatchObject({ id: "lead", name: "Lead control" });
    expect(useAppStore.getState().liveControlPresets[0].button.midi).toEqual(button.midi);
  });

  it("preserves a user's custom Test Rig order when syncing", () => {
    const document = captureRushLinkSyncDocument("account-a", "ios", null, "2026-08-29T10:00:00.000Z");
    const lead = document.sections.testRigs.data.templates.find((rig) => rig.id === "lead")!;
    lead.blocks = lead.blocks.map((block) => block.category === "delay" ? { ...block, slot: 2 } : block.category === "reverb" ? { ...block, slot: 4 } : block);

    applyRushLinkSyncDocument(document);

    const stored = useAppStore.getState().testRigs.find((rig) => rig.id === "lead")!;
    const ir = stored.blocks.find((block) => block.category === "ir")!;
    const delay = stored.blocks.find((block) => block.category === "delay")!;
    const reverb = stored.blocks.find((block) => block.category === "reverb")!;
    expect(ir.slot).toBe(7);
    expect(delay.slot).toBe(2);
    expect(reverb.slot).toBe(4);
  });
});
