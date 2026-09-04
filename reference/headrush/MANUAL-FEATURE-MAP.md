# Flex Prime v5.1 manual feature map

This maps the user-facing workflows in `HeadRush Flex Prime - User Guide - v5.1.0.pdf` to the live reflection captured from the connected Flex Prime. The reflection is the deciding source for whether RushLink may safely control a feature.

| Manual workflow | Reflected support | RushLink status |
| --- | --- | --- |
| Fourteen-block rig chain | Patch Chain plus per-block objects | Implemented as two rows of seven in Rig Editor |
| Footswitch toggle, hold and scene modes | `FootSwitch` object | Continuously monitored in Assignments |
| Six scenes, one or two states, per-block On/Off/No Change | All six scene matrices and state-two properties | Scene matrix implemented for all 14 slots |
| Expression Pedals A/B, four targets each | `Pedal1`, `Pedal2`, `ExpressionPedal` | All eight assignment ranges shown; external EXP is identified as Pedal B |
| Drum Machine playback, fills, accents, bridge, outro, mute, kit mix, groove feel, fill pool and presets | `DrumsCtrl` properties and confirmed methods | Device-native Drummer console implemented in Performance Tools |
| Multiple performance layouts | App workspace plus live rig identity | StageHand stages persist independently, switch manually, and follow an attached rig when that rig loads |
| Main/Amp Global EQ | `GlobalEQMain`, `GlobalEQAmp` | Main EQ state and four-band monitor implemented; Main bypass is controllable |
| Tuner | `AudioCtrl/Input`, `AudioCtrl/Tuner`, and `FFTCtrl` | StageHand tuner deck reads note, cents and reference from the device and controls open/close safely |
| External MIDI control | `Settings/Midi`; incoming CC assignments are documented in manual section 4.21 | StageHand uses the documented CC 1–117 map and identifies press/release requirements |
| Looper | No reflected looper transport object in the captured v5.1 subtree | Documented CC controls can be sent through StageHand's user-selected operating-system MIDI output |
| Practice Tool / Dropbox songs | No reflected Practice Tool or Dropbox object, including after on-device Dropbox pairing | StageHand's **Practice Tool remote** uses documented incoming MIDI CC 102–117 for command-only transport, looping, speed, pitch and volume; RushLink does not advertise unavailable filename/timeline data, Dropbox integration or guessed HTTP writes |
| Bluetooth MIDI | Not exposed by the device reflection and requires platform-specific transport | Remains an explicit post-desktop TODO |

## Important manual behaviors retained in the design

- Scenes may combine several block states and can alternate between two scene states on one switch.
- The external EXP input controls Pedal B assignments.
- Drum Machine performance uses press, hold and double-tap gestures; RushLink exposes the underlying reflected actions directly.
- Flex Prime Looper Insert is available through incoming MIDI rather than its internal footswitches.
- The looper supports 50 layers, five minutes per layer and 20 minutes total; Peel removes and can restore layers.
- Controls not advertised by the connected firmware remain read-only guidance rather than guessed HTTP writes.

Official supporting references: [Flex Prime FAQ](https://support.headrushfx.com/en/support/solutions/articles/69000862403-headrush-flex-prime-frequently-asked-questions), [Drum Machine setup](https://support.headrushfx.com/en/support/solutions/articles/69000875010-headrush-fx-drum-machine-setup-and-troubleshooting), and the local v5.1 user guide at the project root.
