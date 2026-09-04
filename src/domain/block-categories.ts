import type { BlockCategory } from "./types";

/** HeadRush Flex Prime category palette shared by the catalogue and signal path. */
export const BLOCK_CATEGORY_COLORS: Record<BlockCategory, string> = {
  input: "#62e6f2",
  output: "#f1f5fb",
  vocal: "#ff7092",
  amp: "#ff845e",
  cab: "#b58cff",
  ir: "#b58cff",
  clone: "#ffad69",
  overdrive: "#ffd166",
  distortion: "#ff667d",
  drive: "#ffd166",
  eq: "#54e0bd",
  compressor: "#7fe09b",
  delay: "#55c2ff",
  reverb: "#f783c5",
  chorus: "#6f98ff",
  phaser: "#9d7cff",
  vibrato: "#44d0e7",
  modulation: "#6f98ff",
  filter: "#9bdd6c",
  pitch: "#d78cff",
  dynamics: "#a6d96a",
  rhythmic: "#ff9e58",
  synth: "#e96cff",
  utility: "#a9b7c8",
  "fx-loop": "#c7d2df",
};

export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  input: "Input",
  output: "Output",
  vocal: "Vocal",
  amp: "Amp",
  cab: "Cab / IR",
  ir: "Cab / IR",
  clone: "Clone",
  overdrive: "Overdrive",
  distortion: "Distortion / Fuzz",
  drive: "Drive",
  eq: "EQ",
  compressor: "Compressor",
  delay: "Delay",
  reverb: "Reverb",
  chorus: "Chorus",
  phaser: "Phaser / Flanger",
  vibrato: "Vib / Trem / Rotary",
  modulation: "Modulation",
  filter: "Wah / Filter",
  pitch: "Pitch",
  dynamics: "Volume / Dynamics",
  rhythmic: "Rhythmic",
  synth: "Synth",
  utility: "Utility",
  "fx-loop": "FX-Loop",
};

export const BLOCK_CATEGORY_GROUPS = [
  { id: "amp", label: "Amp", categories: ["amp"] },
  { id: "cab-ir", label: "Cab / IR", categories: ["cab", "ir"] },
  { id: "clone", label: "Clone", categories: ["clone"] },
  { id: "overdrive", label: "Overdrive", categories: ["overdrive", "drive"] },
  { id: "distortion", label: "Distortion / Fuzz", categories: ["distortion"] },
  { id: "eq", label: "EQ", categories: ["eq"] },
  { id: "compressor", label: "Compressor", categories: ["compressor"] },
  { id: "delay", label: "Delay", categories: ["delay"] },
  { id: "reverb", label: "Reverb", categories: ["reverb"] },
  { id: "chorus", label: "Chorus", categories: ["chorus"] },
  { id: "phaser", label: "Phaser / Flanger", categories: ["phaser", "modulation"] },
  { id: "vibrato", label: "Vib / Trem / Rotary", categories: ["vibrato"] },
  { id: "filter", label: "Wah / Filter", categories: ["filter"] },
  { id: "pitch", label: "Pitch", categories: ["pitch"] },
  { id: "dynamics", label: "Volume / Dynamics", categories: ["dynamics"] },
  { id: "rhythmic", label: "Rhythmic", categories: ["rhythmic"] },
  { id: "synth", label: "Synth", categories: ["synth"] },
  { id: "utility", label: "Utility", categories: ["utility"] },
  { id: "fx-loop", label: "FX-Loop", categories: ["fx-loop"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; categories: readonly BlockCategory[] }>;

export type BlockCategoryGroupId = typeof BLOCK_CATEGORY_GROUPS[number]["id"];

// Captured from /Evil/API/Blocks.categoryBlocks on Flex Prime firmware 5.1.
const DEVICE_CATEGORY_MEMBERS: ReadonlyArray<readonly [BlockCategory, readonly string[]]> = [
  ["amp", ["Amp", "ReValver Amp"]],
  ["cab", ["Cab", "ReValver Cab"]],
  ["ir", ["IR", "IR (1024)"]],
  ["clone", ["Amp Clone", "Neural Amp Modeler", "Pedal Clone", "SuperClone"]],
  ["overdrive", ["Anxiety OD", "Anxiety OD V2", "B2 Drive", "Budda OM OD", "Budda ZenMan", "D250 Drive", "Glorious Drive", "Green JRC-OD", "Greener", "Greener Lite", "Grinder Bass OD", "Jimmy OD", "K Drive", "Palace OD", "S1 Drive", "Sher'ff", "Treble Booster", "White Boost"]],
  ["distortion", ["8-Bit Crush", "B Dist 7000", "Black Death", "Black Op", "D1 Dist", "DC Distort", "MX Dist", "Oct Fuzz", "Round Fuzz", "Slab O Meat", "Tri Fuzz"]],
  ["eq", ["Acoust Sim", "Acoustic Pre", "Auto Q 8 Band EQ", "Bass EQ", "G EQ", "Graphic Bass EQ", "Graphic EQ", "Para EQ", "Promise EQ", "Ten Freq EQ"]],
  ["compressor", ["Budda Comp", "DynIII Comp", "Gray Comp", "Pressor", "Side Comp", "Slammer"]],
  ["delay", ["AIR Delay", "Again Delay", "BBD Delay", "Budda Samsara Delay", "Dyn Delay", "Grain Delay", "M104 Analog Delay", "Multi Delay", "Pitch Delay", "Reso Delay", "Reverse Delay", "Stereo Doubler", "Tape Echo", "Time Warp"]],
  ["reverb", ["AIR Reverb", "Ambi Verb", "C-Verb", "Eleven Reverb", "Party Verb", "Shimmer", "Spring Guru", "Spring Reverb"]],
  ["chorus", ["Budda Karma Chorus", "C2 Bass Chorus", "C2 Chorus", "Chorus", "Detune", "Dim Chorus", "Multi Chorus"]],
  ["phaser", ["AIR Flanger", "Analog Flanger", "Digital Flanger", "Flanger", "Orange Phaser", "Ring Mod", "Square-Phase", "Stone Phaser", "Tron Phaser", "Vibe Phaser"]],
  ["vibrato", ["AIR Vibrato", "Panner", "Rotary", "Tremolo", "Tube Tremolo", "Vibrato"]],
  ["filter", ["AIR Filter", "Black Wah", "Bud Wah", "Env Filter", "More Wah", "Shine Wah", "Tron Filter", "White Bass Wah"]],
  ["pitch", ["Chord Wham", "Drop Tune", "Harm", "Octaves", "Octaves Up", "Smart Harm", "Up Tune", "Wham"]],
  ["dynamics", ["Auto Swell", "Feedback", "Hold", "Sustain", "Volume"]],
  ["rhythmic", ["Kill Seq", "Splicer"]],
  ["synth", ["Ambi Verb", "DB-33", "Electric", "Hybrid"]],
  ["utility", ["Gate", "Kaften Gate", "Noise Filter"]],
  ["fx-loop", ["FX-Loop"]],
];

const categoryByDeviceName = new Map<string, BlockCategory>();
for (const [category, names] of DEVICE_CATEGORY_MEMBERS) {
  // Some blocks intentionally appear in more than one picker category (for
  // example Ambi Verb in Reverb and Synth). The first match is its signal-path
  // identity while category filtering retains every membership below.
  for (const name of names) if (!categoryByDeviceName.has(name.toLowerCase())) categoryByDeviceName.set(name.toLowerCase(), category);
}

export function blockBelongsToCategoryGroup(name: string, groupId: BlockCategoryGroupId): boolean {
  const canonical = name.replace(/\s+2$/, "").trim().toLowerCase();
  const group = BLOCK_CATEGORY_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) return false;
  if (DEVICE_CATEGORY_MEMBERS.some(([category, names]) => group.categories.some((candidate) => candidate === category) && names.some((candidate) => candidate.toLowerCase() === canonical))) return true;
  return group.categories.some((category) => category === categoryForBlockName(name));
}

export function categoryForBlockName(name: string, effectType = 0): BlockCategory {
  const canonical = name.replace(/\s+2$/, "").trim();
  const exact = categoryByDeviceName.get(canonical.toLowerCase());
  if (exact) return exact;
  const lower = canonical.toLowerCase();
  if (/\bir\b|impulse/.test(lower)) return "ir";
  if (effectType === 3 || /\bcab\b/.test(lower)) return "cab";
  if (/clone|neural amp modeler/.test(lower)) return "clone";
  if (effectType === 2 || /\bamp\b|revalver/.test(lower)) return "amp";
  if (/\beq\b|equalizer|acoust(?:ic)? (?:sim|pre)/.test(lower)) return "eq";
  if (/comp|pressor|slammer/.test(lower)) return "compressor";
  if (/delay|echo|doubler|time warp/.test(lower)) return "delay";
  if (/reverb|\bverb\b|shimmer|spring guru/.test(lower)) return "reverb";
  if (/chorus|detune/.test(lower)) return "chorus";
  if (/flanger|phaser|ring mod|square-phase/.test(lower)) return "phaser";
  if (/vibrato|tremolo|rotary|panner/.test(lower)) return "vibrato";
  if (/wah|filter/.test(lower)) return "filter";
  if (/pitch|wham|harm|octave|tune/.test(lower)) return "pitch";
  if (/dist|fuzz|crush|black op/.test(lower)) return "distortion";
  if (/drive|boost|\bod\b/.test(lower)) return "overdrive";
  if (/sequence|splicer|rhyth/.test(lower)) return "rhythmic";
  if (/synth|organ|electric|hybrid/.test(lower)) return "synth";
  if (/volume|sustain|hold|swell|feedback/.test(lower)) return "dynamics";
  if (/fx.?loop/.test(lower)) return "fx-loop";
  return "utility";
}
