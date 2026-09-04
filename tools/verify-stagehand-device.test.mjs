import { describe, expect, it } from "vitest";
import { STAGEHAND_REQUIREMENTS, stageHandStateSummary, validateStageHandContract, verifyStageHandLive } from "./verify-stagehand-device.mjs";

function reflectedTree() {
  const tree = {};
  for (const requirement of STAGEHAND_REQUIREMENTS) {
    const properties = Object.fromEntries((requirement.properties ?? []).map((property) => [property, { type: property.startsWith("SceneActive") ? "boolean" : "number" }]));
    const value = Object.fromEntries((requirement.properties ?? []).map((property) => [property, property.startsWith("SceneActive") ? property === "SceneActive4" : 0]));
    tree[requirement.path] = {
      meta: { properties, "x-methods": Object.fromEntries((requirement.methods ?? []).map((method) => [method, { argumentsMeta: [] }])) },
      value,
    };
  }
  Object.assign(tree["/Evil/Engine/FootSwitch"].value, { LastScene: 3, LastSceneState: 0 });
  Object.assign(tree["/Evil/Engine/Patch/Rig"].value, { PresetName: "Live Rig", Tempo: 120 });
  Object.assign(tree["/Evil/Engine/AudioCtrl/Input"].value, { TunerOn: false });
  Object.assign(tree["/Evil/Engine/AudioCtrl/Tuner"].value, { TunerMuting: true });
  return tree;
}

function fakeClient({ failScene } = {}) {
  const values = {
    "/Evil/Engine/FootSwitch": { LastScene: 3, LastSceneState: 0, ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`SceneActive${index + 1}`, index === 3])) },
    "/Evil/Engine/AudioCtrl/Input": { TunerOn: false },
    "/Evil/Engine/AudioCtrl/Tuner": { TunerMuting: true },
    "/Evil/Engine/DrumsCtrl": { isPlaying: false, isMuted: false },
  };
  const calls = [];
  return {
    values,
    calls,
    async getProperties(path) { return structuredClone(values[path]); },
    async setProperties(path, patch) {
      calls.push(["set", path, structuredClone(patch)]);
      if (path === "/Evil/Engine/FootSwitch") {
        const selected = Object.keys(patch).find((property) => property.startsWith("SceneActive"));
        const index = selected ? Number(selected.replace("SceneActive", "")) - 1 : -1;
        if (index === failScene) throw new Error("injected scene failure");
        if (index >= 0) {
          values[path].LastScene = index;
          for (let scene = 0; scene < 6; scene += 1) values[path][`SceneActive${scene + 1}`] = scene === index;
        }
      } else Object.assign(values[path], patch);
      return structuredClone(values[path]);
    },
    async callMethod(path, method) {
      calls.push(["method", path, method]);
      if (method === "togglePlay") values[path].isPlaying = !values[path].isPlaying;
      if (method === "toggleMute") values[path].isMuted = !values[path].isMuted;
      return {};
    },
  };
}

describe("StageHand live device verifier", () => {
  it("requires the actual SceneActive write controls, not readback-only LastScene", () => {
    const checks = validateStageHandContract(reflectedTree());
    expect(checks.filter((check) => check.capability.includes("SceneActive") && check.capability.endsWith(" write"))).toHaveLength(6);
    expect(checks.some((check) => check.capability.endsWith("LastScene write"))).toBe(false);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("reports useful current StageHand state", () => {
    const summary = stageHandStateSummary(reflectedTree());
    expect(summary).toMatchObject({ rig: "Live Rig", scene: 4, tuner: { open: false, muted: true } });
  });

  it("exercises all six scenes and both tuner controls, then restores the pedal", async () => {
    const client = fakeClient();
    const checks = await verifyStageHandLive(client, { settleMs: 0 });
    expect(checks).toHaveLength(9);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(client.values["/Evil/Engine/FootSwitch"].LastScene).toBe(3);
    expect(client.values["/Evil/Engine/AudioCtrl/Input"].TunerOn).toBe(false);
    expect(client.values["/Evil/Engine/AudioCtrl/Tuner"].TunerMuting).toBe(true);
    expect(client.calls.filter(([method, path]) => method === "set" && path === "/Evil/Engine/FootSwitch")).toHaveLength(7);
    expect(client.calls.some(([method]) => method === "method")).toBe(false);
  });

  it("records a failed control without abandoning restoration", async () => {
    const client = fakeClient({ failScene: 1 });
    const checks = await verifyStageHandLive(client, { settleMs: 0 });
    expect(checks.find((check) => check.capability === "Scene B activation")).toMatchObject({ ok: false });
    expect(checks.at(-1)).toMatchObject({ capability: "Original device state restored", ok: true });
    expect(client.values["/Evil/Engine/FootSwitch"].LastScene).toBe(3);
  });

  it("only exercises audible drummer transport when explicitly requested", async () => {
    const client = fakeClient();
    const checks = await verifyStageHandLive(client, { performance: true, settleMs: 0 });
    expect(checks.some((check) => check.capability === "Drummer play/stop" && check.ok)).toBe(true);
    expect(checks.some((check) => check.capability === "Drummer mute/unmute" && check.ok)).toBe(true);
    expect(client.values["/Evil/Engine/DrumsCtrl"]).toEqual({ isPlaying: false, isMuted: false });
  });
});
