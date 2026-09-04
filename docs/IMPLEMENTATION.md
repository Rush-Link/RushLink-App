# RushLink implementation guide

RushLink is now a desktop-first Tauri 2 + React application. It is an unofficial, free, closed-source companion and is not affiliated with HeadRush or inMusic.

## What is implemented

- Responsive desktop shell and source-owned UI component system with instrument-style controls, semantic tokens, compact/comfortable/stage density, reduced motion, and high contrast.
- Flex Prime connection by `.local` hostname or private IP, live reflection-tree synchronization, runtime capability counting, HTTP request validation, reflected property/method calls, pairing command, and WebSocket event forwarding.
- Browser demo mode for working without a pedal; native builds use the Rust transport and never expose a general web proxy.
- Immediate and staged editing preferences, first-edit choice, pending changes, an operation log, and local persisted preferences/layouts.
- Live 14-slot rig editor in two fixed rows of seven, with topology-aware diagrams for Straight, Middle Split 3-4-3, 5-3-3, 7-2-3 and Immediate Split routing. Input/Mix/Output nodes, reflected controls, X2 doubling, drag moves and A/B comparison remain in the same workspace.
- Block preset management is at the top of the right inspector. Its graphic-response preview opens a full EQ/advanced popup; automatic history entries are clickable restore targets.
- Correct Flex Prime hardware model: three physical footswitches with A/B assignment banks, editable latch/momentary/scene behavior, dual-state 14-slot scenes and expression A/B assignments are embedded in the Rig Editor. Global and five-message Rig MIDI Out editing lives in Settings → MIDI.
- Reflected rig and setlist create/rename/delete/save/reorder workflows, reflected file listing, JSON library export, and restorable snapshots for the current rig, assignments, drums, MIDI, EQ and global settings.
- StageHand with 1–4 rows, 1–8 columns, an independently shorter device-profiled first row, draggable controls, edit/performance modes, layout lock, and a reusable action palette.
- Per-control MIDI mirror definitions for CC, PC, and Note messages, channels 1–16, command/value editing, and readable mappings. Confirmed reflected device actions are sent; unconfirmed virtual-footpress actions remain local to avoid guessed writes.
- TonePilot with live Tone3000 and HeadRush Cloud surfaces, automatic capture classification, manual override, six editable test templates, adaptive block bypass, exact-model selection, reflected demo start/stop, and download-to-device actions.
- Performance Tools with reflected drum controls/presets, editable Main/Amp Global EQ, device tuner muting, a local microphone tuner, app-side metronome and practice player, and a documented MIDI-CC looper bridge.
- Reflected Audio, General, MIDI and Expression settings, cloud sign-in/out actions, downloadable diagnostics, clearable logs, and an explicit raw API console.
- Local snapshot/library UI and sanitized diagnostics. The first desktop slice persists app-owned configuration in local storage; the Rust storage plugin is initialized for migration to encrypted/native structured storage.
- Original RushLink icon family generated for Windows, macOS, iOS, and Android.

## Important safety boundary

The Flex Prime API is undocumented. The Rust layer accepts only HTTP destinations that are `.local`, loopback, or private/link-local IP addresses. It rejects URL credentials, redirects, traversal paths, non-HTTP device URLs, arbitrary methods, and raw routes outside `/api/`.

The captured OpenAPI and subtree describe firmware `5.1.0.2a63755` on product `HG12`. RushLink detects the live object/property/method counts and capabilities rather than assuming every firmware is identical. The reflection adapter resolves the device's module-type table into all 14 live slots and derives each block's source object, enabled state, preset, parameters, normalized display values, rigs, setlists, footswitches, storage, CPU, settings, and service state.

## Continuous synchronization

- The full reflection subtree is loaded at connection and reconciled every 120 seconds while the app is visible.
- The device WebSocket is the low-latency invalidation channel. Event bursts are debounced for 140 ms and cause a small refresh for the current workspace.
- Page-scoped fallback polls run every 2.5 seconds for Overview, Rig Editor, StageHand, and Performance Tools, and every 6 seconds elsewhere. Hidden windows do not poll.
- Active block objects are included only on pages that need parameter-level state. A scoped refresh is coalesced so a slow request cannot create overlapping request storms.
- Tone3000 and HeadRush Cloud catalogs are fetched through their device-reflected methods and throttled to 60 seconds; typed searches use a 450 ms debounce.
- The Rust WebSocket worker reconnects with bounded backoff. The HTTP reconciliation path remains authoritative if an event is missed.

## Run on Windows

If a newly installed tool is not found, open a new terminal or prepend the paths for the current session:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:Path
```

Run the browser UI:

```powershell
npm install
npm run dev
```

Run the native app:

```powershell
npm run tauri dev
```

Windows native builds also need Microsoft C++ Build Tools with the Desktop development with C++ workload and WebView2. Restart the terminal after installing Rust so Cargo's user-level binary directory is available on `PATH`.

## Device connection

1. Put the desktop and Flex Prime on the same trusted LAN.
2. Open Settings → Device & network.
3. Use `headrushflexprime.local`, or enter the pedal's private IP if multicast DNS is unavailable.
4. Connect and inspect Diagnostics → Capabilities before enabling immediate writes.
5. Keep staged mode selected while testing unfamiliar firmware.

## Architecture

```text
src/                         React application
  components/ui/             source-owned primitives
  components/system/         reusable RushLink instrument controls/shell
  data/                      development/demo fixtures
  domain/                    capture analysis, layouts and types
  pages/                     product workspaces
  services/device-api.ts     typed native IPC adapter + browser simulation
  stores/app-store.ts        session/editor/application state

src-tauri/
  src/lib.rs                 restricted LAN transport and Tauri commands
  capabilities/default.json  minimal desktop permissions
  icons/                     generated cross-platform icon family

reference/headrush/          captured device contract and generated OpenAPI
archive/chrome-extension-*   previous extension, preserved for reference
```

## Verification

```powershell
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

The current suite covers capture-type inference, adaptive audition routing, StageHand dimension limits, layout resizing, MIDI command descriptions, and the captured Flex Prime reflection adapter. Add hardware contract tests before enabling bulk writes or restore on additional firmware.

## Deliberate boundaries

- Firmware updating and Bluetooth audio configuration are intentionally not implemented.
- RushLink can learn from and send to controllers already exposed by the operating system through Web MIDI. Native Bluetooth MIDI discovery/pairing remains platform work.
- Capture and verify Prime and Core subtrees/firmware before claiming hardware support.
- The captured firmware advertises directory listing but no confirmed arbitrary upload/delete contract, so the file browser is read-only.
- Add signed/notarized release pipelines, automated fake-device replay, physical-device smoke tests, and mobile permission shells after the desktop workflow stabilizes.
