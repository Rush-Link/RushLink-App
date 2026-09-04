import type { CloudTone, DeviceCapabilities, DeviceInfo, LiveButton, LiveLayout, LiveStage, Parameter, Rig, RigBlock, Setlist, Snapshot, TestRigTemplate } from "../domain/types";
import { BLOCK_CATEGORY_COLORS } from "../domain/block-categories";
import { flexPrimeMidiCommand } from "../domain/headrush-midi";
import { LIVE_DECK_DEFAULTS, LIVE_DECK_LAYOUTS } from "../domain/live-layout";
import { normalizeTestRigEffectOrder } from "../domain/tone-analysis";

const parameter = (id: string, label: string, value: number, min = 0, max = 10, unit = ""): Parameter => ({ id, sourceProperty: id, label, value, min, max, step: 0.1, unit, writable: true });
const percent = (id: string, label: string, value: number) => parameter(id, label, value, 0, 10, "%");
const toggle = (id: string, label: string, value: boolean): Parameter => ({ id, sourceProperty: id, label, value, writable: true });
const choice = (id: string, label: string, value: string, choices: string[], choiceValues: number[]): Parameter => ({ id, sourceProperty: id, label, value, choices, choiceValues, writable: true });
const slotEqualizer = (): Parameter[] => [
  { id: "SltEQOn", label: "Block EQ", value: false, writable: true },
  parameter("SltEQF", "Frequency", 1000, 20, 20000, "Hz"),
  parameter("SltEQG", "Gain", 0, -18, 18, "dB"),
  parameter("SltEQQ", "Q", 1, .2, 10),
  parameter("SltEQHP", "High-pass", 20, 20, 20000, "Hz"),
  parameter("SltEQLP", "Low-pass", 20000, 20, 20000, "Hz"),
  parameter("SltMix", "Mix", 100, 0, 100, "%"),
  { id: "SltPhase", label: "Phase", value: false, writable: true },
  { id: "SltPhaseR", label: "Right phase", value: false, writable: true },
];

const makeBlock = (id: string, name: string, model: string, category: RigBlock["category"], color: string, slot: number, enabled = true, controls?: Parameter[]): RigBlock => ({
  id, name, model, category, color, slot, enabled,
  parameters: [...(controls ?? (category === "amp"
    ? [parameter("gain", "Gain", 6.4), parameter("bass", "Bass", 4.8), parameter("mid", "Mid", 6.1), parameter("treble", "Treble", 5.5), parameter("presence", "Presence", 4.2), parameter("master", "Master", 7.2)]
    : category === "delay"
      ? [parameter("mix", "Mix", 26, 0, 100, "%"), parameter("time", "Time", 430, 1, 2000, "ms"), parameter("feedback", "Feedback", 32, 0, 100, "%")]
      : [parameter("mix", "Mix", 42, 0, 100, "%"), parameter("level", "Level", 6.8), parameter("tone", "Tone", 5.2)])), ...slotEqualizer()],
});

export const demoDevice: DeviceInfo = {
  id: "flex-prime-demo", name: "Flex Prime", model: "Prime Flex", host: "headrushflexprime.local",
  firmware: "5.1.0.2a63755", productCode: "HG12", status: "demo", latencyMs: 7,
  capabilities: ["Tone3000", "Cloud", "Wi-Fi", "Bluetooth Audio", "Drums", "Looper", "Scenes", "USB Storage"],
};

export const demoCapabilities: DeviceCapabilities = {
  product: "HG12 / Flex Prime", firmware: "5.1.0.2a63755", objectCount: 291, propertyCount: 7783, methodCount: 99,
  flags: { tone3000: true, cloud: true, vocals: true, drums: true, looper: true, scenes: true, bluetoothMidi: false, externalStorage: true },
  rawObjects: ["/Evil/API/Rigs", "/Evil/API/Setlists", "/Evil/API/Tone3000", "/Evil/Cloud/Master", "/Evil/Engine/Patch/Rig", "/Evil/Engine/FootSwitch", "/Evil/Engine/Settings/Midi"],
};

const mainBlocks = [
  makeBlock("b-input", "Guitar In", "Input", "input", BLOCK_CATEGORY_COLORS.input, 0),
  makeBlock("b-gate", "Noise Gate", "Noise Filter", "utility", BLOCK_CATEGORY_COLORS.utility, 1),
  makeBlock("b-drive", "Velvet Drive", "Green JRC-OD", "overdrive", BLOCK_CATEGORY_COLORS.overdrive, 2),
  makeBlock("b-amp", "Modern Lead", "Treadplate M-2", "amp", BLOCK_CATEGORY_COLORS.amp, 3),
  makeBlock("b-ir", "4×12 Modern", "Custom IR · 57 Edge", "ir", BLOCK_CATEGORY_COLORS.ir, 4),
  makeBlock("b-chorus", "Wide Chorus", "AIR Chorus", "chorus", BLOCK_CATEGORY_COLORS.chorus, 5, false),
  makeBlock("b-delay", "Quarter Echo", "Tape Echo", "delay", BLOCK_CATEGORY_COLORS.delay, 6),
  makeBlock("b-reverb", "Sky Plate", "AIR Reverb", "reverb", BLOCK_CATEGORY_COLORS.reverb, 7),
  makeBlock("b-output", "Main Out", "Output", "output", BLOCK_CATEGORY_COLORS.output, 8),
];

export const demoRigs: Rig[] = [
  { id: "rig-1", name: "Neon Boulevard", author: "RushLink", color: "#7c5cff", tags: ["lead", "ambient", "drop-d"], tempo: 124, favorite: true, modified: "Today, 16:42", blocks: mainBlocks },
  { id: "rig-2", name: "Glass Cathedral", author: "M. Carter", color: "#27d7c4", tags: ["clean", "stereo"], tempo: 92, favorite: true, modified: "Yesterday", blocks: mainBlocks.map((b) => ({ ...b, id: `g-${b.id}` })) },
  { id: "rig-3", name: "Rust & Thunder", author: "RushLink", color: "#ff784d", tags: ["rhythm", "heavy"], tempo: 138, favorite: false, modified: "24 Aug", blocks: mainBlocks.map((b) => ({ ...b, id: `r-${b.id}` })) },
  { id: "rig-4", name: "Velvet Static", author: "Nora G", color: "#ec70b1", tags: ["indie", "vintage"], tempo: 110, favorite: false, modified: "20 Aug", blocks: mainBlocks.slice(0, 7).map((b) => ({ ...b, id: `v-${b.id}` })) },
  { id: "rig-5", name: "Polar Clean", author: "RushLink", color: "#5ebeff", tags: ["clean", "funk"], tempo: 118, favorite: true, modified: "17 Aug", blocks: mainBlocks.map((b) => ({ ...b, id: `p-${b.id}` })) },
  { id: "rig-6", name: "Black Horizon", author: "LoudLab", color: "#d7df6b", tags: ["metal", "tight"], tempo: 172, favorite: false, modified: "12 Aug", blocks: mainBlocks.map((b) => ({ ...b, id: `h-${b.id}` })) },
];

export const demoSetlists: Setlist[] = [
  { id: "set-1", name: "Friday — The Foundry", items: [
    { id: "si-1", rigId: "rig-1", title: "Neon Boulevard", notes: "Long intro — scene B after count-in" },
    { id: "si-2", rigId: "rig-3", title: "Rust & Thunder" },
    { id: "si-3", rigId: "rig-2", title: "Glass Cathedral", notes: "Capo 2" },
    { id: "si-4", rigId: "rig-6", title: "Black Horizon" },
  ]},
  { id: "set-2", name: "Practice — New Material", items: [{ id: "si-5", rigId: "rig-4", title: "Velvet Static" }, { id: "si-6", rigId: "rig-5", title: "Polar Clean" }] },
];

const liveButtons: LiveButton[] = [
  { id: "live-1", label: "RIG −", subtitle: "Previous", action: "rig-prev", switchType: "trigger", color: "cyan", icon: "skip-back", midi: flexPrimeMidiCommand("rig-prev") },
  { id: "live-2", label: "RIG +", subtitle: "Next", action: "rig-next", switchType: "trigger", color: "cyan", icon: "skip-forward", midi: flexPrimeMidiCommand("rig-next") },
  { id: "live-3", label: "TAP", subtitle: "Device tempo", action: "tap-tempo", switchType: "trigger", color: "amber", icon: "timer", midi: flexPrimeMidiCommand("tap-tempo") },
  { id: "live-4", label: "DEVICE TUNER", subtitle: "Tap tuner · hold mute", action: "tuner", switchType: "multi", holdMs: 650, holdBinding: { action: "tuner", target: "mute", label: "Tuner mute" }, color: "rose", icon: "gauge", midi: flexPrimeMidiCommand("tuner") },
  { id: "live-5", label: "SCENE A", subtitle: "Verse", action: "scene", switchType: "trigger", target: "A", color: "violet", icon: "layers", active: true, midi: flexPrimeMidiCommand("scene", "A") },
  { id: "live-6", label: "SCENE B", subtitle: "Chorus", action: "scene", switchType: "trigger", target: "B", color: "violet", icon: "layers", midi: flexPrimeMidiCommand("scene", "B") },
  { id: "live-7", label: "DRIVE", subtitle: "Velvet Drive", action: "block-toggle", switchType: "toggle", target: "b-drive", color: "amber", icon: "zap", active: true, midi: flexPrimeMidiCommand("block-toggle", undefined, 1) },
  { id: "live-8", label: "DELAY", subtitle: "Quarter Echo", action: "block-toggle", switchType: "toggle", target: "b-delay", color: "mint", icon: "waves", active: true, midi: flexPrimeMidiCommand("block-toggle", undefined, 5) },
  { id: "live-9", label: "REVERB", subtitle: "Sky Plate", action: "block-toggle", switchType: "toggle", target: "b-reverb", color: "violet", icon: "sparkles", active: true, midi: flexPrimeMidiCommand("block-toggle", undefined, 6) },
  { id: "live-11", label: "DRUMS", subtitle: "Play / stop", action: "drums", target: "toggle", switchType: "toggle", color: "blue", icon: "disc", midi: flexPrimeMidiCommand("drums", "toggle") },
];

export const defaultLiveLayout: LiveLayout = {
  model: "Prime Flex", rows: 3, columns: 4, firstRowColumns: 4, locked: false,
  spacing: { columnGap: 10, rowGap: 10, insetTop: 16, insetRight: 16, insetBottom: 16, insetLeft: 16 },
  buttons: [...liveButtons, null],
};

export const defaultLiveStage: LiveStage = {
  id: "stage-main",
  name: "Main Stage",
  layout: defaultLiveLayout,
};

export type LiveButtonTemplate = Omit<LiveButton, "id"> & { group: "Rig" | "Scenes" | "Performance" | "Drum decks" | "Drums" | "Workspace" };

const drumDeckTemplates = (): LiveButtonTemplate[] => LIVE_DECK_LAYOUTS.map((layout) => ({
  group: "Drum decks",
  label: `DRUM ${layout.replace("x", "×")}`,
  subtitle: `${LIVE_DECK_DEFAULTS.drums[layout].length} assignable performance buttons`,
  action: "drums",
  target: "toggle",
  switchType: "toggle",
  widget: "drums",
  widgetLayout: layout,
  widgetActions: [...LIVE_DECK_DEFAULTS.drums[layout]],
  widgetSize: layout,
  width: 2,
  color: "blue",
  icon: "drum",
  midi: flexPrimeMidiCommand("drums", "toggle"),
}));

export const actionPalette: LiveButtonTemplate[] = [
  { group: "Rig", label: "RIG −", subtitle: "Previous setlist rig", action: "rig-prev", switchType: "trigger", color: "cyan", icon: "skip-back", midi: flexPrimeMidiCommand("rig-prev") },
  { group: "Rig", label: "RIG +", subtitle: "Next setlist rig", action: "rig-next", switchType: "trigger", color: "cyan", icon: "skip-forward", midi: flexPrimeMidiCommand("rig-next") },
  ..."ABCDEF".split("").map((scene): LiveButtonTemplate => ({ group: "Scenes", label: `SCENE ${scene}`, subtitle: `Recall scene ${scene}`, action: "scene", target: scene, switchType: "trigger", color: "violet", icon: "layers", midi: flexPrimeMidiCommand("scene", scene) })),
  { group: "Performance", label: "TAP TEMPO", subtitle: "Write calculated BPM", action: "tap-tempo", switchType: "trigger", color: "amber", icon: "timer", midi: { type: "cc", channel: 1, number: 64, value: 127, releaseValue: 0 } },
  { group: "Performance", label: "DEVICE TUNER", subtitle: "Tap tuner · hold mute", action: "tuner", switchType: "multi", holdMs: 650, holdBinding: { action: "tuner", target: "mute", label: "Tuner mute" }, color: "rose", icon: "gauge", midi: flexPrimeMidiCommand("tuner") },
  { group: "Performance", label: "TUNER DISPLAY", subtitle: "Tap tuner · hold mute · live display · 1×2", action: "tuner", switchType: "multi", holdMs: 650, holdBinding: { action: "tuner", target: "mute", label: "Tuner mute" }, widget: "tuner", widgetSize: "1x2", width: 2, color: "rose", icon: "gauge", midi: flexPrimeMidiCommand("tuner") },
  ...drumDeckTemplates(),
  { group: "Drums", label: "DRUMS", subtitle: "Play / stop", action: "drums", target: "toggle", switchType: "toggle", color: "blue", icon: "disc", midi: flexPrimeMidiCommand("drums", "toggle") },
  { group: "Drums", label: "FILL", subtitle: "Play next fill", action: "drums", target: "fill", switchType: "trigger", color: "blue", icon: "drum", midi: flexPrimeMidiCommand("drums", "fill") },
  { group: "Drums", label: "ACCENT", subtitle: "Press / release cymbal", action: "drums", target: "accent", switchType: "momentary", color: "amber", icon: "activity", midi: flexPrimeMidiCommand("drums", "accent") },
  { group: "Drums", label: "BRIDGE", subtitle: "Switch to bridge", action: "drums", target: "bridge", switchType: "trigger", color: "blue", icon: "route", midi: flexPrimeMidiCommand("drums", "bridge") },
  { group: "Drums", label: "OUTRO", subtitle: "Play ending", action: "drums", target: "outro", switchType: "trigger", color: "rose", icon: "flag", midi: flexPrimeMidiCommand("drums", "outro") },
  { group: "Drums", label: "DRUM MUTE", subtitle: "Mute / unmute", action: "drums", target: "mute", switchType: "toggle", color: "rose", icon: "volume-x", midi: flexPrimeMidiCommand("drums", "mute") },
  { group: "Workspace", label: "MULTIFUNCTION", subtitle: "Assign tap · hold · double tap · 1×1", action: "custom", switchType: "multi", multiFunction: true, holdMs: 650, color: "rose", icon: "terminal", midi: { type: "note", channel: 1, number: 60, value: 127, releaseValue: 0 } },
];

export const cloudTones: CloudTone[] = [
  { id: "t-1", title: "Brit 800 — Hot Mod", author: "TonePilot", description: "Dynamic British high-gain amp capture with a tight low end.", captureType: "amp", detectedType: "amp", tags: ["British", "High gain", "Amp"], rating: 4.9, downloads: 12400, source: "Tone3000", imageColor: "#f38b4d" },
  { id: "t-2", title: "Nashville Sparkle", author: "HarmonicHouse", description: "Complete clean combo chain with cabinet and open-air detail.", captureType: "amp+ir", detectedType: "amp+ir", tags: ["Clean", "Combo", "Amp + IR"], rating: 4.8, downloads: 8300, source: "Tone3000", imageColor: "#47c9c3" },
  { id: "t-3", title: "Green Screamer 808", author: "PedalVault", description: "Classic mid-forward overdrive pedal capture.", captureType: "effect", detectedType: "effect", tags: ["Overdrive", "Pedal", "Effect"], rating: 4.7, downloads: 21600, source: "Tone3000", imageColor: "#75c665" },
  { id: "t-4", title: "Oversized V30 — Ribbon", author: "CabLab", description: "Dark ribbon microphone impulse response for modern rhythm.", captureType: "ir", detectedType: "ir", tags: ["4×12", "V30", "IR"], rating: 4.6, downloads: 6800, source: "HeadRush Cloud", imageColor: "#8e75db" },
  { id: "t-5", title: "Crystal Ambient Chain", author: "ArcLight", description: "Full ambient rig with compression, clean amp, delay and shimmer.", captureType: "full-rig", detectedType: "full-rig", tags: ["Ambient", "Full rig", "Stereo"], rating: 4.9, downloads: 4100, source: "HeadRush Cloud", imageColor: "#4b9ceb" },
  { id: "t-6", title: "German Metal 100", author: "HeavyUnit", description: "Focused modern high-gain amp capture for drop tunings.", captureType: "amp", detectedType: "amp", tags: ["Metal", "Modern", "Amp"], rating: 4.8, downloads: 9700, source: "Tone3000", imageColor: "#e05262" },
];

const AMP_MODELS = ["67 Black Duo", "67 Plexiglas Vari", "82 Lead 800 100W", "85 M-2 Lead", "99 PV51 II Lead"];
const AMP_MODEL_VALUES = [15, 17, 23, 30, 45];
const ELEVEN_REVERB_MODES = ["Small Room", "Rich Hall", "Medium Plate", "Long Plate"];
const ELEVEN_REVERB_MODE_VALUES = [2, 12, 19, 20];

interface TestRigSound {
  amp: string;
  ampControls: Parameter[];
  drive?: { model: string; category: RigBlock["category"]; controls: Parameter[] };
  compressor?: Parameter[];
  ir: { file: string; lowCut: number; highCut: number };
  delay?: Parameter[];
  reverb?: { model: "Spring Reverb" | "Eleven Reverb"; controls: Parameter[] };
  eq?: Parameter[];
}

const ampControls = (model: string, controls: Parameter[]) => [
  choice("Type", "Model", model, AMP_MODELS, AMP_MODEL_VALUES),
  ...controls,
  parameter("Trim", "Output level", 0, -18, 18, "dB"),
];
const irControls = ({ file, lowCut, highCut }: TestRigSound["ir"]): Parameter[] => [
  toggle("Doubling", "Mode", false),
  {
    id: "IR",
    sourceProperty: "IR",
    label: "IR file",
    value: `Impulse Responses/Choptones/${file}`,
    writable: true,
    deviceFile: { fileType: 2, startPath: "Impulse Responses" },
  },
  parameter("Gain", "Gain", 0, -48, 18, "dB"),
  parameter("LoCut", "Low cut", lowCut, 20, 5000, "Hz"),
  parameter("HiCut", "High cut", highCut, 500, 20000, "Hz"),
  percent("Mix", "Mix", 10),
];
const springControls = (decay: number, tone: number, mix: number): Parameter[] => [
  parameter("Decay", "Decay", decay, 1, 5.4, "s"), parameter("Tone", "Tone", tone, 3.2, 17, "kHz"),
  percent("Mix", "Mix", mix), toggle("DiffusionOn", "Diffusion", true), percent("Width", "Width", 6.5), toggle("Tails", "Tails", true),
];
const elevenControls = (mode: string, decay: number, tone: number, preDelay: number, mix: number): Parameter[] => [
  choice("Mode", "Mode", mode, ELEVEN_REVERB_MODES, ELEVEN_REVERB_MODE_VALUES),
  percent("Decay", "Decay", decay), percent("Tone", "Tone", tone), parameter("Pre-Delay", "Pre-delay", preDelay, 0, 200, "ms"),
  percent("Mix", "Mix", mix), toggle("Tails", "Tails", true),
];

const TEST_RIG_SOUNDS: Record<string, TestRigSound> = {
  clean: {
    amp: "67 Black Duo",
    ampControls: ampControls("67 Black Duo", [percent("GainA", "Volume", 3.8), percent("Bass", "Bass", 4.3), percent("Mid", "Middle", 5), percent("Treble", "Treble", 5.7), toggle("Bright", "Bright", true), toggle("Tremolo", "Vibrato", false)]),
    compressor: [percent("Sustain", "Sustain", 2.5), percent("Level", "Level", 5.2)],
    ir: { file: "CT-Fend312EMFDS-4217B.wav", lowCut: 75, highCut: 8500 },
    reverb: { model: "Spring Reverb", controls: springControls(3, 5.2, 1.5) },
  },
  overdrive: {
    amp: "67 Black Duo",
    ampControls: ampControls("67 Black Duo", [percent("GainA", "Volume", 4.6), percent("Bass", "Bass", 4.2), percent("Mid", "Middle", 5.8), percent("Treble", "Treble", 5), toggle("Bright", "Bright", false), toggle("Tremolo", "Vibrato", false)]),
    compressor: [percent("Sustain", "Sustain", 1.6), percent("Level", "Level", 5.1)],
    drive: { model: "B2 Drive", category: "overdrive", controls: [percent("Gain", "Gain", 4), percent("Tone", "Tone", 5), percent("Level", "Level", 5.8)] },
    ir: { file: "CT-Mgan112AlnG-42158.wav", lowCut: 80, highCut: 7500 },
    reverb: { model: "Spring Reverb", controls: springControls(2.6, 4.5, 1.3) },
  },
  distortion: {
    amp: "67 Plexiglas Vari",
    ampControls: ampControls("67 Plexiglas Vari", [percent("GainA", "High volume", 7.2), percent("GainB", "Normal volume", 2.2), percent("Bass", "Bass", 4), percent("Mid", "Middle", 6.8), percent("Treble", "Treble", 6), percent("Presence", "Presence", 5.5), percent("Master", "Master", 6)]),
    drive: { model: "White Boost", category: "overdrive", controls: [percent("Gain", "Gain", 1.2), percent("Treble", "Treble", 5.5), percent("Bass", "Bass", 4.8), percent("Volume", "Level", 7)] },
    ir: { file: "CT-Brit412V30-160121.wav", lowCut: 80, highCut: 7200 },
    reverb: { model: "Eleven Reverb", controls: elevenControls("Medium Plate", 2.4, 4.7, 12, 1) },
  },
  lead: {
    amp: "82 Lead 800 100W",
    ampControls: ampControls("82 Lead 800 100W", [percent("GainA", "Preamp", 6), percent("Master", "Master volume", 6), percent("Bass", "Bass", 4.3), percent("Mid", "Middle", 7), percent("Treble", "Treble", 5.6), percent("Presence", "Presence", 5)]),
    drive: { model: "S1 Drive", category: "overdrive", controls: [percent("Drive", "Drive", .8), percent("Tone", "Tone", 5), percent("Level", "Level", 7)] },
    ir: { file: "CT-Brit412V30-160121.wav", lowCut: 85, highCut: 6800 },
    delay: [toggle("Sync", "Sync", false), parameter("Delay", "Delay", 390, 1, 4000, "ms"), percent("Feedback", "Feedback", 2.8), parameter("Ratio", "Ratio", 0, -100, 100, "%"), percent("Width", "Width", 7), toggle("Stereo", "Stereo", true), parameter("EnvFbk", "Envelope feedback", 0, -100, 100, "%"), parameter("EnvMix", "Envelope mix", 15, -100, 100, "%"), parameter("EnvRate", "Envelope rate", .4, .01, 1, "s"), parameter("LoCut", "Low cut", 150, 20, 1000, "Hz"), parameter("HiCut", "High cut", 5000, 1000, 20000, "Hz"), percent("Mix", "Mix", 2), toggle("Tails", "Tails", true)],
    reverb: { model: "Eleven Reverb", controls: elevenControls("Rich Hall", 4, 4.4, 28, 1.3) },
  },
  rhythm: {
    amp: "85 M-2 Lead",
    ampControls: ampControls("85 M-2 Lead", [percent("GainA", "Drive", 5.5), percent("Master", "Master volume", 5), percent("Bass", "Bass", 3.2), percent("Mid", "Middle", 4.8), percent("Treble", "Treble", 5.8), percent("Presence", "Presence", 5.2), toggle("Bright", "Bright", true)]),
    drive: { model: "Green JRC-OD", category: "overdrive", controls: [percent("Drive", "Drive", .2), percent("Tone", "Tone", 5.7), percent("Level", "Level", 8.5)] },
    ir: { file: "CT-Bogie412V30-57421.wav", lowCut: 90, highCut: 6500 },
    eq: [parameter("Gain31", "30 Hz", -3, -12, 12, "dB"), parameter("Gain62", "60 Hz", -1.5, -12, 12, "dB"), parameter("Gain125", "125 Hz", .5, -12, 12, "dB"), parameter("Gain250", "250 Hz", 0, -12, 12, "dB"), parameter("Gain500", "500 Hz", -.8, -12, 12, "dB"), parameter("Gain1k", "1 kHz", -.5, -12, 12, "dB"), parameter("Gain2k", "2 kHz", .7, -12, 12, "dB"), parameter("Gain4k", "4 kHz", 1, -12, 12, "dB"), parameter("Gain8k", "8 kHz", -1.5, -12, 12, "dB"), parameter("Gain16k", "16 kHz", -4, -12, 12, "dB"), parameter("Gain", "Level", 0, -18, 6, "dB")],
  },
  metal: {
    amp: "99 PV51 II Lead",
    ampControls: ampControls("99 PV51 II Lead", [percent("GainA", "Pre gain", 5.8), percent("Master", "Post", 5), percent("Bass", "Low", 4.4), percent("Mid", "Middle", 4.2), percent("Treble", "High", 5.7), percent("Presence", "Presence", 5.2)]),
    drive: { model: "Green JRC-OD", category: "overdrive", controls: [percent("Drive", "Drive", .1), percent("Tone", "Tone", 6), percent("Level", "Level", 8.8)] },
    ir: { file: "CT-Bogie412V30-57421.wav", lowCut: 85, highCut: 6200 },
  },
};

const templateBlocks = (style: string): RigBlock[] => {
  const sound = TEST_RIG_SOUNDS[style];
  const base = [makeBlock(`${style}-input`, "Input", "Guitar In", "input", BLOCK_CATEGORY_COLORS.input, 0)];
  if (sound.compressor) base.push(makeBlock(`${style}-compressor`, "Gray Comp", "Gray Comp", "compressor", BLOCK_CATEGORY_COLORS.compressor, 1, true, sound.compressor));
  if (sound.drive) base.push(makeBlock(`${style}-drive`, sound.drive.model, sound.drive.model, sound.drive.category, BLOCK_CATEGORY_COLORS[sound.drive.category], 3, true, sound.drive.controls));
  base.push(makeBlock(`${style}-amp`, sound.amp, "Amp", "amp", BLOCK_CATEGORY_COLORS.amp, style === "rhythm" ? 4 : 5, true, sound.ampControls));
  base.push(makeBlock(`${style}-capture`, "Capture slot", "Neural Amp Modeler", "clone", BLOCK_CATEGORY_COLORS.clone, 6));
  base.push(makeBlock(`${style}-ir`, "IR Loader", "IR", "ir", BLOCK_CATEGORY_COLORS.ir, 7, true, irControls(sound.ir)));
  if (sound.delay) base.push(makeBlock(`${style}-delay`, "Dynamic Lead Delay", "Dyn Delay", "delay", BLOCK_CATEGORY_COLORS.delay, 8, true, sound.delay));
  if (sound.eq) base.push(makeBlock(`${style}-eq`, "Rhythm contour", "Ten Freq EQ", "eq", BLOCK_CATEGORY_COLORS.eq, 5, true, sound.eq));
  if (sound.reverb) base.push(makeBlock(`${style}-verb`, sound.reverb.model, sound.reverb.model, "reverb", BLOCK_CATEGORY_COLORS.reverb, 9, true, sound.reverb.controls));
  base.push(makeBlock(`${style}-output`, "Output", "Main Out", "output", BLOCK_CATEGORY_COLORS.output, 13));
  return normalizeTestRigEffectOrder(base);
};

export const testRigTemplates: TestRigTemplate[] = [
  { id: "clean", name: "Clean", description: "Neutral, high-headroom reference chain", blocks: templateBlocks("clean") },
  { id: "overdrive", name: "Overdrive", description: "Edge-of-breakup feel and pedal response", blocks: templateBlocks("overdrive") },
  { id: "distortion", name: "Distortion", description: "Dense drive with controlled ambience", blocks: templateBlocks("distortion") },
  { id: "lead", name: "Lead", description: "Focused mids, delay and sustaining space", blocks: templateBlocks("lead") },
  { id: "rhythm", name: "Rhythm", description: "Fast response and mix-ready clarity", blocks: templateBlocks("rhythm") },
  { id: "metal", name: "Metal", description: "Tight boost and dry cabinet reference", blocks: templateBlocks("metal") },
];

export const demoSnapshots: Snapshot[] = [
  { id: "snap-1", name: "Before Friday rehearsal", createdAt: "28 Aug · 15:24", device: "Flex Prime", rigCount: 42, setlistCount: 6, size: "18.4 MB" },
  { id: "snap-2", name: "Post firmware 5.1", createdAt: "24 Aug · 09:11", device: "Flex Prime", rigCount: 39, setlistCount: 5, size: "17.8 MB" },
  { id: "snap-3", name: "Factory + personal IRs", createdAt: "17 Aug · 20:02", device: "Flex Prime", rigCount: 31, setlistCount: 4, size: "42.1 MB" },
];
