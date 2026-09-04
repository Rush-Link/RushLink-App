export interface DrumTransportFrame {
  bar: number;
  beat: number;
  barCount: number;
  beatCount: number;
  source: "device" | "clock";
}

const integer = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export function drumCounts(values: Record<string, unknown>) {
  return {
    barCount: Math.max(1, Math.min(4, integer(values.barCount, 4) || 4)),
    beatCount: Math.max(1, Math.min(6, integer(values.beatCount, 4) || 4)),
  };
}

export function deviceDrumFrame(values: Record<string, unknown>): DrumTransportFrame | null {
  const { barCount, beatCount } = drumCounts(values);
  const beat = integer(values.currentBeat, -1);
  const bar = integer(values.currentBar, -1);
  if (beat < 0 || bar < 0) return null;
  return {
    beat: Math.min(beat, beatCount - 1),
    bar: Math.min(bar, barCount - 1),
    beatCount,
    barCount,
    source: "device",
  };
}

export function advanceDrumFrame(frame: DrumTransportFrame): DrumTransportFrame {
  const nextBeat = frame.beat + 1;
  if (nextBeat < frame.beatCount) return { ...frame, beat: nextBeat, source: "clock" };
  return { ...frame, beat: 0, bar: (frame.bar + 1) % frame.barCount, source: "clock" };
}

export function drumPhraseProgress(frame: DrumTransportFrame | null): number {
  if (!frame) return 0;
  const total = frame.barCount * frame.beatCount;
  return total <= 0 ? 0 : ((frame.bar * frame.beatCount + frame.beat + 1) / total) * 100;
}

export function drumBeatsRemaining(frame: DrumTransportFrame | null): number | null {
  if (!frame) return null;
  return Math.max(0, frame.barCount * frame.beatCount - (frame.bar * frame.beatCount + frame.beat + 1));
}

export function drumBeatDurationMs(bpm: number): number {
  return 60_000 / Math.max(30, Math.min(240, Number.isFinite(bpm) ? bpm : 120));
}
