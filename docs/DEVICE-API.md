# Device API and hardware contributions

The HeadRush remote API is an unofficial integration surface. Firmware and
product variants can expose different objects, controls and methods. RushLink
reads reflection at runtime; a stored firmware snapshot is not its contract.

## Transport

The browser build runs a simulated device after the user connects. Real device
requests go through the Tauri bridge in
[`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs). The frontend transport is
[`device-api.ts`](../src/services/device-api.ts); reflection is interpreted by
[`headrush-reflection.ts`](../src/domain/headrush-reflection.ts).

The bridge confines device requests to HTTP on local/private addresses, rejects
credentials and redirects, validates paths and methods, and restricts raw
requests to its supported route families. Read the native validation code when
changing those rules. Do not add a general-purpose web proxy.

## Reflection protocol

| Route | Purpose |
| --- | --- |
| `GET /api/v1/subtree` | Read reflected object metadata and values |
| `GET /api/v1/object-meta/{objectPath}` | Read an object's schema |
| `GET /api/v1/object-properties/{objectPath}` | Read current properties |
| `PUT /api/v1/object-properties/{objectPath}` | Write supported properties |
| `POST /api/v1/object-method/{objectPath}/{method}` | Invoke a reflected method |

Use the existing client to encode paths and request bodies. Reflection contains
property ranges, enum labels, read-only/disabled controls and method arguments.
PUT bodies are JSON property maps; method POST bodies are `{ "arguments": [...] }`.
The frontend bridge returns `{ status, body }`; reflected method results can be
wrapped in `methodReturnValue` or contain serialized JSON. Reuse the existing
response helpers instead of assuming a single response envelope.
Honor that information instead of inventing endpoints or numeric IDs. Check the
actual result after a state-changing call; an HTTP success alone may not prove
that the engine accepted the requested allocation or file.

Device WebSocket notifications invalidate cached state. The sync scheduler
coalesces refreshes and uses scoped fallback polling when needed. Notifications
are not a confirmed general MIDI-input transport. User-selected OS MIDI devices
are a separate path from reflected HTTP commands.

## Files and credentials

The verified FileAccess API lists supported device files; it is not a general
filesystem backup service. NAM downloads and audition/save workflows use
reflected device methods and confirm the resulting identity. Do not assume that
a file listing proves file contents can be exported or restored.

A subtree can contain rig names, paths and account/service state. Use handwritten
fixtures such as
[`headrush-reflection.ts`](../src/test/fixtures/headrush-reflection.ts) for tests.
Share only the smallest redacted metadata necessary to reproduce a problem.
Third-party manuals, editor bundles, capture files and model audio do not belong
in this source tree. See [SECURITY](../SECURITY.md).

## Verification

Most work needs no hardware:

```sh
npm run test:native
npm run test:stagehand
npm run test:tonemod
```

These commands use synthetic fixtures or native bridge tests and do not run
live hardware probes. Historical discovery and allocation tools are archived
outside this repository. For hardware verification, use a native app build and
a backed-up device you control. Review the relevant transport/workflow before
testing writes, and verify the final device state and restoration result.

For a hardware report, include product, firmware, requested operation, observed
readback and restoration result. Separate simulation, metadata observations and
audio validation in the report. [Firmware 5.2 notes](HEADRUSH-5.2.0.md) document
the verified NAM allocation limits and outstanding audio validation.
