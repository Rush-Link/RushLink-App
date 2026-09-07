import type { HeadRushPropertyMeta, HeadRushSubtree } from "../../domain/types";

const numeric = (minimum: number, maximum: number, normalizeAlgo = 0): HeadRushPropertyMeta => ({
  type: "number", minimum, maximum, "x-options": { normalizeAlgo },
});

/** Handwritten protocol examples with fictional state; never derived from private device captures. */
export function createHeadRushReflectionFixture(): HeadRushSubtree {
  return {
    "/Evil/Gui": { value: { DeviceName: "Reflection Test Device", AppVersion: "0.0.0-fixture" } },
    "/Evil/API/Blocks": {
      value: { ModuleTypes: ["", "Meadow Gate", "Copper Wah", "Lantern Drive", "Harbour Amp"] },
    },
    "/Evil/API/Rigs": {
      value: {
        loadedID: "fixture-rig-1", loadedName: "Fixture Rhythm", loadedColor: 3,
        AllRigIds: ["fixture-rig-1"], AllRigNames: ["Fixture Rhythm"], AllRigColors: [3],
      },
    },
    "/Evil/API/Setlists": {
      value: {
        loadedID: "fixture-setlist-1", loadedName: "Fixture Set",
        SetlistIds: ["fixture-setlist-1"], SetlistNames: ["Fixture Set"], SetlistCounts: [1],
      },
    },
    "/Evil/Engine/Patch/Rig": {
      meta: { properties: { PresetName: { type: "string" }, Tempo: numeric(30, 240) } },
      value: { PresetName: "Fixture Rhythm", Tempo: 3 / 7 },
    },
    "/Evil/Engine/Patch/Chain": {
      value: {
        Routing: 0, RigIsStereo: true, Tails: false, Lock: false,
        ...Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
          `ModuleType${index + 1}`, index < 4 ? index + 1 : 0,
        ])),
      },
    },
    "/Evil/Engine/Patch/Input": {
      meta: { properties: {
        RigInput: { type: "boolean", "x-options": { strings: ["Guitar", "FX Ret L"] } },
        InputGain: numeric(-200, 6, 8),
        GateRelease: numeric(0, 4, 7),
        Lock: { type: "boolean", "x-options": { strings: ["Unlocked", "Locked"] } },
      } },
      value: {
        order: ["RigInput", "Lock", "GateRelease", "InputGain"],
        labels: ["Rig Input", "Lock", "Gate Rel", "Input Gain"],
        RigInput: false, InputGain: 0.8, GateRelease: 0.6, Lock: false,
      },
    },
    "/Evil/Engine/Patch/Meadow_Gate": {
      meta: { properties: {
        On: { type: "boolean" }, Threshold: numeric(-200, 6, 8), Release: numeric(0, 4, 7),
        SltEQOn: { type: "boolean" }, SltEQF: numeric(20, 20_000, 6),
        SltEQG: numeric(-18, 18, 1), SltEQQ: numeric(0.2, 10, 5),
        SltEQHP: numeric(20, 20_000, 6), SltEQLP: numeric(20, 20_000, 6),
      } },
      value: {
        order: ["On", "Threshold", "Release"], labels: ["Enabled", "Threshold", "Release"],
        PresetName: "Fixture Gate", On: true, Threshold: 0.25, Release: 0.6,
        SltEQOn: true, SltEQF: 0.4, SltEQG: 0.25, SltEQQ: 0.5, SltEQHP: 0.2, SltEQLP: 0.9,
      },
    },
    "/Evil/Engine/Patch/Copper_Wah": {
      meta: { properties: {
        Position: numeric(0, 100), Sweep: numeric(20_000, 20),
        Channel: { type: "integer", minimum: 1, maximum: 16 },
      } },
      value: { PresetName: "Fixture Wah", On: false, Position: 0.4, Sweep: 0.3, Channel: 7 },
    },
    "/Evil/Engine/Patch/Lantern_Drive": {
      meta: { properties: {
        Drive: numeric(0, 100, 5), Balance: numeric(-100, 100, 4), Level: numeric(-200, 0, 2),
      } },
      value: { PresetName: "Fixture Drive", On: true, Drive: 0.36, Balance: 0.75, Level: 0.5 },
    },
    "/Evil/Engine/Patch/Harbour_Amp": {
      meta: { properties: {
        Gain: numeric(0, 1, 9), LowGain: numeric(0, 1, 9), Ratio: numeric(0.45, 145, 10),
      } },
      value: { PresetName: "Fixture Amp", On: true, Gain: 0.7, LowGain: 0.1, Ratio: 0.5 },
    },
    "/Evil/Engine/GlobalEQ": {
      meta: { properties: {
        Gain: numeric(-18, 18, 1), Frequency: numeric(20, 20_000, 6),
        Q: numeric(0.1, 10, 5), ReverseGain: numeric(12, -12),
      } },
      value: { Gain: 0.25, Frequency: 0.4, Q: 0.6, ReverseGain: 0.7 },
    },
    "/Evil/Engine/DrumsCtrl": {
      meta: { properties: { Kit: { type: "string" }, StyleVari: { type: "string" } } },
      value: {
        Kit: "Fixture Kit A", KitList: ["Fixture Kit A", "Fixture Kit B"],
        Style: "Fixture Groove", StyleVari: "Verse", StyleVariList: ["Verse", "Chorus", "Fill"],
        isPlaying: false, isMuted: false,
      },
    },
    "/Evil/Cloud/Master": { value: { isloggedIn: true, loginInProgress: false } },
    "/Evil/API/Tone3000": { value: { isLoggedIn: true, searchInProgress: false } },
  };
}
