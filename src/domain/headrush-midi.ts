import type { LiveActionType, MidiCommand } from "./types";

// HeadRush Flex Prime User Guide v5.1.0, section 4.21 External MIDI Control.
// These are incoming commands understood by the device, not guessed API writes.
export const FLEX_PRIME_MIDI_CC = {
  expressionInternal: 1,
  expressionExternal: 2,
  tempoDown: 12,
  tempoUp: 13,
  expressionAB: 14,
  rigPrevious: 16,
  rigNext: 17,
  bankPrevious: 18,
  bankNext: 19,
  footswitchBankAB: 20,
  sceneFirst: 21,
  drumsOpenClose: 31,
  drumsPreviousKit: 32,
  drumsNextKit: 33,
  drumsPreviousStyle: 34,
  drumsNextStyle: 35,
  drumsPreviousVariation: 36,
  drumsNextVariation: 37,
  drumsVolumeDown: 38,
  drumsVolumeUp: 39,
  drumsIntensityDown: 40,
  drumsIntensityUp: 41,
  drumsPlayStop: 42,
  drumsFill: 43,
  drumsNextBridge: 44,
  drumsOutro: 45,
  drumsMute: 46,
  drumsAccent: 47,
  footswitchFirst: 49,
  tapTempo: 64,
  looperHalfSpeed: 65,
  looperDoubleSpeed: 66,
  looperHalfLoop: 67,
  looperDoubleLoop: 68,
  looperStartStop: 69,
  looperRecord: 70,
  looperInsert: 71,
  looperPeel: 72,
  looperMute: 73,
  looperReverse: 74,
  blockFirst: 75,
  handsFreeOpenClose: 90,
  looperOpenClose: 91,
  tunerOpenClose: 92,
  lockScreenOpenClose: 93,
  stompMode: 94,
  hybridMode: 95,
  setlistMode: 96,
  rigMode: 97,
  practiceOpenClose: 102,
  practicePlayPause: 103,
  practiceStop: 104,
  practiceVolumeDown: 105,
  practiceVolumeUp: 106,
  practiceLoopIn: 107,
  practiceLoopOut: 108,
  practiceSpeedDown: 109,
  practiceSpeedUp: 110,
  practicePitchDown: 111,
  practicePitchUp: 112,
  practicePrevious: 113,
  practiceNext: 114,
  practiceRewind: 115,
  practiceForward: 116,
  practiceLoopToggle: 117,
} as const;

export type StageMidiTarget =
  | "open" | "play-pause" | "stop" | "volume-down" | "volume-up" | "loop-in" | "loop-out"
  | "speed-down" | "speed-up" | "pitch-down" | "pitch-up" | "previous" | "next" | "rewind" | "forward"
  | "loop-toggle" | "toggle" | "record" | "insert" | "peel" | "reverse" | "half-speed" | "double-speed" | "half-loop" | "double-loop"
  | "fill" | "bridge" | "outro" | "mute" | "accent";

export function flexPrimeMidiCommand(action: LiveActionType, target?: string, slot?: number): MidiCommand {
  let number = 0;
  if (action === "rig-prev") number = FLEX_PRIME_MIDI_CC.rigPrevious;
  else if (action === "rig-next") number = FLEX_PRIME_MIDI_CC.rigNext;
  else if (action === "scene") number = FLEX_PRIME_MIDI_CC.sceneFirst + Math.max(0, "ABCDEF".indexOf(target ?? "A"));
  else if (action === "block-toggle") number = FLEX_PRIME_MIDI_CC.blockFirst + Math.max(0, Math.min(13, slot ?? 0));
  else if (action === "tap-tempo") number = FLEX_PRIME_MIDI_CC.tapTempo;
  else if (action === "tuner") number = FLEX_PRIME_MIDI_CC.tunerOpenClose;
  else if (action === "expression") number = FLEX_PRIME_MIDI_CC.expressionAB;
  else if (action === "looper") number = ({ open: 91, "half-speed": 65, "double-speed": 66, "half-loop": 67, "double-loop": 68, toggle: 69, record: 70, insert: 71, peel: 72, mute: 73, reverse: 74 } as Record<string, number>)[target ?? "open"] ?? FLEX_PRIME_MIDI_CC.looperOpenClose;
  else if (action === "drums") number = ({ open: 31, toggle: 42, fill: 43, bridge: 44, outro: 45, mute: 46, accent: 47 } as Record<string, number>)[target ?? "open"] ?? FLEX_PRIME_MIDI_CC.drumsOpenClose;
  else if (action === "practice") number = ({ open: 102, "play-pause": 103, stop: 104, "volume-down": 105, "volume-up": 106, "loop-in": 107, "loop-out": 108, "speed-down": 109, "speed-up": 110, "pitch-down": 111, "pitch-up": 112, previous: 113, next: 114, rewind: 115, forward: 116, "loop-toggle": 117 } as Record<string, number>)[target ?? "open"] ?? FLEX_PRIME_MIDI_CC.practiceOpenClose;
  return { type: "cc", channel: 1, number, value: 127, releaseValue: 0 };
}

export const FLEX_PRIME_MIDI_REFERENCE = [
  { group: "Rig", range: "CC 16–20", detail: "Rig, bank and footswitch-bank navigation" },
  { group: "Scenes", range: "CC 21–26", detail: "Scenes A–F" },
  { group: "Drums", range: "CC 31–47", detail: "Browser, kit/style, level and performance controls" },
  { group: "Looper", range: "CC 65–74, 91", detail: "Transport, layers, speed and open/close" },
  { group: "Rig blocks", range: "CC 75–88", detail: "Toggle signal-chain slots 1–14" },
  { group: "Tuner", range: "CC 92", detail: "Open/close the device tuner" },
  { group: "Practice", range: "CC 102–117", detail: "Track transport, loop, speed, pitch and volume" },
] as const;
