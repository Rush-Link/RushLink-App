# Architecture

RushLink has a React/TypeScript frontend inside a Tauri 2 native host. The frontend owns the workspaces and editing workflows; Rust owns the restricted local-network transport. The same frontend runs with a simulated transport in a regular browser.

```text
React workspaces and reusable controls
                 |
Zustand workflows + pure domain rules
                 |
src/services/device-api.ts
        /                      \
browser simulation        Tauri commands/events
                                 |
                      src-tauri/src/lib.rs
                                 |
                    HeadRush HTTP + WebSocket API
```

## Source map

| Location | Responsibility |
| --- | --- |
| `src/App.tsx` | Workspace selection, connection/onboarding gates and refresh lifecycle. |
| `src/page-loaders.ts` | Lazy workspace imports and preloading. |
| `src/pages/` | Rig Editor, ToneMod, StageHand, tools, library, settings and diagnostics. |
| `src/components/ui/` | Shared UI primitives. |
| `src/components/system/` | App shell, instrument controls, connection UI and shared product components. |
| `src/domain/` | Types and device-independent rules: reflection mapping, NAM allocation, routing, layouts, MIDI and backups. |
| `src/services/` | Device IPC, provider saves, error handling, sync scheduling, MIDI and local-file adapters. |
| `src/stores/app-store.ts` | Application/session state, edits, live refresh and multi-step device workflows. |
| `src/stores/sync-adapter.ts` | Convert reflected device state into frontend models. |
| `src/stores/buffered-persist-storage.ts` | Batch local profile writes. |
| `src/hooks/` | Theme, viewport, workspace panel and interaction behavior. |
| `src/styles/` | Shared tokens, workspace styles and theme/responsive layers. |
| `src/data/` | Demo and test data; not a universal hardware contract. |
| `src-tauri/src/lib.rs` | Device session, address/route validation, HTTP commands and WebSocket events. |
| `src-tauri/capabilities/` | Native permissions exposed to the frontend. |
| `e2e/` | Chromium journeys and layout/accessibility checks. |
| `tools/` | Platform builds, release verification and repository checks. |

## Device boundary

The HeadRush reflection API is undocumented. Its object tree describes controls, methods, module types and availability. `headrush-reflection.ts` and `sync-adapter.ts` turn that live metadata into UI models. Use those capabilities rather than treating a captured firmware tree as a universal schema.

`device-api.ts` validates native responses and provides the frontend's transport interface. In a browser, it simulates connection and device operations. Native builds invoke Rust commands; the webview is not a general network proxy.

The Rust bridge permits local HTTP destinations: `.local`, localhost, loopback, private and link-local IPs. It rejects credentials in addresses and follows no redirects. Raw requests allow only GET/POST/PUT under `/api/`, plus GET access to the permitted static/editor asset paths. Route validation rejects traversal and protocol-relative paths. Preserve these restrictions when extending the API.

## State and synchronization

`App.tsx` listens for native WebSocket events and schedules coalesced workspace refreshes. Page-scoped HTTP polling provides a fallback when realtime events are quiet; periodic full reflection refreshes reconcile the session. Hidden windows avoid periodic polls, and active tuner workflows have their own refresh handling. `device-sync-scheduler.ts` prevents overlapping event-driven work.

The Zustand store coordinates edits, pending writes, provider auditions, saving, snapshots and restoration. Device workflows must verify reflected state when a command acknowledgement cannot establish completion. NAM allocation and Test Rig planning belong in domain rules; the store executes and verifies the resulting plan. See [the firmware notes](HEADRUSH-5.2.0.md) for the distinction between NAM block hosts, capture positions and A2 Full/Lite processing.

App-owned preferences, layouts, favorites, Test Rigs and cached data persist locally through the buffered storage adapter. Hydration validates and migrates saved state. This is local profile storage, not an encrypted database. Keep storage keys and migrations compatible with existing installations, and keep credentials and raw device captures out of exports and fixtures.

## UI and assets

Pages use shared controls and semantic styles. The import order in `src/main.tsx` and lazily loaded workspace styles matters; existing style ownership and cold-workspace browser tests catch cross-workspace regressions. Check Dark and Light themes and relevant touch layouts when modifying styles. Dark is the default, and System is an explicit user choice.

`public/` holds runtime logos and fonts; `src-tauri/icons/` holds native application icons. Preserve the accompanying [font and dependency notices](../THIRD_PARTY_NOTICES.md). The separate [website repository](https://github.com/Rush-Link/rush-link.github.io) owns website source and deployment.

Prefer small, testable domain helpers and shared services when adding behavior. Avoid introducing another state system or bypassing the transport boundary for a single workspace.
