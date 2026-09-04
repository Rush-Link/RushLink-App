#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const STAGEHAND_REQUIREMENTS = [
  { path: "/Evil/Engine/Patch/Rig", properties: ["PresetName", "Tempo"] },
  { path: "/Evil/Engine/Patch/Chain", properties: Array.from({ length: 14 }, (_, index) => `ModuleType${index + 1}`) },
  {
    path: "/Evil/Engine/FootSwitch",
    properties: ["LastScene", "LastSceneState", ...Array.from({ length: 6 }, (_, index) => `SceneActive${index + 1}`)],
    writable: Array.from({ length: 6 }, (_, index) => `SceneActive${index + 1}`),
  },
  {
    path: "/Evil/Engine/DrumsCtrl",
    properties: ["Kit", "PartInfo", "currentBar", "currentBeat", "isMuted", "isPlaying"],
    methods: ["togglePlay", "playFill", "playBridge", "playOutro", "toggleMute", "playAccent", "stopAccent", "restart"],
  },
  { path: "/Evil/Engine/AudioCtrl/Input", properties: ["TunerOn"], writable: ["TunerOn"] },
  { path: "/Evil/Engine/AudioCtrl/Tuner", properties: ["TunerMuting"], writable: ["TunerMuting"] },
  { path: "/Evil/Engine/FFTCtrl", properties: ["TunerCents", "TunerRef", "TunerString"] },
  { path: "/Evil/Engine/Tempo", properties: ["Tempo"], writable: ["Tempo"] },
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const bool = (value) => value === true || value === 1;

function propertyMetadata(entry, name) {
  return entry?.meta?.properties?.[name];
}

function displayNumber(entry, property, fallback = 0) {
  const raw = Number(entry?.value?.[property]);
  if (!Number.isFinite(raw)) return fallback;
  const meta = propertyMetadata(entry, property);
  if (!meta || meta.type === "integer" || raw < 0 || raw > 1 || !Number.isFinite(Number(meta.minimum)) || !Number.isFinite(Number(meta.maximum))) return raw;
  const minimum = Number(meta.minimum);
  const maximum = Number(meta.maximum);
  const algorithm = Number(meta["x-options"]?.normalizeAlgo ?? 0);
  if (algorithm === 5) return minimum + (maximum - minimum) * raw * raw;
  if (algorithm === 6 && minimum > 0) return minimum * Math.exp(Math.log(maximum / minimum) * raw);
  return minimum + (maximum - minimum) * raw;
}

export function validateStageHandContract(tree) {
  const checks = [];
  for (const requirement of STAGEHAND_REQUIREMENTS) {
    const entry = tree?.[requirement.path];
    checks.push({ ok: Boolean(entry), capability: requirement.path, detail: entry ? "object available" : "object missing" });
    if (!entry) continue;
    for (const property of requirement.properties ?? []) {
      const meta = propertyMetadata(entry, property);
      const hasValue = Object.prototype.hasOwnProperty.call(entry.value ?? {}, property);
      checks.push({ ok: Boolean(meta) && hasValue, capability: `${requirement.path}.${property}`, detail: !meta ? "metadata missing" : !hasValue ? "live value missing" : "readable" });
    }
    for (const property of requirement.writable ?? []) {
      const meta = propertyMetadata(entry, property);
      checks.push({ ok: Boolean(meta) && meta.readOnly !== true, capability: `${requirement.path}.${property} write`, detail: !meta ? "metadata missing" : meta.readOnly === true ? "marked read-only" : "advertised writable" });
    }
    for (const method of requirement.methods ?? []) {
      const available = Boolean(entry.meta?.["x-methods"]?.[method]);
      checks.push({ ok: available, capability: `${requirement.path}.${method}()`, detail: available ? "method advertised" : "method missing" });
    }
  }
  return checks;
}

export function stageHandStateSummary(tree) {
  const entry = (path) => tree?.[path] ?? { value: {}, meta: { properties: {} } };
  const value = (path) => entry(path).value ?? {};
  const rig = value("/Evil/Engine/Patch/Rig");
  const chain = value("/Evil/Engine/Patch/Chain");
  const footswitch = value("/Evil/Engine/FootSwitch");
  const drums = value("/Evil/Engine/DrumsCtrl");
  const input = value("/Evil/Engine/AudioCtrl/Input");
  const tuner = value("/Evil/Engine/AudioCtrl/Tuner");
  const fft = value("/Evil/Engine/FFTCtrl");
  const tempo = value("/Evil/Engine/Tempo");
  return {
    rig: String(rig.PresetName ?? "unknown"),
    occupiedSlots: Array.from({ length: 14 }, (_, index) => Number(chain[`ModuleType${index + 1}`] ?? 0)).filter((moduleType) => moduleType > 0).length,
    scene: Number.isFinite(Number(footswitch.LastScene)) ? Number(footswitch.LastScene) + 1 : null,
    tuner: { open: bool(input.TunerOn), muted: bool(tuner.TunerMuting), note: String(fft.TunerString ?? ""), referenceHz: Number(fft.TunerRef ?? 440) },
    drums: { playing: bool(drums.isPlaying), muted: bool(drums.isMuted), kit: String(drums.Kit ?? ""), part: String(drums.PartInfo ?? ""), bar: Number(drums.currentBar ?? 0) + 1, beat: Number(drums.currentBeat ?? 0) + 1 },
    tempoBpm: Math.round((Object.prototype.hasOwnProperty.call(tempo, "Tempo") ? displayNumber(entry("/Evil/Engine/Tempo"), "Tempo") : displayNumber(entry("/Evil/Engine/Patch/Rig"), "Tempo")) * 100) / 100,
  };
}

export function createStageHandDeviceClient({ baseUrl, host, timeout = 20_000, fetchImpl = fetch }) {
  const headers = host ? { Host: host } : {};
  const request = async (method, route, body) => {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const responseText = await response.text();
    let payload = null;
    if (responseText) {
      try { payload = JSON.parse(responseText); } catch { payload = responseText; }
    }
    if (!response.ok) throw new Error(`${method} ${route} returned HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 180)}` : ""}`);
    return payload;
  };
  const suffix = (path) => path.replace(/^\//, "");
  return {
    getSubtree: (path = "") => request("GET", `/api/v1/subtree${path ? `/${suffix(path)}` : ""}`),
    getProperties: (path) => request("GET", `/api/v1/object-properties/${suffix(path)}`),
    setProperties: (path, properties) => request("PUT", `/api/v1/object-properties/${suffix(path)}`, properties),
    callMethod: (path, method, argumentsList = []) => request("POST", `/api/v1/object-method/${suffix(path)}/${method}`, { arguments: argumentsList }),
  };
}

async function eventually(read, predicate, timeout = 2_500) {
  const started = Date.now();
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await wait(80);
  } while (Date.now() - started < timeout);
  const snapshot = JSON.stringify(value);
  throw new Error(`readback did not reach the expected state; last value was ${snapshot.length > 280 ? `${snapshot.slice(0, 277)}...` : snapshot}`);
}

/**
 * Exercises controls with reflected state. Every changed property is restored in
 * a finally block. Drummer checks are opt-in because they can be audible.
 */
export async function verifyStageHandLive(client, { performance = false, settleMs = 350 } = {}) {
  const results = [];
  const footswitchPath = "/Evil/Engine/FootSwitch";
  const inputPath = "/Evil/Engine/AudioCtrl/Input";
  const tunerPath = "/Evil/Engine/AudioCtrl/Tuner";
  const original = {
    footswitch: await client.getProperties(footswitchPath),
    input: await client.getProperties(inputPath),
    tuner: await client.getProperties(tunerPath),
    drums: performance ? await client.getProperties("/Evil/Engine/DrumsCtrl") : null,
  };
  const originalScene = Math.min(5, Math.max(0, Number(original.footswitch?.LastScene ?? 0)));

  const check = async (capability, exercise) => {
    try {
      const detail = await exercise();
      results.push({ ok: true, capability, detail: detail || "write acknowledged and read back" });
    } catch (error) {
      results.push({ ok: false, capability, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  try {
    for (let index = 0; index < 6; index += 1) {
      await check(`Scene ${"ABCDEF"[index]} activation`, async () => {
        await client.setProperties(footswitchPath, { [`SceneActive${index + 1}`]: true });
        const state = await eventually(() => client.getProperties(footswitchPath), (value) => Number(value?.LastScene) === index && bool(value?.[`SceneActive${index + 1}`]));
        if (settleMs > 0) await wait(settleMs);
        return `LastScene=${Number(state.LastScene) + 1}`;
      });
    }

    await check("Device tuner open/close", async () => {
      const target = !bool(original.input?.TunerOn);
      await client.setProperties(inputPath, { TunerOn: target });
      await eventually(() => client.getProperties(inputPath), (value) => bool(value?.TunerOn) === target);
      return `TunerOn changed to ${target}`;
    });

    await check("Device tuner mute/unmute", async () => {
      const target = !bool(original.tuner?.TunerMuting);
      await client.setProperties(tunerPath, { TunerMuting: target });
      await eventually(() => client.getProperties(tunerPath), (value) => bool(value?.TunerMuting) === target);
      return `TunerMuting changed to ${target}`;
    });

    if (performance) {
      const drumsPath = "/Evil/Engine/DrumsCtrl";
      await check("Drummer play/stop", async () => {
        const before = bool(original.drums?.isPlaying);
        await client.callMethod(drumsPath, "togglePlay");
        await eventually(() => client.getProperties(drumsPath), (value) => bool(value?.isPlaying) !== before);
        return `isPlaying changed from ${before} to ${!before}`;
      });
      await check("Drummer mute/unmute", async () => {
        const current = await client.getProperties(drumsPath);
        const before = bool(current?.isMuted);
        await client.callMethod(drumsPath, "toggleMute");
        await eventually(() => client.getProperties(drumsPath), (value) => bool(value?.isMuted) !== before);
        return `isMuted changed from ${before} to ${!before}`;
      });
    }
  } finally {
    const restorationErrors = [];
    const restore = async (capability, operation) => {
      try { await operation(); } catch (error) { restorationErrors.push(`${capability}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    await restore("scene", async () => {
      await client.setProperties(footswitchPath, { [`SceneActive${originalScene + 1}`]: true });
      await eventually(() => client.getProperties(footswitchPath), (value) => Number(value?.LastScene) === originalScene);
    });
    await restore("tuner visibility", async () => {
      const expected = bool(original.input?.TunerOn);
      await client.setProperties(inputPath, { TunerOn: expected });
      await eventually(() => client.getProperties(inputPath), (value) => bool(value?.TunerOn) === expected);
    });
    await restore("tuner mute", async () => {
      const expected = bool(original.tuner?.TunerMuting);
      await client.setProperties(tunerPath, { TunerMuting: expected });
      await eventually(() => client.getProperties(tunerPath), (value) => bool(value?.TunerMuting) === expected);
    });
    if (performance && original.drums) {
      await restore("drummer play state", async () => {
        const state = await client.getProperties("/Evil/Engine/DrumsCtrl");
        const expected = bool(original.drums?.isPlaying);
        if (bool(state?.isPlaying) !== expected) await client.callMethod("/Evil/Engine/DrumsCtrl", "togglePlay");
        await eventually(() => client.getProperties("/Evil/Engine/DrumsCtrl"), (value) => bool(value?.isPlaying) === expected);
      });
      await restore("drummer mute state", async () => {
        const state = await client.getProperties("/Evil/Engine/DrumsCtrl");
        const expected = bool(original.drums?.isMuted);
        if (bool(state?.isMuted) !== expected) await client.callMethod("/Evil/Engine/DrumsCtrl", "toggleMute");
        await eventually(() => client.getProperties("/Evil/Engine/DrumsCtrl"), (value) => bool(value?.isMuted) === expected);
      });
    }
    results.push({ ok: restorationErrors.length === 0, capability: "Original device state restored", detail: restorationErrors.length ? restorationErrors.join("; ") : "scene, tuner and requested performance state restored" });
  }
  return results;
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const next = argv[index + 1];
    values.set(argument.slice(2), !next || next.startsWith("--") ? "true" : next);
    if (next && !next.startsWith("--")) index += 1;
  }
  return values;
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const address = argumentsMap.get("address") || process.env.RUSHLINK_DEVICE_ADDRESS || "headrushflexprime.local";
  const host = argumentsMap.get("host") || process.env.RUSHLINK_DEVICE_HOST || (address.includes(".") && /^\d/.test(address) ? "headrushflexprime.local" : "");
  const timeout = Math.max(1_000, Number(argumentsMap.get("timeout") || 20_000));
  const baseUrl = /^https?:\/\//i.test(address) ? address.replace(/\/$/, "") : `http://${address}`;
  const live = argumentsMap.get("live") === "true" || argumentsMap.get("performance") === "true";
  const performance = argumentsMap.get("performance") === "true";
  const client = createStageHandDeviceClient({ baseUrl, host, timeout });
  const tree = await client.getSubtree();
  const checks = validateStageHandContract(tree);
  if (live) checks.push(...await verifyStageHandLive(client, { performance }));
  const failures = checks.filter((check) => !check.ok);
  console.log(`StageHand device verification - ${baseUrl}`);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.capability} - ${check.detail}`);
  console.log(`STATE ${JSON.stringify(stageHandStateSummary(await client.getSubtree()))}`);
  console.log(`CHECKS=${checks.length} FAILURES=${failures.length} MODE=${performance ? "LIVE_PERFORMANCE" : live ? "LIVE_SAFE" : "READ_ONLY"}`);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`StageHand device verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
