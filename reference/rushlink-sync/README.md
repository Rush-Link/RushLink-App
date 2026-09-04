# RushLink Sync document

RushLink Sync stores one JSON document per authenticated RushLink account. It is intentionally separate from HeadRush device storage and from the app's local Zustand cache.

## Portable sections

- `stageHand`: stages and layouts, without MIDI bytes
- `midiMappings`: mappings keyed by stage ID and button ID
- `testRigs`: templates and test-rig sets
- `favourites`: rig, tone and block identifiers
- `interfacePreferences`: density, accessibility, wake-lock and sidebar choices
- `savedWorkflows`: reusable user-authored workflows

Every section has its own `updatedAt` and `updatedBy`. The root document has `revision` and `baseRevision`. This lets desktop and iOS preserve independent section changes while detecting concurrent edits to the same section.

## Local-only data

The account document never contains:

- HeadRush address, discovery state or current connection
- reflected device subtree, current rig state, tuner readings or meters
- Tone3000/HeadRush Cloud catalogue and model caches
- snapshots, rig edit history, pending writes or diagnostics
- Dropbox, RushLink or provider access/refresh tokens
- temporary TonePilot audition state

Authentication secrets belong in the operating system credential store. A device may keep the last accepted sync document locally as a three-way merge base.

## Account API contract

The frontend expects a compare-and-swap transport:

1. `pull(accountId)` returns the current document or `null`.
2. The client builds its document against the last locally accepted document.
3. Local, remote and base documents are merged section by section.
4. `push(accountId, document, expectedRevision)` succeeds only when the server revision still equals `expectedRevision`.
5. A revision conflict returns the latest document; the client merges and retries.

The backend assigns or confirms monotonically increasing revisions. It must derive `accountId` from the authenticated session rather than trusting a document to grant access.
