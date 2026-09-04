import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(workspace, "reference", "headrush", "midi-input-discovery.json");
const baseUrl = (process.env.HEADRUSH_BASE_URL || "http://headrushflexprime.local").replace(/\/$/, "");
const hostHeader = process.env.HEADRUSH_HOST || "headrushflexprime.local";
const active = process.argv.includes("--active");

const explicitDirectRoutes = [
  "/midi", "/midi/in", "/midi/input", "/midi/message", "/midi/receive", "/midi/inject",
  "/api/midi", "/api/midi/in", "/api/midi/input", "/api/midi/message", "/api/midi/receive", "/api/midi/inject",
  "/api/v1/midi", "/api/v1/midi/in", "/api/v1/midi/input", "/api/v1/midi/message",
  "/api/v1/midi/receive", "/api/v1/midi/inject", "/api/v1/midi/send",
];

const routePrefixes = ["", "/api", "/api/v1", "/api/v2", "/remote", "/api/remote", "/api/v1/remote"];
const midiResources = [
  "midi", "MIDI", "midi-in", "midiin", "midi_input", "midi-input", "midiInput",
  "MIDIIn", "MIDIInput", "virtual-midi", "remote-midi", "midi-control",
];
const routeActions = ["in", "input", "receive", "inject", "message", "event", "dispatch", "raw"];
const directRoutes = [...new Set([
  ...explicitDirectRoutes,
  ...routePrefixes.flatMap((prefix) => midiResources.map((resource) => `${prefix}/${resource}`)),
  ...routeActions.flatMap((action) => [
    `/api/v1/midi/${action}`, `/api/v1/${action}/midi`, `/api/v1/remote/midi/${action}`,
  ]),
  "/rpc", "/jsonrpc", "/api/rpc", "/api/jsonrpc", "/api/v1/rpc", "/api/v1/jsonrpc",
  "/api/v1/control", "/api/v1/command", "/api/v1/events/midi", "/api/v1/commands/midi",
])];

const objectNamespaces = ["/Evil/Engine", "/Evil/API", "/Evil/Engine/Settings", "/Evil/Engine/Control"];
const objectNames = [
  "MIDIInCtrl", "MidiInCtrl", "MIDIInputCtrl", "MIDIInput", "MidiInput", "MIDICtrl",
  "MidiCtrl", "MIDI", "Midi", "RemoteMIDI", "VirtualMIDI", "MIDIReceiver", "MIDIConsumer",
];
const objectPaths = [...new Set([
  ...objectNamespaces.flatMap((namespace) => objectNames.map((name) => `${namespace}/${name}`)),
  "/Evil/Engine/Settings/Midi", "/Evil/Engine/MIDIOutCtrl",
  "/Evil/Engine/FootSwitch", "/Evil/Engine/Remote", "/Evil/API/Remote",
])];

const guessedMethods = [
  "receive", "receiveMidi", "receiveMIDI", "input", "midiIn", "MIDIIn",
  "inject", "injectMidi", "injectMIDI", "message", "sendMessage", "sendMidiMessage",
  "consume", "consumeMidi", "handleMidi", "handleMIDI", "handleMessage", "processMessage",
  "dispatch", "dispatchMidi", "write", "writeMidi", "raw", "command",
  "controlChange", "programChange", "noteOn", "noteOff",
];

const headers = { Host: hostHeader, Accept: "application/json" };

async function request(method, route, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      method, route, status: response.status,
      contentType: response.headers.get("content-type"),
      preview: text.replace(/\s+/g, " ").trim().slice(0, 280),
    };
  } catch (error) {
    return { method, route, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimited(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function suffix(objectPath) {
  return objectPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function isInteresting(result) {
  if (result.error) return false;
  if (result.status !== 404) return true;
  return !/not found|cannot (get|post|options)/i.test(result.preview || "");
}

async function main() {
  const [subtreeText, bundle] = await Promise.all([
    readFile(path.join(workspace, "reference", "headrush", "live", "latest-subtree.json"), "utf8"),
    readFile(path.join(workspace, "reference", "headrush", "raw", "main.4a9a9934.js"), "utf8"),
  ]);
  const subtree = JSON.parse(subtreeText);
  const reflectedMidiEvidence = Object.entries(subtree).flatMap(([objectPath, entry]) => {
    const metadata = entry?.meta || {};
    const methods = Object.keys(metadata["x-methods"] || {});
    const properties = Object.keys(metadata.properties || {});
    if (!/midi|message|receive|inject|dispatch/i.test([objectPath, ...methods, ...properties].join(" "))) return [];
    return [{ objectPath, methods, properties: properties.filter((name) => /midi|message|receive|inject|dispatch|channel|clock/i.test(name)) }];
  });
  const bundleTokenCounts = [
    "MIDIIn", "MidiIn", "midiIn", "MIDIInput", "receiveMidi", "injectMidi", "sendMidi", "MIDIOutCtrl",
  ].map((token) => ({ token, count: bundle.split(token).length - 1 }));

  const reachability = await request("GET", "/api/v1/object-meta/Evil/Engine/Settings/Midi");
  const reachable = !reachability.error;
  const metadata = reachable ? await mapLimited(objectPaths, 4, (objectPath) =>
    request("GET", `/api/v1/object-meta/${suffix(objectPath)}`)) : [];
  const subtreeChecks = reachable ? await mapLimited(objectPaths, 4, (objectPath) =>
    request("GET", `/api/v1/subtree/${suffix(objectPath)}`)) : [];
  const routeChecks = reachable ? await mapLimited(directRoutes.flatMap((route) => [
    { method: "OPTIONS", route }, { method: "GET", route },
  ]), 4, ({ method, route }) => request(method, route)) : [];

  const activeChecks = [];
  if (active && reachable) {
    // 0x80 0x00 0x00 is Note-Off for note zero. It exercises a MIDI parser
    // without changing rigs, toggling effects, starting transport or sounding a note.
    const noteOff = [0x80, 0x00, 0x00];
    const availableObjects = objectPaths.filter((_, index) => metadata[index]?.status === 200);
    const methodCandidates = availableObjects.flatMap((objectPath) =>
      guessedMethods.flatMap((method) => [
        { route: `/api/v1/object-method/${suffix(objectPath)}/${method}`, body: { arguments: [noteOff] } },
        { route: `/api/v1/object-method/${suffix(objectPath)}/${method}`, body: { arguments: noteOff } },
      ]));
    activeChecks.push(...await mapLimited(methodCandidates, 4, ({ route, body }) => request("POST", route, body)));

    // OPTIONS is often answered globally by CORS middleware, so only a
    // non-404 GET promotes a direct route to the active Note-Off phase.
    const recognizedDirectRoutes = directRoutes.filter((route) => routeChecks.some((result) =>
      result.route === route && result.method === "GET" && result.status !== 404));
    const directCandidates = recognizedDirectRoutes.flatMap((route) => {
      const payloads = [
        { bytes: noteOff }, { data: noteOff }, { midi: noteOff }, { message: noteOff },
        { status: 0x80, data1: 0, data2: 0 },
        { type: "noteOff", channel: 1, note: 0, velocity: 0 },
      ];
      if (/rpc/i.test(route)) payloads.push(
        { jsonrpc: "2.0", id: 1, method: "midi.receive", params: { bytes: noteOff } },
        { jsonrpc: "2.0", id: 2, method: "midi.inject", params: { bytes: noteOff } },
      );
      return payloads.map((body) => ({ route, body }));
    });
    activeChecks.push(...await mapLimited(directCandidates, 4, ({ route, body }) => request("POST", route, body)));
  }

  const all = [reachability, ...metadata, ...subtreeChecks, ...routeChecks, ...activeChecks];
  const activePerformed = active && reachable;
  const report = {
    capturedAt: new Date().toISOString(), baseUrl, hostHeader, activeRequested: active, activePerformed,
    reachable,
    safety: activePerformed
      ? "Active probes used only MIDI Note-Off 0x80 0x00 0x00."
      : reachable ? "Read-only metadata, OPTIONS and GET probes only." : "No route probes were sent because the device was unreachable.",
    candidates: { directRoutes: directRoutes.length, objectPaths: objectPaths.length, guessedMethods: guessedMethods.length },
    staticEvidence: { reflectedMidiEvidence, bundleTokenCounts },
    interesting: all.filter(isInteresting),
    results: all,
  };
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outputFile, reachable: report.reachable, activeRequested: active, activePerformed,
    interesting: report.interesting,
    errors: all.filter((result) => result.error).length,
  }, null, 2));
}

await main();
