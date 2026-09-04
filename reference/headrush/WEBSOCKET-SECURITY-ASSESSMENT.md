# HeadRush Flex Prime WebSocket and MIDI-input assessment

Assessment date: 2026-08-31  
Tested firmware: 5.1.0.2a63755  
Target: user-owned HeadRush Flex Prime, local network only

## Scope and safety

The assessment covered WebSocket path discovery, subprotocol negotiation, Origin
validation, passive device notifications, cross-client isolation, and possible
MIDI-input message formats. Tests did not attempt persistence, credential access,
firmware modification, destructive writes, denial of service, or saved-rig changes.

MIDI consumption was tested with documented tuner CC 92 because its result is
directly observable through the reflected `TunerOn` property and safely reversible.
The original tuner state was restored and verified after every encoding.

Raw evidence is stored in `websocket-discovery.json`. The repeatable scanner is
`tools/discover-headrush-websocket.mjs`.

## Confirmed protocol behaviour

- The only WebSocket upgrade path is `/` on the Remote HTTP listener.
- `/ws`, `/websocket`, `/socket`, `/events`, `/notifications`, `/api/ws`,
  `/api/websocket`, `/api/v1/ws`, `/api/v1/events`, `/midi`, and
  `/api/v1/midi` reject the upgrade.
- The server emits JSON device notifications such as `propertyValueChanged`.
- The official web bundle constructs one WebSocket and contains no
  `webSocket.send(...)` call.
- Arbitrary client text and binary frames are echoed to their sender.
- A controlled second client did not receive the first client's marker. Client
  input therefore was not broadcast during this test.

## MIDI-input conclusion

No tested WebSocket message was consumed as MIDI.

The following encodings were tested with MIDI CC 92 value 127, followed by value
0 and an HTTP read of the actual `TunerOn` engine property:

- `{ "bytes": [176, 92, 127] }`
- `{ "midi": [176, 92, 127] }`
- `{ "message": [176, 92, 127] }`
- typed MIDI object
- MIDI event object
- MIDI action object
- `midi.receive` JSON-RPC
- `midi.inject` JSON-RPC
- raw binary `B0 5C 7F`

All nine encodings were echoed, but `TunerOn` remained unchanged. The socket is
an event/echo transport and not a network MIDI-input endpoint on this firmware.

## Finding WS-01: arbitrary WebSocket Origins accepted

Suggested severity: Medium, dependent on browser private-network and mixed-content
controls.

The server returned `101 Switching Protocols` for all tested Origin conditions:

- Origin omitted
- `Origin: http://headrushflexprime.local`
- `Origin: https://attacker.invalid`
- `Origin: null`

The connection using `Origin: https://attacker.invalid` subsequently received
normal device property-change notifications, confirming that the missing check is
not limited to the handshake response.

WebSockets are not protected by normal CORS response rules. A hostile web origin
that can reach the local device may therefore establish a connection and observe
device property-change notifications. The practical browser impact depends on
Private Network Access and mixed-content enforcement, but non-browser clients are
not restricted by those controls.

No cross-client message injection or engine mutation was demonstrated. Arbitrary
frames were echoed only to their sender. This limits the confirmed impact to
unauthorised connection and device-event observation rather than device control.

### Recommended remediation

1. Validate the `Origin` header during the WebSocket upgrade and allow only the
   device editor's intended origins.
2. Bind WebSocket access to the approved Remote pairing session using an
   unpredictable, short-lived credential rather than network address alone.
3. Reject client data frames if the protocol is intended to be server-to-client
   only; do not echo arbitrary frames.
4. Apply conservative frame-size, message-rate, connection-count, and idle limits.
5. Close unsupported subprotocol requests instead of upgrading while leaving
   `Sec-WebSocket-Protocol` unselected.

## Positive controls observed

- Alternate MIDI-like WebSocket paths were not exposed.
- MIDI-shaped frames did not reach the device engine.
- A sender's arbitrary frame was not observed by a second controlled client.
- The device remained responsive and the original tuner state was restored.

## Reproduction

With HeadRush Remote enabled and the device address/interface scope selected:

```powershell
$env:HEADRUSH_ADDRESS = "<device IPv4, hostname, or scoped IPv6 address>"
npm run discover:headrush-websocket -- --active --wait=10
```

The scanner records exact handshakes, responses, close codes, echoed payloads,
engine-state checks, cross-client results, and restoration status in
`reference/headrush/websocket-discovery.json`.
