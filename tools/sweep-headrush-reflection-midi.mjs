import http from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(workspace, "reference", "headrush", "reflection-midi-cc92-sweep.json");
const address = process.env.HEADRUSH_ADDRESS || "headrushflexprime.local";
const hostHeader = process.env.HEADRUSH_HOST || "headrushflexprime.local";
const port = Number(process.env.HEADRUSH_PORT || 80);
const active = process.argv.includes("--active");
const forceMidiInCtrl = process.argv.includes("--force-midi-inctrl");
const settleMs = Math.max(40, Math.min(1_000, Number(process.env.HEADRUSH_SETTLE_MS || 120)));

const status = 0xb0;
const controller = 92;
const pressed = 127;
const released = 0;

const objectPaths = [...new Set([
  "/Evil/Engine/MIDIInCtrl",
  "/Evil/Engine/MidiInCtrl",
  "/Evil/Engine/MidiInController",
  "/Evil/Engine/MIDIInputCtrl",
  "/Evil/Engine/MidiInputCtrl",
  "/Evil/Engine/MIDIInput",
  "/Evil/Engine/MidiInput",
  "/Evil/Engine/MIDICtrl",
  "/Evil/Engine/MidiCtrl",
  "/Evil/Engine/MIDI",
  "/Evil/Engine/Midi",
  "/Evil/Engine/RemoteMIDI",
  "/Evil/Engine/VirtualMIDI",
  "/Evil/Engine/MIDIReceiver",
  "/Evil/Engine/MidiReceiver",
  "/Evil/Engine/MIDIConsumer",
  "/Evil/Engine/MIDIOutCtrl",
  "/Evil/Engine/FootSwitch",
  "/Evil/Engine/FootSwitchCtrl",
  "/Evil/Engine/Controller",
  "/Evil/Engine/Control",
  "/Evil/Engine/Remote",
  "/Evil/Engine/InputCtrl",
  "/Evil/Engine/AudioCtrl/Input",
  "/Evil/Engine/Settings/Midi",
  "/Evil/API/MIDI",
  "/Evil/API/Midi",
  "/Evil/API/MIDIInput",
  "/Evil/API/MidiInput",
  "/Evil/API/RemoteMIDI",
  "/Evil/API/Remote",
  "/Evil/API/Control",
])];

const methodNames = [...new Set([
  "receive", "receiveMidi", "receiveMIDI", "receiveMidiMessage", "receiveMIDIMessage",
  "input", "midiIn", "MIDIIn", "midiInput", "MIDIInput", "inputMidi", "inputMIDI",
  "inject", "injectMidi", "injectMIDI", "injectMidiMessage", "injectMIDIMessage",
  "message", "midiMessage", "MIDIMessage", "sendMessage", "sendMidiMessage", "sendMIDIMessage",
  "consume", "consumeMidi", "consumeMIDI", "handleMidi", "handleMIDI", "handleMidiMessage",
  "process", "processMidi", "processMIDI", "processMessage", "processMidiMessage",
  "dispatch", "dispatchMidi", "dispatchMIDI", "dispatchMessage", "dispatchMidiMessage",
  "write", "writeMidi", "writeMIDI", "writeMessage", "raw", "command", "event",
  "controlChange", "controlchange", "receiveControlChange", "processControlChange", "handleControlChange",
  "cc", "CC", "midiCC", "MIDICC", "receiveCC", "sendCC",
  "onMidi", "onMIDI", "onMidiMessage", "onMIDIMessage",
])];

// Active dispatch is intentionally narrower than read-only metadata discovery.
// These names cover the conventional reflection spellings without invoking
// unrelated engine objects or methods.
const activeObjectPaths = [
  "/Evil/Engine/MIDIInCtrl",
  "/Evil/Engine/MidiInCtrl",
  "/Evil/Engine/MIDIInputCtrl",
  "/Evil/Engine/MidiInputCtrl",
  "/Evil/Engine/MIDIInput",
  "/Evil/Engine/MidiInput",
  "/Evil/Engine/MIDICtrl",
  "/Evil/Engine/MidiCtrl",
  "/Evil/Engine/MIDI",
  "/Evil/Engine/Midi",
  "/Evil/Engine/MIDIReceiver",
  "/Evil/Engine/MIDIOutCtrl",
];
const activeMethodNames = [
  "receive", "receiveMidi", "receiveMIDI", "receiveMidiMessage", "receiveMIDIMessage",
  "input", "midiIn", "MIDIIn", "message", "midiMessage", "controlChange", "receiveControlChange",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const suffix = (objectPath) => objectPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");

function request(method, route, body, timeoutMs = 4_000) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const startedAt = Date.now();
    const req = http.request({
      hostname: address,
      port,
      family: address.includes(":") ? 6 : undefined,
      method,
      path: route,
      headers: {
        Host: hostHeader,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
        resolve({
          method, route, status: response.statusCode, elapsedMs: Date.now() - startedAt,
          preview: text.replace(/\s+/g, " ").trim().slice(0, 400), json,
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on("error", (error) => resolve({ method, route, error: error.message, elapsedMs: Date.now() - startedAt }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function readTuner() {
  const response = await request("GET", "/api/v1/object-properties/Evil/Engine/AudioCtrl/Input");
  if (response.status !== 200 || typeof response.json?.TunerOn !== "boolean") {
    throw new Error(`Unable to read TunerOn: HTTP ${response.status ?? "network error"} ${response.preview || response.error || ""}`);
  }
  return response.json.TunerOn;
}

async function restoreTuner(state) {
  const response = await request("PUT", "/api/v1/object-properties/Evil/Engine/AudioCtrl/Input", { TunerOn: state });
  if ((response.status ?? 0) < 200 || (response.status ?? 0) >= 300) {
    throw new Error(`Unable to restore TunerOn: HTTP ${response.status ?? "network error"} ${response.preview || response.error || ""}`);
  }
  await sleep(settleMs);
}

function methodRoute(objectPath, methodName) {
  return `/api/v1/object-method/${suffix(objectPath)}/${encodeURIComponent(methodName)}`;
}

function methodBody(shape, value) {
  const bytes = [status, controller, value];
  switch (shape) {
    case "byte-array": return { arguments: [bytes] };
    case "three-bytes": return { arguments: bytes };
    case "channel-cc-value": return { arguments: [0, controller, value] };
    case "cc-value": return { arguments: [controller, value] };
    case "message-object": return { arguments: [{ status, data1: controller, data2: value }] };
    case "cc-object": return { arguments: [{ type: "controlChange", channel: 1, controller, value }] };
    default: throw new Error(`Unknown shape ${shape}`);
  }
}

function propertyBody(shape, value) {
  const bytes = [status, controller, value];
  switch (shape) {
    case "Message": return { Message: bytes };
    case "MIDIMessage": return { MIDIMessage: bytes };
    case "Bytes": return { Bytes: bytes };
    case "Data": return { Data: bytes };
    case "status-data": return { Status: status, Data1: controller, Data2: value };
    case "cc-value": return { CC: controller, Value: value };
    case "controller-value": return { Controller: controller, Value: value };
    default: throw new Error(`Unknown property shape ${shape}`);
  }
}

function recognized(response) {
  if (response.error || response.status === 404 || response.status === undefined) return false;
  return response.status >= 200 && response.status < 500;
}

function midiEvidence(subtree) {
  if (!subtree || typeof subtree !== "object") return [];
  const keyword = /midi|control.?change|message|receive|inject|dispatch|clock/i;
  return Object.entries(subtree).flatMap(([objectPath, entry]) => {
    const methods = Object.keys(entry?.meta?.["x-methods"] || {});
    const properties = Object.keys(entry?.meta?.properties || {});
    const matchedMethods = methods.filter((name) => keyword.test(name));
    const matchedProperties = properties.filter((name) => keyword.test(name));
    if (!keyword.test(objectPath) && matchedMethods.length === 0 && matchedProperties.length === 0) return [];
    return [{ objectPath, methods: matchedMethods, properties: matchedProperties }];
  });
}

async function exercise({ label, press, release }, originalTuner) {
  const before = await readTuner();
  const pressResponse = await press();
  await sleep(settleMs);
  const afterPress = await readTuner();
  const releaseResponse = await release();
  await sleep(settleMs);
  const afterRelease = await readTuner();
  const changed = afterPress !== before || afterRelease !== afterPress;
  if (afterRelease !== originalTuner) await restoreTuner(originalTuner);
  const restored = await readTuner();
  return { label, before, afterPress, afterRelease, changed, restored, pressResponse, releaseResponse };
}

async function main() {
  if (!active) {
    throw new Error("This active, reversible sweep requires --active.");
  }
  const originalTuner = await readTuner();
  const metadata = [];
  const reflectedObjects = [];
  const phaseOne = [];
  const detailed = [];
  const propertyChecks = [];
  let trial = 0;
  const subtreeResponse = await request("GET", "/api/v1/subtree");
  const liveSubtree = subtreeResponse.status === 200 ? subtreeResponse.json : undefined;

  try {
    for (const objectPath of objectPaths) {
      const response = await request("GET", `/api/v1/object-meta/${suffix(objectPath)}`);
      metadata.push({ objectPath, response });
      if (response.status === 200) reflectedObjects.push(objectPath);
    }

    const total = activeObjectPaths.length * activeMethodNames.length;
    for (const objectPath of activeObjectPaths) {
      for (const methodName of activeMethodNames) {
        trial += 1;
        if (trial === 1 || trial % 24 === 0) console.log(`CC92 release discovery ${trial}/${total}`);
        const route = methodRoute(objectPath, methodName);
        const response = await request("POST", route, methodBody("byte-array", released));
        phaseOne.push({ objectPath, methodName, label: `${objectPath}.${methodName}(release discovery)`, response });
      }
    }

    const forcedMethods = forceMidiInCtrl
      ? phaseOne.filter((entry) => entry.objectPath === "/Evil/Engine/MIDIInCtrl" && ["receive", "receiveMidi", "controlChange"].includes(entry.methodName))
      : [];
    const recognizedMethods = [...new Map([
      ...phaseOne.filter((entry) => recognized(entry.response)),
      ...forcedMethods,
    ].map((entry) => [`${entry.objectPath}.${entry.methodName}`, entry])).values()];
    const extraShapes = ["byte-array", "three-bytes", "channel-cc-value", "cc-value", "message-object", "cc-object"];
    for (const candidate of recognizedMethods) {
      for (const shape of extraShapes) {
        const route = methodRoute(candidate.objectPath, candidate.methodName);
        const result = await exercise({
          label: `${candidate.objectPath}.${candidate.methodName}(${shape})`,
          press: () => request("POST", route, methodBody(shape, pressed)),
          release: () => request("POST", route, methodBody(shape, released)),
        }, originalTuner);
        detailed.push({ objectPath: candidate.objectPath, methodName: candidate.methodName, shape, ...result });
        if (result.changed) console.log(`DEVICE CHANGE: ${result.label}`);
      }
    }

  } finally {
    if (await readTuner() !== originalTuner) await restoreTuner(originalTuner);
  }

  const allTrials = [...phaseOne, ...detailed, ...propertyChecks];
  const report = {
    capturedAt: new Date().toISOString(), address, port, hostHeader,
    active: true, forceMidiInCtrl, midi: { status, controller, pressed, released }, settleMs,
    safety: "Discovery sent only CC 92 release (value 0). A press/release pair would be sent only to a recognized candidate, with TunerOn read back and restored after each pair.",
    originalTuner, finalTuner: await readTuner(),
    candidates: {
      metadataObjects: objectPaths.length,
      allGuessedMethodNames: methodNames.length,
      activeObjects: activeObjectPaths.length,
      activeMethodNames: activeMethodNames.length,
      releaseDiscoveryTrials: phaseOne.length,
      visiblePressTrials: detailed.length,
      propertyTrials: propertyChecks.length,
    },
    liveObjectCount: liveSubtree ? Object.keys(liveSubtree).length : 0,
    liveMidiEvidence: midiEvidence(liveSubtree),
    reflectedObjects,
    metadata,
    deviceChanges: allTrials.filter((entry) => entry.changed),
    recognizedMethodCandidates: phaseOne.filter((entry) => recognized(entry.response)),
    recognizedPropertyCandidates: [],
    phaseOne,
    detailed,
    propertyChecks,
  };
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outputFile, originalTuner: report.originalTuner, finalTuner: report.finalTuner,
    reflectedObjects: reflectedObjects.length, trials: allTrials.length,
    recognizedMethods: report.recognizedMethodCandidates.length,
    recognizedProperties: report.recognizedPropertyCandidates.length,
    deviceChanges: report.deviceChanges.map((entry) => entry.label),
  }, null, 2));
}

await main();
