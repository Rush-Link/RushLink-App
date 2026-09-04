# HeadRush cross-platform companion app plan

## Product vision

Build a fast, offline-first companion for HeadRush Prime, Core, and Flex Prime that makes deep editing, organizing, backup, performance preparation, and device management easier than the built-in screen or stock web editor.

The app should feel like a professional instrument rather than a generic administration dashboard: immediate, predictable, touch-friendly, stage-safe, and visually distinctive without compromising clarity.

Initial assumptions:

- Tauri 2 hosts a React + TypeScript single-page application.
- Windows, macOS Intel/Apple Silicon, iOS/iPadOS, and Android are first-class targets.
- Device communication happens directly over the local network and remains usable without an internet connection.
- Prime, Core, and Flex Prime share a reflection protocol but expose different capabilities and object trees.
- All writes are capability-checked, serialized, observable, and recoverable where the device API permits.
- The captured Flex Prime API snapshot is a development fixture, not a universal contract for all models or firmware versions.

## Product principles

1. **Capability-driven, not model-hardcoded.** Detect objects, properties, methods, firmware, and flags at runtime. Model-specific overrides are small adapters.
2. **Safe by default.** Show pending changes, distinguish live from staged edits, warn about destructive actions, and keep undo/snapshot history.
3. **Fast on stage.** Connection state and write acknowledgement must be obvious. Performance mode avoids accidental navigation and destructive gestures.
4. **Works on every screen.** Desktop supports dense workflows and keyboard control; tablets favor split panes and touch; phones use focused single-task flows.
5. **Local-first.** Core features do not require an account, cloud service, or vendor availability.
6. **Progressive disclosure.** Common controls remain simple; advanced metadata and raw API details are available without overwhelming normal use.
7. **Reusable UI.** Domain components receive typed data and callbacks; they never call the device API directly.

## Recommended architecture

```text
React UI and reusable component system
              |
Frontend application/domain state
              |
Typed Tauri commands and event subscriptions
              |
Rust application services
   |              |              |
Discovery     Device session   Local library
(mDNS/IP)     HTTP + WebSocket  SQLite/files
                     |
          HeadRush reflection API
```

The Rust layer should own discovery, HTTP, WebSocket connections, pairing, retries, write ordering, timeouts, file transfer, persistence, and security policy. The webview should not communicate with arbitrary device URLs directly. This removes browser CORS differences and gives all platforms one networking implementation.

The existing OpenAPI document remains useful for exploration, fixtures, documentation, and contract checking. Production code should use a small generic reflection client plus typed workflow facades rather than generating 1,000 route-specific client functions.

## Frontend plan

### Technology

- React with TypeScript and Vite.
- Tailwind CSS and shadcn/ui source-owned components.
- TanStack Router for typed, adaptive routes.
- TanStack Query for command/query lifecycle and cache coordination.
- Zustand for ephemeral editor/session state; use XState only for workflows whose state machines materially improve correctness, such as pairing and reconnecting.
- React Hook Form and Zod for local forms and validation.
- dnd-kit for signal-chain, scene, setlist, and footswitch interactions.
- A lightweight chart/canvas layer for meters, curves, timelines, and frequency displays; avoid DOM-heavy rendering for real-time signals.

### Frontend layers

```text
src/
  app/                 routing, providers, responsive shells
  components/
    ui/                owned shadcn primitives
    system/            reusable product-level components
  features/
    connection/
    signal-chain/
    parameters/
    rigs/
    setlists/
    scenes/
    footswitches/
    expression/
    drums/
    global-settings/
    library/
    backup/
    diagnostics/
  domain/              pure TypeScript types and transformations
  services/            typed Tauri command/event adapters
  stores/              short-lived UI and editor state
  styles/              tokens, motion, density and platform rules
  test/                fixtures, render helpers and fake sessions
```

Feature modules may import `ui`, `system`, `domain`, and `services`; reusable components must not import feature stores or networking code.

### Responsive application shells

- **Desktop:** persistent navigation rail, library/sidebar, central editor canvas, inspector panel, status strip.
- **Tablet landscape:** collapsible navigation plus editor/inspector split view.
- **Tablet portrait:** editor with inspector drawer and bottom device status.
- **Phone:** task-first navigation with bottom tabs; one primary editor surface at a time.
- **Performance mode:** full-screen, large targets, screen-awake option, accidental-edit lock, connection warning overlay.

Layouts should adapt by available width and input type, not by device-name checks.

## Component library plan

### Visual direction

Use a dark, near-black instrument-panel foundation with restrained spectral accents. The futuristic character should come from precision, depth, responsive meters, luminous focus edges, and excellent motion—not excessive glass blur, neon text, or decoration.

Recommended visual language:

- OKLCH semantic color tokens for consistent perceived brightness.
- Neutral graphite surfaces with cyan/indigo as the default interactive spectrum.
- Context colors for signal level, bypass, warning, destructive state, unsaved state, and connection quality.
- Thin luminous borders on focused/live elements.
- Subtle layered surfaces; glass effects only for transient overlays.
- Variable density modes: comfortable touch, compact desktop, stage.
- Motion durations tied to purpose: immediate controls, short navigation, slower connection/state transitions.
- Reduced-motion and high-contrast modes from day one.

Use shadcn/ui CSS-variable theming so branded tokens sit above the primitives. Keep upstream primitives recognizable and accessible; compose the distinctive look in product-level components.

### Token groups

- Surface: `canvas`, `panel`, `elevated`, `overlay`, `sunken`.
- Signal: `signal-clean`, `signal-hot`, `signal-clip`, `signal-muted`.
- Device: `connected`, `reconnecting`, `offline`, `incompatible`.
- Editing: `dirty`, `staged`, `writing`, `confirmed`, `conflict`.
- Block categories: amp, cab/IR, drive, modulation, delay, reverb, dynamics, utility, vocal, drum.
- Geometry: density, radius, border strength, touch target, panel width.
- Motion: instant feedback, transition, overlay, drag, meter smoothing.

### Reusable custom components

Foundation/system components:

- `AppShell`, `AdaptivePane`, `InspectorDrawer`, `CommandPalette`.
- `ConnectionOrb`, `DeviceBadge`, `CapabilityBadge`, `FirmwareBadge`.
- `StatusBanner`, `EmptyState`, `ErrorBoundaryPanel`, `OfflineOverlay`.
- `AsyncButton`, `SafetyAction`, `PendingWriteIndicator`, `UndoToast`.
- `VirtualList`, `SearchFilterBar`, `ResponsiveDataGrid`.

Instrument controls:

- `ParameterControl`: schema-driven dispatcher for boolean, enum, number, string, file, and unknown values.
- `ValueKnob`, `LinearFader`, `SteppedSelector`, `ToggleSwitch`, `XYPad`.
- `DbMeter`, `StereoMeter`, `CpuMeter`, `FrequencyCurve`, `ExpressionCurve`.
- `TempoControl`, `TapTempoPad`, `TunerDisplay`.

Signal and assignment components:

- `SignalChainCanvas`, `SignalPath`, `BlockNode`, `BlockSlot`, `DropIndicator`.
- `BlockBrowser`, `BlockCategoryRail`, `PresetPicker`.
- `SceneMatrix`, `FootswitchGrid`, `FootswitchAssignment`, `PedalMapper`.
- `QuickKnobPanel`, `RoutingDiagram`, `GlobalEqEditor`.

Library and workflow components:

- `RigCard`, `RigTable`, `SetlistTimeline`, `SongRunSheet`.
- `AssetBrowser`, `FileTypeBadge`, `CompatibilityBadge`, `DuplicateGroup`.
- `SnapshotCard`, `DiffViewer`, `ChangeTimeline`, `RestorePreview`.
- `BulkActionBar`, `TransferQueue`, `ConflictResolver`.

Each custom component should be controlled where practical, expose typed variants, support keyboard and touch input, include loading/disabled/error states, and have Storybook-style isolated examples even if Storybook itself is not selected.

## Backend plan

### Rust workspace/modules

```text
src-tauri/src/
  commands/             narrow Tauri IPC boundary
  discovery/            mDNS, cached devices, manual IP
  transport/            HTTP, WebSocket, timeouts and retries
  protocol/             reflection types and serialization
  devices/              capability profiles and model quirks
  sessions/             lifecycle, pairing and subscriptions
  operations/           typed high-level workflows
  library/              rigs, setlists, tags and local metadata
  backup/               snapshots, diff and restore planning
  persistence/          SQLite and file storage
  security/             URL validation, scopes and secret storage
  telemetry/            local logs and diagnostics, opt-in export
```

### Device discovery and sessions

- Discover `.local` devices using platform-appropriate mDNS/Bonjour APIs.
- Always provide manual hostname/IP entry and recently used devices.
- Validate identity through `/Evil/Gui`, product flags, firmware, and subtree fingerprint—not hostname alone.
- Support multiple saved devices, but initially allow one active write session.
- Use a clear state machine: unknown → discovering → found → pairing → synchronizing → ready → reconnecting/offline/incompatible.
- Fetch the subtree once, then maintain state from WebSocket notifications and targeted refreshes.
- Detect stale event streams with heartbeats/timeouts and reconcile after reconnection.
- Batch and serialize writes; coalesce high-frequency control changes without losing the final value.

### Capability model

Create a `DeviceCapabilities` document from the live subtree and known flags. It should answer questions such as:

- Does the device have vocals, song view, drums, alternate outputs, external amp control, two pedals, quick encoders, cloud, Tone3000, or external storage?
- Which blocks, methods, parameters, file types, ranges, and labels exist?
- Which properties are writable or read-only?
- Which workflows are safe on this firmware?

Features render from capabilities. A small compatibility registry can patch confirmed firmware quirks while preserving the raw observation for diagnostics.

### Persistence

Use SQLite for app-owned data:

- Known devices and connection history.
- User tags, favorites, notes, colors, collections, and smart filters.
- Snapshots and restore manifests.
- Operation history and diagnostics.
- Cached schemas and compatibility fingerprints.
- App preferences and per-platform layouts.

Store large imported/exported assets as files with content hashes and SQLite metadata. Store credentials/tokens only in platform-secure storage or Tauri Stronghold, never plain SQLite or logs.

### Safety and security

- Restrict network destinations to user-approved local devices and explicitly configured vendor services.
- Never expose an unrestricted fetch proxy to the frontend.
- Separate read, normal-write, destructive, file-transfer, and cloud permissions internally.
- Require confirmations for delete, overwrite, restore, firmware-sensitive, and bulk operations.
- Redact pairing pins, tokens, file paths, and personal metadata from diagnostics exports.
- Treat HTTP traffic as untrusted cleartext; do not transmit app secrets to the pedal.
- Keep an operation journal so interrupted writes can be reconciled.

## Platform plan

### Windows

- Ship x64 first; assess Windows ARM64 once the core app is stable.
- Use WebView2 and signed installers/MSIX as distribution requires.
- Test mDNS availability and provide IP fallback because Bonjour is not guaranteed.

### macOS

- Produce Intel and Apple Silicon builds, ideally a universal distribution artifact.
- Plan code signing and notarization from the beginning.
- Test local-network permission behavior on current macOS releases.

### iOS and iPadOS

- Build and sign on macOS with full Xcode.
- Add a clear `NSLocalNetworkUsageDescription`; add Bonjour service declarations once the device's advertised service type is confirmed.
- Test permission denial/recovery on physical devices, not only simulators.
- Optimize iPad split view, rotation, pointer/keyboard input, and external display behavior.

### Android

- Target phone and tablet layouts from one adaptive UI.
- Ship ARM64 as the primary physical-device ABI and x86_64 for emulators; add other ABIs only when justified.
- Add narrowly scoped cleartext-network configuration because the HeadRush endpoint is HTTP.
- Design now for Android's evolving local-network runtime permission and denial/recovery flows.

## Feature ideas and prioritization

### Foundation/MVP

- Device discovery, pairing, reconnect, and capability report.
- Responsive signal-chain editor with block search and drag/drop.
- Schema-driven parameter inspector with accurate labels, ranges, units, and enum values.
- Rig browser, load/save/save-as, rename, duplicate, and safe delete.
- Setlist browser/editor with fast reordering and bulk membership operations.
- Scene, footswitch, expression-pedal, and quick-control assignment editors.
- Global settings, tuner, tempo, CPU/storage status, and clear dirty-state handling.
- Undo/redo for app-issued edits and named local snapshots.

### High-value differentiators

- Universal search across rigs, presets, blocks, clones, IRs, NAM files, and setlists.
- Bulk rename/tag/color/move and duplicate detection.
- A/B compare with parameter-level diff and selective merge.
- Automatic local backup before destructive or bulk changes.
- Rig health checker: missing files, unsupported blocks, clipped gain stages, conflicting assignments.
- Smart setlists generated from tags, tempo, tuning, instrument, or performance date.
- Cross-device compatibility report before moving a rig between Prime/Core/Flex Prime.
- Full keyboard shortcuts, MIDI-triggerable commands, and command palette on desktop.
- QR/manual pairing handoff between desktop and mobile.

### Performance and practice

- Stage mode with oversized current/next rig, scene and footswitch state.
- Setlist run sheet with song notes, tuning, tempo, count-in, and next-song preview.
- Connection-loss protection and automatic screen wake management.
- Integrated tuner, tap tempo, drum controls, practice timer, and loop/audio asset organization where supported.
- Optional haptic confirmation on mobile for successful actions and warnings.

### Advanced/later

- Local library independent of the connected device.
- Import/export workflows once file formats and safe transfer mechanisms are understood.
- Visual routing and gain-staging assistant.
- Parameter morphing and controlled macro actions, with explicit safety limits.
- Community metadata or sharing as an optional service, separate from the local-first core.
- Developer mode: raw object tree, WebSocket event viewer, request inspector, and sanitized diagnostic bundle.

Avoid promising firmware updates, arbitrary device filesystem access, or perfect cross-model rig conversion until those protocols and formats are proven.

## Testing strategy

- Unit tests for reflection parsing, schema conversion, value normalization, capability detection, diffs, and write coalescing.
- Contract tests against the captured subtree/OpenAPI fixtures.
- A fake HeadRush server that replays HTTP responses and WebSocket events, including disconnects and malformed messages.
- Physical-device smoke suites for every supported model and representative firmware version.
- Component interaction and accessibility tests for mouse, keyboard, touch, reduced motion, and high contrast.
- Golden visual tests at desktop, tablet landscape/portrait, and common phone sizes.
- End-to-end tests for pairing, loading, editing, saving, reconnecting, backup, and restore preview.
- Performance budgets for first sync, large lists, canvas interaction, and high-frequency meter/event handling.

## Delivery phases

### Phase 0 — contracts and validation

- Confirm product name, licensing/branding position, distribution strategy, and supported firmware range.
- Capture subtrees and bundles from Prime and Core in addition to Flex Prime.
- Record mDNS service types, pairing behavior, WebSocket lifecycle, and single/multiple-client behavior.
- Establish fixtures, fake server, capability model, and risk register.

### Phase 1 — technical foundation

- Tauri workspace, React/Vite frontend, CI, formatting, tests, logging, and platform shells.
- Rust discovery/session/transport layer and read-only device explorer.
- Design tokens, shadcn primitives, reusable responsive shell, and component examples.

### Phase 2 — editing MVP

- Signal chain, parameter inspector, rigs, setlists, global settings, assignments, and safe writes.
- Desktop and tablet workflows first, followed immediately by focused phone flows.
- Flex Prime as the initial contract device, with capability architecture already in place.

### Phase 3 — library, backup and polish

- Local database, tagging/search, snapshots, diff, bulk actions, transfers, conflicts, and recovery.
- Accessibility, performance, offline behavior, diagnostics, onboarding, and permission recovery.

### Phase 4 — model parity and release

- Prime/Core compatibility passes and firmware matrix.
- Windows/macOS signing, notarization and installers.
- iOS/iPadOS and Android store builds, privacy disclosures, physical-device QA, and staged rollout.

## Key risks

- The API is undocumented and may change between firmware or models.
- Some device operations may not be reversible or may assume a single connected editor.
- Local HTTP and `.local` discovery require platform-specific permissions and fallbacks.
- iOS builds require macOS/Xcode; every store requires signing and release administration.
- WebSocket event rates may exceed what a naive React state model can render smoothly.
- App-store review may require clear explanation of local-network use and unofficial HeadRush branding.
- Bulk file transfer and cross-device conversion remain unknown until formats and transfer paths are characterized.

## Decisions needed before implementation

1. Product name and whether it will be explicitly branded as an unofficial HeadRush companion.
2. Commercial, paid, open-source, or private distribution model.
3. Which device and workflows define MVP priority.
4. Whether cloud/Tone3000 integration belongs in the first release or the app is initially local-only.
5. Whether the app may write immediately as controls move, or should support a staged/apply mode.
6. Which Prime and Core hardware/firmware versions are available for capture and physical testing.
7. Whether desktop and tablet release first, or all platforms must launch together.

### Decisions recorded 28 August 2026

1. Product name: **RushLink**, presented as an unofficial companion.
2. Distribution: free, proprietary/closed source.
3. MVP scope: all planned workflows, delivered as coherent vertical slices rather than isolated demos.
4. Available physical target: Flex Prime only; Prime/Core remain capability profiles pending captured hardware contracts.
5. Writes: both immediate and staged modes, selected in Settings and prompted on the first edit.
6. Vendor services: Tone3000 and HeadRush Cloud belong in the initial product slice.
7. Platform priority: desktop first so Windows can be tested immediately; other Tauri targets follow after the desktop/device contract stabilizes.
8. StageHand: configurable grid up to 4 rows × 8 columns, device-profiled shorter first row, draggable actions, and editable MIDI mirror messages.
9. MIDI: Web MIDI Learn and output are implemented for controllers exposed by the OS; native Bluetooth MIDI discovery/pairing remains platform-specific. Bluetooth audio configuration is excluded.

## Planning references

- [Tauri prerequisites and mobile targets](https://v2.tauri.app/start/prerequisites/)
- [Tauri frontend configuration](https://v2.tauri.app/start/frontend/)
- [Tauri HTTP client and permissions](https://v2.tauri.app/plugin/http-client/)
- [Tauri distribution overview](https://v2.tauri.app/distribute/)
- [shadcn/ui components](https://ui.shadcn.com/docs/components)
- [shadcn/ui theming](https://ui.shadcn.com/docs/theming)
- [Apple local-network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Android local-network permission](https://developer.android.com/privacy-and-security/local-network-permission)
- [Android network security configuration](https://developer.android.com/privacy-and-security/security-config)
