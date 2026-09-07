import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionPalette, defaultLiveLayout, defaultLiveStage, demoRigs, testRigTemplates } from "../data/demo-data";
import { deviceApi } from "../services/device-api";
import { APP_STATE_VERSION, mergePersistedAppState, migratePersistedAppState, useAppStore } from "./app-store";

describe("app-store migration and recovery", () => {
  beforeEach(() => {
    useAppStore.setState({
      liveLayout: structuredClone(defaultLiveLayout),
      liveStages: [structuredClone(defaultLiveStage)],
      selectedLiveStageId: defaultLiveStage.id,
      testRigs: structuredClone(testRigTemplates),
      favoriteRigIds: [],
      testRigReturn: null,
      auditionError: null,
    });
  });

  const current = () => useAppStore.getState();

  it.each([null, undefined, 42, "workspace", [], true])("ignores a non-object persisted payload: %j", (payload) => {
    expect(migratePersistedAppState(payload, 0)).toEqual({});
    const merged = mergePersistedAppState(payload, current());
    expect(merged.liveStages).toHaveLength(1);
    expect(merged.liveLayout).toEqual(current().liveLayout);
    expect(merged.testRigs).toHaveLength(testRigTemplates.length);
  });

  it("does not run Test Rig migrations against a malformed collection", () => {
    const malformed = { testRigs: "not-an-array", favoriteRigIds: ["remote-rig"] };
    expect(migratePersistedAppState(malformed, 1)).toEqual(malformed);
    const merged = mergePersistedAppState(malformed, current());
    expect(merged.testRigs.map((rig) => rig.id)).toEqual(testRigTemplates.map((rig) => rig.id));
    expect(merged.favoriteRigIds).toEqual(["remote-rig"]);
  });

  it("applies both historical Test Rig migrations to a version-1 workspace", () => {
    const rhythm = structuredClone(testRigTemplates.find((rig) => rig.id === "rhythm")!);
    rhythm.blocks = rhythm.blocks.map((block) => {
      if (block.id === "rhythm-amp") return { ...block, slot: 5 };
      if (block.id === "rhythm-eq") return { ...block, slot: 8 };
      if (block.id === "rhythm-ir") return { ...block, parameters: block.parameters.filter((parameter) => parameter.id !== "IR") };
      return block;
    });

    const migrated = migratePersistedAppState({ testRigs: [rhythm] }, 1).testRigs![0];
    const reference = testRigTemplates.find((rig) => rig.id === "rhythm")!;
    expect(migrated.blocks.find((block) => block.id === "rhythm-amp")?.slot).toBe(4);
    expect(migrated.blocks.find((block) => block.id === "rhythm-eq")?.slot).toBe(reference.blocks.find((block) => block.id === "rhythm-eq")?.slot);
    expect(migrated.blocks.find((block) => block.id === "rhythm-ir")?.parameters.find((parameter) => parameter.id === "IR")).toMatchObject({
      sourceProperty: "IR",
      writable: true,
      deviceFile: { fileType: 2, startPath: "Impulse Responses" },
    });
  });

  it("leaves a current-version custom Test Rig order untouched during version migration", () => {
    const lead = structuredClone(testRigTemplates.find((rig) => rig.id === "lead")!);
    lead.blocks = lead.blocks.map((block) => block.category === "delay" ? { ...block, slot: 2 } : block.category === "reverb" ? { ...block, slot: 4 } : block);

    const migrated = migratePersistedAppState({ testRigs: [lead] }, APP_STATE_VERSION).testRigs![0];
    expect(migrated.blocks.find((block) => block.category === "delay")?.slot).toBe(2);
    expect(migrated.blocks.find((block) => block.category === "reverb")?.slot).toBe(4);
  });

  it("applies the revised IR bandwidth only when upgrading an older workspace", () => {
    const legacy = structuredClone(testRigTemplates.find((rig) => rig.id === "clean")!);
    const legacyIr = legacy.blocks.find((block) => block.id === "clean-ir")!;
    legacyIr.parameters.find((parameter) => parameter.id === "LoCut")!.value = 75;
    legacyIr.parameters.find((parameter) => parameter.id === "HiCut")!.value = 8500;

    const upgraded = migratePersistedAppState({ testRigs: [legacy] }, 5).testRigs![0];
    const upgradedIr = upgraded.blocks.find((block) => block.id === "clean-ir")!;
    expect(upgradedIr.parameters.find((parameter) => parameter.id === "LoCut")?.value).toBe(65);
    expect(upgradedIr.parameters.find((parameter) => parameter.id === "HiCut")?.value).toBe(12000);

    const current = migratePersistedAppState({ testRigs: [legacy] }, APP_STATE_VERSION).testRigs![0];
    const currentIr = current.blocks.find((block) => block.id === "clean-ir")!;
    expect(currentIr.parameters.find((parameter) => parameter.id === "LoCut")?.value).toBe(75);
    expect(currentIr.parameters.find((parameter) => parameter.id === "HiCut")?.value).toBe(8500);
  });

  it("recovers malformed StageHand dimensions, spacing, controls and missing MIDI", () => {
    const tuner = actionPalette.find((button) => button.action === "tuner" && !button.widget)!;
    const buttons = Array(12).fill(null);
    buttons[0] = { ...structuredClone(tuner), id: "legacy-tuner", midi: undefined, switchType: undefined, holdBinding: undefined };
    buttons[1] = { id: "bad-action", action: "launch-missiles", midi: {} };
    buttons[11] = { id: "scene-c", action: "scene", target: "C", label: "SCENE C", subtitle: "", color: "violet", icon: "layers", midi: { type: "cc", channel: 99, number: 70, value: 999 } };

    const merged = mergePersistedAppState({
      liveLayout: { model: "Unknown", rows: Number.NaN, columns: 2, firstRowColumns: 99, locked: "yes", spacing: { columnGap: 900, insetLeft: -20 }, buttons },
      liveStages: [],
      selectedLiveStageId: "missing",
    }, current());

    expect(merged.liveLayout).toMatchObject({ model: defaultLiveLayout.model, rows: 4, columns: 8, firstRowColumns: 8, locked: defaultLiveLayout.locked });
    expect(merged.liveLayout.spacing).toMatchObject({ columnGap: 40, insetLeft: 0 });
    expect(merged.liveLayout.buttons).toHaveLength(32);
    expect(merged.liveLayout.buttons[1]).toBeNull();
    expect(merged.liveLayout.buttons[0]).toMatchObject({ action: "tuner", switchType: "multi", holdMs: 650, holdBinding: { action: "tuner", target: "mute" } });
    expect(merged.liveLayout.buttons[0]?.midi).toMatchObject({ type: "cc", channel: 1, number: 92 });
    expect(merged.liveLayout.buttons[11]?.midi).toMatchObject({ type: "cc", channel: 1, number: 23, value: 127 });
    expect(merged.selectedLiveStageId).toBe(defaultLiveStage.id);
  });

  it("deduplicates stages, drops broken entries, and keeps a valid selected stage", () => {
    const first = { id: "stage-a", name: "", layout: structuredClone(defaultLiveLayout) };
    const second = { id: "stage-b", name: "Lead", rigId: demoRigs[1].id, layout: structuredClone(defaultLiveLayout) };
    const merged = mergePersistedAppState({ liveStages: [null, { name: "Missing id" }, first, { ...first, name: "Duplicate" }, second], selectedLiveStageId: "stage-b" }, current());

    expect(merged.liveStages.map((stage) => stage.id)).toEqual(["stage-a", "stage-b"]);
    expect(merged.liveStages[0].name).toBe("Recovered stage");
    expect(merged.selectedLiveStageId).toBe("stage-b");
    expect(merged.liveLayout).toBe(merged.liveStages[1].layout);
  });

  it("falls back from an incomplete catalogue cursor and normalizes a complete one", () => {
    const stale = mergePersistedAppState({ toneCursor: { tone3000: { query: "old" } }, toneHasMore: true }, current());
    expect(stale.toneCursor).toBe(current().toneCursor);
    expect(stale.toneHasMore).toBe(false);

    const recovered = mergePersistedAppState({
      toneCursor: {
        tone3000: { query: "amp", nextPage: 3, filters: { gear: "amp", sizes: ["a2", 7], tags: ["metal", "clean"], makes: null, creators: ["Ada"] } },
        headRushCloud: { query: "cloud", nextToken: "next" },
      },
      toneHasMore: true,
      toneHasMoreBySource: { tone3000: true, headRushCloud: false },
      toneUpdatedAtBySource: { tone3000: 123 },
    }, current());

    expect(recovered.toneCursor.tone3000).toMatchObject({ query: "amp", nextPage: 3 });
    expect(recovered.toneCursor.tone3000.filters).toMatchObject({ gear: [], sizes: ["a2"], tags: ["clean", "metal"], makes: [], creators: ["Ada"] });
    expect(recovered.toneHasMore).toBe(true);
    expect(recovered.toneHasMoreBySource).toEqual({ tone3000: true, headRushCloud: false });
    expect(recovered.toneUpdatedAtBySource).toEqual({ tone3000: 123, headRushCloud: null });
  });

  it("cleans orphaned Test Rig set entries and session-only audition state", () => {
    const merged = mergePersistedAppState({
      testRigSets: [{ id: "valid-set", name: "Session", rigIds: ["clean", "missing"] }, { id: "broken", rigIds: "clean" }],
      selectedTestRigSetId: "valid-set",
      testRigReturn: { rigId: "stale" },
      auditionError: "stale failure",
    }, current());

    expect(merged.testRigSets).toEqual([{ id: "valid-set", name: "Session", rigIds: ["clean"] }]);
    expect(merged.selectedTestRigSetId).toBe("valid-set");
    expect(merged.testRigReturn).toBeNull();
    expect(merged.auditionError).toBeNull();
  });

  it("removes only seeded demo favourites in native builds", () => {
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    const merged = mergePersistedAppState({ favoriteRigIds: [demoRigs[0].id, "another-device-rig", 42] }, current());
    expect(merged.favoriteRigIds).toEqual(["another-device-rig"]);
  });
});
