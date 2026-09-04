import { describe, expect, it } from "vitest";
import { defaultLiveStage, testRigTemplates } from "../data/demo-data";
import type { LiveStage } from "./types";
import { assertRushLinkSyncDocument, createRushLinkSyncDocument, mergeRushLinkSyncDocuments, portablePatchFromSyncDocument, type RushLinkSyncDocument, type RushLinkSyncSource } from "./rushlink-sync";

function source(): RushLinkSyncSource {
  return {
    liveStages: [structuredClone(defaultLiveStage)], selectedLiveStageId: defaultLiveStage.id,
    testRigs: structuredClone(testRigTemplates), selectedTestRigId: testRigTemplates[0].id,
    testRigSets: [{ id: "reference", name: "Reference", rigIds: testRigTemplates.map((rig) => rig.id) }], selectedTestRigSetId: "reference",
    favoriteRigIds: ["rig-a"], favoriteToneIds: ["tone-a"], favoriteBlockNames: ["Plate"],
    preferences: { density: "comfortable", reduceMotion: false, highContrast: false, keepAwake: true }, sidebarCollapsed: false,
    savedWorkflows: [{ id: "workflow-a", name: "Sound check", updatedAt: "2026-08-29T10:00:00.000Z", steps: [{ id: "step-a", kind: "load-rig", label: "Load clean", parameters: { rigId: "rig-a" } }] }],
  };
}

const create = (state: RushLinkSyncSource, clientId: string, now: string, previous?: RushLinkSyncDocument) => createRushLinkSyncDocument(state, { accountId: "account-a", clientId, now, previous });

describe("RushLink account settings document", () => {
  it("contains only portable sections and keeps MIDI independent from StageHand layout", () => {
    const state = Object.assign(source(), { device: { host: "192.168.1.129" }, tones: [{ token: "local-cache" }], dropboxToken: "secret", liveSubtree: { temporary: true } });
    const document = create(state, "desktop", "2026-08-29T10:01:00.000Z");
    const serialized = JSON.stringify(document);
    expect(Object.keys(document.sections)).toEqual(["stageHand", "midiMappings", "testRigs", "favourites", "interfacePreferences", "savedWorkflows"]);
    expect(serialized).not.toContain("192.168.1.129");
    expect(serialized).not.toContain("local-cache");
    expect(serialized).not.toContain("secret");
    expect(document.sections.stageHand.data.stages[0].layout.buttons[0]).not.toHaveProperty("midi");
    expect(document.sections.midiMappings.data.stages[defaultLiveStage.id][defaultLiveStage.layout.buttons[0]!.id]).toEqual(defaultLiveStage.layout.buttons[0]!.midi);
  });

  it("preserves section timestamps and revision when nothing changed", () => {
    const first = create(source(), "desktop", "2026-08-29T10:01:00.000Z");
    const second = create(source(), "ios", "2026-08-29T11:00:00.000Z", first);
    expect(second).toEqual(first);
  });

  it("merges independent desktop and iOS section edits without a conflict", () => {
    const base = create(source(), "desktop", "2026-08-29T10:00:00.000Z");
    const desktopState = source(); desktopState.favoriteToneIds.push("tone-desktop");
    const iosState = source(); iosState.liveStages[0].name = "iPad Stage";
    const desktop = create(desktopState, "desktop", "2026-08-29T10:01:00.000Z", base);
    const ios = create(iosState, "ios", "2026-08-29T10:02:00.000Z", base);
    const merged = mergeRushLinkSyncDocuments(desktop, ios, base, "2026-08-29T10:03:00.000Z");
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.sections.stageHand.data.stages[0].name).toBe("iPad Stage");
    expect(merged.document.sections.favourites.data.toneIds).toContain("tone-desktop");
    expect(merged.changedSections).toEqual(["favourites"]);
    expect(merged.expectedRevision).toBe(ios.revision);
  });

  it("reports concurrent edits to the same section and resolves them deterministically", () => {
    const base = create(source(), "desktop", "2026-08-29T10:00:00.000Z");
    const desktopState = source(); desktopState.favoriteToneIds = ["desktop-choice"];
    const iosState = source(); iosState.favoriteToneIds = ["ios-choice"];
    const desktop = create(desktopState, "desktop", "2026-08-29T10:01:00.000Z", base);
    const ios = create(iosState, "ios", "2026-08-29T10:02:00.000Z", base);
    const merged = mergeRushLinkSyncDocuments(desktop, ios, base);
    expect(merged.conflicts).toEqual([{ section: "favourites", winner: "remote", localUpdatedAt: "2026-08-29T10:01:00.000Z", remoteUpdatedAt: "2026-08-29T10:02:00.000Z" }]);
    expect(merged.document.sections.favourites.data.toneIds).toEqual(["ios-choice"]);
  });

  it("materializes MIDI back into each stage without touching local-only preferences", () => {
    const current = source().liveStages;
    const document = create(source(), "desktop", "2026-08-29T10:01:00.000Z");
    const stageId = document.sections.stageHand.data.stages[0].id;
    const buttonId = document.sections.stageHand.data.stages[0].layout.buttons[0]!.id;
    document.sections.midiMappings.data.stages[stageId][buttonId] = { type: "cc", channel: 4, number: 99, value: 100, releaseValue: 0 };
    const patch = portablePatchFromSyncDocument(document, current as LiveStage[]);
    expect(patch.liveStages[0].layout.buttons[0]!.midi).toMatchObject({ channel: 4, number: 99, value: 100 });
    expect(patch.preferences).toEqual({ density: "comfortable", reduceMotion: false, highContrast: false, keepAwake: true, sidebarCollapsed: false });
  });

  it("rejects malformed account documents before they reach the store", () => {
    expect(() => assertRushLinkSyncDocument({ format: "rushlink-sync", schemaVersion: 99 })).toThrow(/Unsupported/);
  });
});
