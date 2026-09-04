import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionPalette, defaultLiveLayout, defaultLiveStage, demoRigs, demoSetlists } from "../data/demo-data";
import { deviceApi } from "../services/device-api";
import { useAppStore } from "../stores/app-store";
import { flexPrimeMidiCommand } from "./headrush-midi";
import { LIVE_DECK_ACTIONS, normalizeLiveDeckActions } from "./live-layout";
import { drumMethodForTarget } from "./stage-actions";
import { canonicalLiveSwitchType } from "./stage-gestures";
import type { LiveButton } from "./types";

const catalogueCases = actionPalette.map((template, index) => [`${String(index + 1).padStart(2, "0")} / ${template.group} / ${template.label}`, template] as const);

describe("every StageHand catalogue block", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    useAppStore.setState({
      liveLayout: structuredClone(defaultLiveLayout),
      liveStages: [structuredClone(defaultLiveStage)],
      selectedLiveStageId: defaultLiveStage.id,
      rigs: structuredClone(demoRigs),
      selectedRigId: demoRigs[0].id,
      setlists: structuredClone(demoSetlists),
      selectedSetlistId: demoSetlists[0].id,
      liveSnapshot: null,
      liveSubtree: {},
      diagnostics: [],
      preferences: { ...useAppStore.getState().preferences, writeMode: "immediate", confirmRigReplacement: false },
    });
  });

  it("keeps every user capability represented once without freezing the catalogue size", () => {
    const identity = (button: (typeof actionPalette)[number]) => [button.group, button.action, button.target ?? "", button.widget ?? "", button.widgetLayout ?? ""].join("/");
    expect(new Set(actionPalette.map(identity)).size).toBe(actionPalette.length);
    expect(actionPalette.filter((button) => button.action === "scene").map((button) => button.target)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(actionPalette.filter((button) => button.group === "Rig").map((button) => button.action)).toEqual(["rig-prev", "rig-next"]);
    expect(actionPalette.filter((button) => button.group === "Drums").map((button) => button.target)).toEqual(["toggle", "fill", "accent", "bridge", "outro", "mute"]);
    expect(actionPalette.filter((button) => button.group === "Drum decks").map((button) => button.widgetLayout)).toEqual(["1x4", "2x3", "1x3", "2x2"]);
    expect(actionPalette.some((button) => button.action === "tap-tempo")).toBe(true);
    expect(actionPalette.filter((button) => button.action === "tuner").map((button) => button.widget ?? "device")).toEqual(["device", "tuner"]);
    expect(actionPalette.filter((button) => button.multiFunction).map((button) => button.action)).toEqual(["custom"]);
  });

  it.each(catalogueCases)("%s has a valid gesture, icon, colour and transport", (_name, template) => {
    const button = { ...structuredClone(template), id: "catalogue-audit" } as LiveButton;
    expect(button.label.trim()).not.toBe("");
    expect(button.subtitle.trim()).not.toBe("");
    expect(button.icon.trim()).not.toBe("");
    expect(button.color.trim()).not.toBe("");
    expect(["trigger", "toggle", "momentary", "hold", "multi"]).toContain(canonicalLiveSwitchType(button));
    expect(button.midi.channel).toBeGreaterThanOrEqual(1);
    expect(button.midi.channel).toBeLessThanOrEqual(16);
    expect(button.midi.number).toBeGreaterThanOrEqual(0);
    expect(button.midi.number).toBeLessThanOrEqual(127);

    if (button.action === "scene") expect(button.midi.number).toBe(21 + "ABCDEF".indexOf(button.target ?? "A"));
    if (button.action === "rig-prev") expect(button.midi.number).toBe(16);
    if (button.action === "rig-next") expect(button.midi.number).toBe(17);
    if (button.action === "tap-tempo") expect(button.midi.number).toBe(64);
    if (button.action === "tuner") expect(button.midi.number).toBe(92);
    expect(["looper", "practice", "expression"]).not.toContain(button.action);
  });

  it.each(catalogueCases)("%s dispatches through its intended StageHand path", async (_name, template) => {
    const execute = vi.spyOn(deviceApi, "executeLiveAction").mockResolvedValue({ status: 200, body: {} });
    const loadRig = vi.fn(async () => undefined);
    const refreshPage = vi.fn(async () => undefined);
    const source = structuredClone(template);
    const button: LiveButton = {
      ...source,
      id: `audit-${source.action}-${source.target ?? "default"}`,
      ...(source.multiFunction ? { tapBinding: { action: "scene", target: "A", label: "Audit scene" } } : {}),
    };
    const layout = { ...structuredClone(defaultLiveLayout), buttons: [button, ...Array(defaultLiveLayout.buttons.length - 1).fill(null)] };
    useAppStore.setState({ liveLayout: layout, liveStages: [{ ...structuredClone(defaultLiveStage), layout }], loadRig, refreshPage });

    if (button.action === "rig-prev") useAppStore.setState({ selectedRigId: demoSetlists[0].items[1].rigId });
    if (button.action === "rig-next") useAppStore.setState({ selectedRigId: demoSetlists[0].items[0].rigId });
    await expect(useAppStore.getState().triggerLiveButton(button.id)).resolves.toBe(true);

    if (button.action === "rig-prev") expect(loadRig).toHaveBeenCalledWith(demoSetlists[0].items[0].rigId);
    else if (button.action === "rig-next") expect(loadRig).toHaveBeenCalledWith(demoSetlists[0].items[1].rigId);
    else expect(execute).toHaveBeenCalledOnce();
  });
});

describe("every internal StageHand deck command", () => {
  it.each(LIVE_DECK_ACTIONS.drums)("Drummer · %s has both an HTTP method and documented MIDI command", (target) => {
    const gesture = target === "accent" ? "press" : "release";
    expect(drumMethodForTarget(target, gesture)).not.toBeNull();
    expect(flexPrimeMidiCommand("drums", target).number).toBeGreaterThanOrEqual(42);
    expect(flexPrimeMidiCommand("drums", target).number).toBeLessThanOrEqual(47);
    if (target === "accent") expect(drumMethodForTarget(target, "release")).toBe("stopAccent");
  });

  it.each(actionPalette.filter((item) => item.widget === "drums").map((item) => [`${item.label}`, item] as const))
  ("%s exposes exactly the number of usable buttons its footprint promises", (_label, template) => {
    const actions = normalizeLiveDeckActions("drums", template.widgetLayout!, template.widgetActions);
    expect(actions).toHaveLength(Number(template.widgetLayout![0]) * Number(template.widgetLayout![2]));
    expect(actions.every((target) => target.length > 0)).toBe(true);
  });
});
