import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(workspace, "reference", "headrush", "websocket-discovery.json");
const host = process.env.HEADRUSH_HOST || "headrushflexprime.local";
const address = process.env.HEADRUSH_ADDRESS || "192.168.1.129";
const port = Number(process.env.HEADRUSH_PORT || 80);
const active = process.argv.includes("--active");
const waitArgument = process.argv.find((argument) => argument.startsWith("--wait="));
const waitSeconds = Math.max(0, Math.min(55, Number(waitArgument?.split("=")[1] || 0)));

const paths = ["/", "/ws", "/websocket", "/socket", "/events", "/notifications", "/api/ws", "/api/websocket", "/api/v1/ws", "/api/v1/events", "/midi", "/api/v1/midi"];
const protocols = [[], ["json"], ["jsonrpc"], ["midi"], ["binary"], ["graphql-transport-ws"]];
const noteOff = [0x80, 0x00, 0x00];
const payloads = [
  { name: "empty object", data: {} },
  { name: "read subtree action", data: { action: "getSubTree", path: "" } },
  { name: "read subtree request", data: { method: "GET", path: "/api/v1/subtree" } },
  { name: "read subtree JSON-RPC", data: { jsonrpc: "2.0", id: 1, method: "subtree", params: [] } },
  { name: "MIDI bytes", data: { bytes: noteOff } },
  { name: "MIDI data", data: { midi: noteOff } },
  { name: "MIDI message", data: { message: noteOff } },
  { name: "typed MIDI", data: { type: "midi", data: noteOff } },
  { name: "MIDI event", data: { event: "midi", data: noteOff } },
  { name: "MIDI action", data: { action: "midi", message: noteOff } },
  { name: "MIDI receive JSON-RPC", data: { jsonrpc: "2.0", id: 2, method: "midi.receive", params: { bytes: noteOff } } },
  { name: "MIDI inject JSON-RPC", data: { jsonrpc: "2.0", id: 3, method: "midi.inject", params: { bytes: noteOff } } },
  { name: "reflected MIDI input", data: { objectPath: "/Evil/Engine/MIDIInCtrl", method: "receive", arguments: [noteOff] } },
  { name: "binary MIDI Note-Off", binary: true, data: new Uint8Array(noteOff) },
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function tcpOpen(timeout = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForServer() {
  const deadline = Date.now() + waitSeconds * 1_000;
  do {
    if (await tcpOpen()) return true;
    if (Date.now() >= deadline) return false;
    await delay(1_000);
  } while (true);
}

function previewMessage(data) {
  if (typeof data === "string") return data.replace(/\s+/g, " ").slice(0, 500);
  if (data instanceof ArrayBuffer) return `binary:${Buffer.from(data).subarray(0, 64).toString("hex")}`;
  if (ArrayBuffer.isView(data)) return `binary:${Buffer.from(data.buffer, data.byteOffset, data.byteLength).subarray(0, 64).toString("hex")}`;
  return String(data).slice(0, 500);
}

function encodeClientFrame(data) {
  const binary = typeof data !== "string";
  const payload = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(String(data));
  const mask = randomBytes(4);
  const extended = payload.length >= 126;
  const header = Buffer.alloc(extended ? 8 : 6);
  header[0] = binary ? 0x82 : 0x81;
  if (extended) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    mask.copy(header, 4);
  } else {
    header[1] = 0x80 | payload.length;
    mask.copy(header, 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

function decodeServerFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2); headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const large = buffer.readBigUInt64BE(offset + 2);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      length = Number(large); headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (offset + headerLength + maskLength + length > buffer.length) break;
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, offset + headerLength + maskLength + length));
    if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    frames.push({ opcode: first & 0x0f, payload });
    offset += headerLength + maskLength + length;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function connectWebSocket(pathname, requestedProtocols = [], sendPayload, listenMilliseconds = 700, origin = `http://${host}`) {
  return new Promise((resolve) => {
    const url = `ws://${address.includes(":") ? `[${address}]` : address}:${port}${pathname}`;
    const started = Date.now();
    const messages = [];
    let settled = false;
    let opened = false;
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let selectedProtocol = "";
    const socket = net.createConnection({ host: address, port });
    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve({ url, requestedProtocols, opened, messages, elapsedMs: Date.now() - started, ...extra });
    };
    const timeout = setTimeout(() => finish({ outcome: opened ? "listened" : "timeout" }), 3_500);
    socket.setTimeout(3_500, () => finish({ outcome: opened ? "listened" : "timeout" }));
    socket.once("connect", () => {
      const lines = [
        `GET ${pathname} HTTP/1.1`, `Host: ${host}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`, "Sec-WebSocket-Version: 13",
      ];
      if (origin !== undefined) lines.push(`Origin: ${origin}`);
      if (requestedProtocols.length) lines.push(`Sec-WebSocket-Protocol: ${requestedProtocols.join(", ")}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      if (!opened) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const boundary = handshakeBuffer.indexOf("\r\n\r\n");
        if (boundary < 0) return;
        const header = handshakeBuffer.subarray(0, boundary).toString("utf8");
        if (!/^HTTP\/1\.1 101\b/.test(header)) return finish({ outcome: "rejected", handshake: header.slice(0, 1_200) });
        opened = true;
        selectedProtocol = header.match(/^Sec-WebSocket-Protocol:\s*(.+)$/im)?.[1]?.trim() || "";
        frameBuffer = handshakeBuffer.subarray(boundary + 4);
        handshakeBuffer = Buffer.alloc(0);
        if (sendPayload !== undefined) socket.write(encodeClientFrame(sendPayload));
        setTimeout(() => finish({ outcome: "listened", selectedProtocol }), listenMilliseconds);
      } else frameBuffer = Buffer.concat([frameBuffer, chunk]);
      const decoded = decodeServerFrames(frameBuffer);
      frameBuffer = decoded.remaining;
      for (const frame of decoded.frames) {
        if (frame.opcode === 1) messages.push(previewMessage(frame.payload.toString("utf8")));
        else if (frame.opcode === 2) messages.push(previewMessage(frame.payload));
        else if (frame.opcode === 8) {
          const closeCode = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005;
          return finish({ outcome: "closed", closeCode, closeReason: frame.payload.subarray(2).toString("utf8") });
        }
      }
    });
    socket.once("end", () => finish({ outcome: opened ? "closed" : "ended" }));
    socket.once("error", (error) => finish({ outcome: "error", error: `${error.code || error.name}: ${error.message}` }));
  });
}

function rawOriginHandshake(origin) {
  return new Promise((resolve) => {
    const key = randomBytes(16).toString("base64");
    const socket = net.createConnection({ host: address, port });
    let response = "";
    const finish = (outcome) => { socket.destroy(); resolve({ origin: origin ?? "(omitted)", outcome, response: response.split("\r\n\r\n")[0].slice(0, 1_200) }); };
    socket.setTimeout(2_000, () => finish("timeout"));
    socket.once("error", (error) => finish(`error:${error.code || error.message}`));
    socket.once("connect", () => {
      const lines = [
        "GET / HTTP/1.1", `Host: ${host}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13",
      ];
      if (origin !== undefined) lines.push(`Origin: ${origin}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n\r\n")) finish(/^HTTP\/1\.1 101\b/.test(response) ? "accepted" : "rejected");
    });
  });
}

function httpJson(method, route, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request({
      hostname: address, port, method, path: route,
      headers: {
        Host: host, Accept: "application/json", Connection: "close",
        ...(encoded ? { "Content-Type": "application/json", "Content-Length": encoded.length } : {}),
      },
      timeout: 4_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: response.statusCode || 0, text, json });
      });
    });
    request.once("timeout", () => request.destroy(new Error("HTTP timeout")));
    request.once("error", reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

async function tunerState() {
  const response = await httpJson("GET", "/api/v1/object-properties/Evil/Engine/AudioCtrl/Input");
  if (response.status !== 200 || typeof response.json?.TunerOn !== "boolean") throw new Error(`Could not read TunerOn (HTTP ${response.status})`);
  return response.json.TunerOn;
}

async function restoreTuner(state) {
  const response = await httpJson("PUT", "/api/v1/object-properties/Evil/Engine/AudioCtrl/Input", { TunerOn: state });
  if (response.status < 200 || response.status >= 300) throw new Error(`Could not restore TunerOn (HTTP ${response.status})`);
}

function midiPayloadVariants(bytes) {
  return [
    { name: "bytes", value: JSON.stringify({ bytes }) },
    { name: "midi", value: JSON.stringify({ midi: bytes }) },
    { name: "message", value: JSON.stringify({ message: bytes }) },
    { name: "typed-midi", value: JSON.stringify({ type: "midi", data: bytes }) },
    { name: "midi-event", value: JSON.stringify({ event: "midi", data: bytes }) },
    { name: "midi-action", value: JSON.stringify({ action: "midi", message: bytes }) },
    { name: "json-rpc-receive", value: JSON.stringify({ jsonrpc: "2.0", id: 20, method: "midi.receive", params: { bytes } }) },
    { name: "json-rpc-inject", value: JSON.stringify({ jsonrpc: "2.0", id: 21, method: "midi.inject", params: { bytes } }) },
    { name: "binary", value: new Uint8Array(bytes) },
  ];
}

async function main() {
  const bundle = await readFile(path.join(workspace, "reference", "headrush", "raw", "main.4a9a9934.js"), "utf8");
  const staticEvidence = {
    websocketConstructorCount: (bundle.match(/new WebSocket\(/g) || []).length,
    websocketSendCount: (bundle.match(/webSocket\.send\(/g) || []).length,
    knownNotifications: ["objectAdded", "objectRemoved", "objectPropertyAdded", "objectPropertyRemoved", "propertyValueChanged", "webAccessChanged"]
      .filter((notification) => bundle.includes(notification)),
  };
  const reachable = await waitForServer();
  const report = {
    capturedAt: new Date().toISOString(), address, port, host, activeRequested: active, reachable,
    safety: active
      ? "Sent read requests, MIDI Note-Off, and reversible tuner CC 92 checks; the original tuner state was restored."
      : "Handshake and passive-listen probes only.",
    staticEvidence, pathChecks: [], protocolChecks: [], originChecks: [], attackerOriginMessages: [], passiveMessages: [], payloadChecks: [],
    broadcastCheck: null, midiConsumptionChecks: [], deviceStateRestored: null,
  };
  if (reachable) {
    report.pathChecks = await Promise.all(paths.map((pathname) => connectWebSocket(pathname, [], undefined, 250)));
    report.protocolChecks = await Promise.all(protocols.map((items) => connectWebSocket("/", items, undefined, 250)));
    report.originChecks = await Promise.all([undefined, `http://${host}`, "https://attacker.invalid", "null"].map(rawOriginHandshake));
    const attackerOrigin = await connectWebSocket("/", [], undefined, 1_800, "https://attacker.invalid");
    report.attackerOriginMessages = attackerOrigin.messages;
    const passive = await connectWebSocket("/", [], undefined, 3_000);
    report.passiveMessages = passive.messages;
    if (active) {
      for (const payload of payloads) {
        const encoded = payload.binary ? payload.data : JSON.stringify(payload.data);
        report.payloadChecks.push({ name: payload.name, ...await connectWebSocket("/", [], encoded, 900) });
      }

      const marker = JSON.stringify({ rushlinkSecurityProbe: randomBytes(8).toString("hex") });
      const observerPromise = connectWebSocket("/", [], undefined, 2_200);
      await delay(250);
      const sender = await connectWebSocket("/", [], marker, 500);
      const observer = await observerPromise;
      report.broadcastCheck = {
        marker, observerSawMarker: observer.messages.includes(marker), senderSawMarker: sender.messages.includes(marker),
        observerMessages: observer.messages,
      };

      const originalTuner = await tunerState();
      try {
        const pressVariants = midiPayloadVariants([0xb0, 92, 127]);
        const releaseVariants = midiPayloadVariants([0xb0, 92, 0]);
        for (let index = 0; index < pressVariants.length; index += 1) {
          await restoreTuner(originalTuner);
          await delay(120);
          const before = await tunerState();
          const press = await connectWebSocket("/", [], pressVariants[index].value, 350);
          await delay(180);
          const afterPress = await tunerState();
          const release = await connectWebSocket("/", [], releaseVariants[index].value, 250);
          report.midiConsumptionChecks.push({
            encoding: pressVariants[index].name, before, afterPress,
            consumed: afterPress !== before,
            pressEchoed: press.messages.includes(typeof pressVariants[index].value === "string" ? pressVariants[index].value : "binary:b05c7f"),
            releaseOutcome: release.outcome,
          });
        }
      } finally {
        await restoreTuner(originalTuner);
        await delay(150);
        report.deviceStateRestored = await tunerState() === originalTuner;
      }
    }
  }
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outputFile, reachable, staticEvidence,
    openPaths: report.pathChecks.filter((result) => result.opened).map((result) => result.url),
    acceptedOrigins: report.originChecks.filter((result) => result.outcome === "accepted").map((result) => result.origin),
    attackerOriginMessageCount: report.attackerOriginMessages.length,
    passiveMessageCount: report.passiveMessages.length,
    broadcastCheck: report.broadcastCheck,
    midiConsumptionChecks: report.midiConsumptionChecks,
    deviceStateRestored: report.deviceStateRestored,
    payloadResponses: report.payloadChecks.filter((result) => result.messages.length || result.outcome === "closed"),
  }, null, 2));
}

await main();
