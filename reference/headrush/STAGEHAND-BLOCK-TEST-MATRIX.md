# StageHand block verification matrix

Last verified: 30 August 2026

## Automated result

- 196 StageHand unit and integration tests passed.
- 3 StageHand Chromium journeys passed.
- TypeScript and the production Vite build passed.
- The reversible Flex Prime verifier previously passed 72 live API capability/action checks and restored Scene D, tuner and drummer state.

Run the complete repeatable suite with `npm.cmd run test:stagehand`.

## Catalogue blocks

Each row has its own metadata/transport test and its own store-dispatch test.

| Blocks | Result | Verified path |
| --- | --- | --- |
| Rig previous, Rig next | Pass | Active-setlist boundary lookup and exact rig target |
| Scene A, B, C, D, E, F | Pass | CC 21–26, HTTP SceneActive1–6, rapid-write serialization |
| Tap Tempo | Pass | CC 64 and reflected tempo dispatch |
| Device Tuner | Pass | Tap opens/closes; hold mutes/unmutes |
| Tuner Display 1×2 | Pass | Same gestures plus live FFT readout |
| Practice Tool Remote | Pass / command-only | All 15 buttons and CC 103–117 tested; firmware exposes no playback state |
| Expression A/B | Pass / command-only | CC 14 mapping and shared MIDI dispatch |
| Looper 1×4, 2×3, 1×3, 2×2 | Pass / command-only | Every footprint and internal command; firmware exposes no looper state |
| Drum 1×4, 2×3, 1×3, 2×2 | Pass | Every footprint, HTTP method and CC mapping |
| Drums Play/Stop | Pass | togglePlay and CC 42 |
| Fill | Pass | playFill and CC 43 |
| Accent | Pass | playAccent/stopAccent press-release pair and CC 47 |
| Bridge | Pass | playBridge and CC 44 |
| Outro | Pass | playOutro and CC 45 |
| Drum Mute | Pass | toggleMute and CC 46 |
| Looper Remote | Pass / command-only | Open/close CC 91 |
| Multifunction | Pass when configured | Unassigned gestures are rejected; configured tap binding dispatches |

## Internal widget buttons

- Practice: previous, play/pause, stop, next, rewind, loop in, loop toggle, loop out, fast-forward, volume down/up, speed down/up and pitch down/up.
- Looper deck: record, play/stop, insert, peel, mute and reverse.
- Drummer deck: play/stop, fill, bridge, outro, mute and accent press/release.
- Tuner: short tap and long hold are tested independently so a hold cannot also fire a tap.

## Dynamic attached-rig blocks

The sample rig tests Noise Gate, Velvet Drive, Modern Lead, 4×12 Modern, Wide Chorus, Quarter Echo and Sky Plate individually. Each test verifies the correct reflected object path, `On` payload, optimistic state and resulting state. Input/output nodes are intentionally not offered as effect-toggle blocks.

## Hardware limits

Looper, Practice, Expression and custom MIDI blocks can prove exact outgoing bytes but cannot prove the resulting pedal state because Flex Prime firmware exposes no corresponding readback. Live rig navigation and effect toggles are not included in unattended device runs because they can discard or mark a user's current rig as modified.
