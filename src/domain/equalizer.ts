import type { Parameter } from "./types";

export interface EqualizerBand {
  id: string;
  label: string;
  frequency: number;
  gain: number;
  q: number;
  frequencyParameter?: Parameter & { value: number };
  gainParameter: Parameter & { value: number };
  qParameter?: Parameter & { value: number };
}

const FIXED_FREQUENCIES: Record<string, number> = {
  logain: 100, lowgain: 100, bass: 100,
  lomidgain: 350, lowmidgain: 350,
  midgain: 1000, middle: 1000, mid: 1000,
  himidgain: 3500, highmidgain: 3500,
  higain: 8000, highgain: 8000, treble: 5000, presence: 8000,
};
const SLOT_EQ_LABELS: Record<string, string> = { SltEQOn: "Block EQ", SltEQF: "Frequency", SltEQG: "Gain", SltEQQ: "Q", SltEQHP: "High-pass", SltEQLP: "Low-pass", SltMix: "Mix", SltPhase: "Phase", SltPhaseR: "Right phase" };

const numeric = (parameter: Parameter | undefined): parameter is Parameter & { value: number } => typeof parameter?.value === "number";
const keyOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const fixedFrequency = (token: string) => token.toLowerCase().endsWith("k") ? Number.parseFloat(token) * 1000 : Number(token);

export const EQ_GRAPH_BOUNDS = { left: 46, right: 780, top: 24, bottom: 190, center: 107 } as const;

export function equalizerXForFrequency(frequency: number): number {
  const clamped = Math.max(20, Math.min(20000, frequency));
  return EQ_GRAPH_BOUNDS.left + Math.log10(clamped / 20) / Math.log10(1000) * (EQ_GRAPH_BOUNDS.right - EQ_GRAPH_BOUNDS.left);
}

export function equalizerFrequencyForX(x: number): number {
  const clamped = Math.max(EQ_GRAPH_BOUNDS.left, Math.min(EQ_GRAPH_BOUNDS.right, x));
  return 20 * Math.pow(1000, (clamped - EQ_GRAPH_BOUNDS.left) / (EQ_GRAPH_BOUNDS.right - EQ_GRAPH_BOUNDS.left));
}

export function equalizerYForGain(gain: number, range: number): number {
  const safeRange = Math.max(1, range);
  const clamped = Math.max(-safeRange, Math.min(safeRange, gain));
  return EQ_GRAPH_BOUNDS.center - clamped / safeRange * (EQ_GRAPH_BOUNDS.bottom - EQ_GRAPH_BOUNDS.top) / 2;
}

export function equalizerGainForY(y: number, range: number): number {
  const safeRange = Math.max(1, range);
  const halfHeight = (EQ_GRAPH_BOUNDS.bottom - EQ_GRAPH_BOUNDS.top) / 2;
  const clamped = Math.max(EQ_GRAPH_BOUNDS.top, Math.min(EQ_GRAPH_BOUNDS.bottom, y));
  return (EQ_GRAPH_BOUNDS.center - clamped) / halfHeight * safeRange;
}

export function equalizerBands(parameters: Parameter[]): EqualizerBand[] {
  const byKey = new Map<string, Parameter>();
  for (const parameter of parameters) { byKey.set(keyOf(parameter.id), parameter); byKey.set(keyOf(parameter.label), parameter); }
  const findNumeric = (...keys: string[]) => keys.map((key) => byKey.get(keyOf(key))).find(numeric);
  const bands: EqualizerBand[] = []; const used = new Set<string>();

  for (const gainParameter of parameters.filter(numeric)) {
    const id = keyOf(gainParameter.id); const label = keyOf(gainParameter.label);
    let frequency: number | null = null; let frequencyParameter: EqualizerBand["frequencyParameter"]; let qParameter: EqualizerBand["qParameter"]; let bandLabel = gainParameter.label;

    if (id === "slteqg") {
      frequencyParameter = findNumeric("SltEQF"); qParameter = findNumeric("SltEQQ");
      if (!frequencyParameter) continue;
      frequency = frequencyParameter.value; bandLabel = "Block EQ";
    } else {
      const encoded = id.match(/^gain(31|62|125|250|500|1k|2k|4k|8k|16k)$/);
      const numbered = id.match(/^gain([1-9][0-9]?)$/);
      if (encoded) {
        frequency = fixedFrequency(encoded[1]); bandLabel = encoded[1].toUpperCase().replace("K", " kHz").replace(/^(\d+)$/, "$1 Hz");
      } else if (numbered) {
        const number = numbered[1]; frequencyParameter = findNumeric(`Freq${number}`, `Frequency${number}`); qParameter = findNumeric(`Q${number}`, `Width${number}`);
        if (frequencyParameter) frequency = frequencyParameter.value;
      } else {
        frequency = FIXED_FREQUENCIES[id] ?? FIXED_FREQUENCIES[label] ?? null;
      }
    }

    if (frequency === null || !Number.isFinite(frequency) || used.has(gainParameter.id)) continue;
    used.add(gainParameter.id);
    bands.push({ id: gainParameter.id, label: bandLabel, frequency: Math.max(20, Math.min(20000, frequency)), gain: gainParameter.value, q: Math.max(.1, qParameter?.value ?? 1), frequencyParameter, gainParameter, qParameter });
  }

  return bands.sort((left, right) => left.frequency - right.frequency);
}

export function equalizerParameters(parameters: Parameter[], bands = equalizerBands(parameters)): Parameter[] {
  const ids = new Set(bands.flatMap((band) => [band.frequencyParameter?.id, band.gainParameter.id, band.qParameter?.id]).filter((id): id is string => Boolean(id)));
  for (const parameter of parameters) if (/^(pre|post)gain$|^slteq(on|hp|lp|f|g|q)$|^slt(mix|phase|phaser)$/i.test(parameter.id)) ids.add(parameter.id);
  return parameters.filter((parameter) => ids.has(parameter.id));
}

export function slotEqualizerParameters(parameters: Parameter[]): Parameter[] {
  return parameters.filter((parameter) => parameter.id in SLOT_EQ_LABELS).map((parameter) => ({ ...parameter, label: SLOT_EQ_LABELS[parameter.id] }));
}
