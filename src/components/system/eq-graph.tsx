import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EQ_GRAPH_BOUNDS,
  equalizerBands,
  equalizerFrequencyForX,
  equalizerGainForY,
  equalizerXForFrequency,
  equalizerYForGain,
  type EqualizerBand,
} from "../../domain/equalizer";
import type { Parameter } from "../../domain/types";
import { cn } from "../../lib/utils";
import "../../styles/block-eq.css";

type EqGraphUpdate = { parameter: Parameter & { value: number }; value: number };
type EqDragState = { kind: "band" | "cutoff"; id: string; pointerId: number; offsetX: number; offsetY: number };

export function EqGraph({ parameters, compact = false, onParameterChange }: { parameters: Parameter[]; compact?: boolean; onParameterChange?: (parameter: Parameter, value: number) => void }) {
  const gradientId = `eq-fill-${useId().replace(/:/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 220 });
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (compact || !svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [compact]);
  // One SVG unit per CSS pixel keeps text and 48px drag targets usable after
  // rotation or opening navigation. Compact previews retain their tiny canvas.
  const canvas = compact ? { width: 800, height: 220 } : size;
  const plot = { left: 46, right: Math.max(47, canvas.width - 20), top: 24, bottom: Math.max(25, canvas.height - 30) };
  const xForFrequency = (hz: number) => plot.left + (equalizerXForFrequency(hz) - EQ_GRAPH_BOUNDS.left) / (EQ_GRAPH_BOUNDS.right - EQ_GRAPH_BOUNDS.left) * (plot.right - plot.left);
  const frequencyForX = (x: number) => equalizerFrequencyForX(EQ_GRAPH_BOUNDS.left + (x - plot.left) / (plot.right - plot.left) * (EQ_GRAPH_BOUNDS.right - EQ_GRAPH_BOUNDS.left));
  const yForGain = (gain: number, range: number) => plot.top + (equalizerYForGain(gain, range) - EQ_GRAPH_BOUNDS.top) / (EQ_GRAPH_BOUNDS.bottom - EQ_GRAPH_BOUNDS.top) * (plot.bottom - plot.top);
  const gainForY = (y: number, range: number) => equalizerGainForY(EQ_GRAPH_BOUNDS.top + (y - plot.top) / (plot.bottom - plot.top) * (EQ_GRAPH_BOUNDS.bottom - EQ_GRAPH_BOUNDS.top), range);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [activeControl, setActiveControl] = useState<string | null>(null);
  const drag = useRef<EqDragState | null>(null);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdates = useRef<EqGraphUpdate[]>([]);
  const lastDragUpdates = useRef<EqGraphUpdate[]>([]);
  const effectiveParameters = useMemo(() => parameters.map((parameter) => typeof draft[parameter.id] === "number" ? { ...parameter, value: draft[parameter.id] } : parameter), [parameters, draft]);
  const bands = equalizerBands(effectiveParameters);
  const numericById = (id: string) => effectiveParameters.find((parameter): parameter is Parameter & { value: number } => parameter.id === id && typeof parameter.value === "number");
  const highPassParameter = numericById("SltEQHP"); const lowPassParameter = numericById("SltEQLP");
  const highPass = highPassParameter?.value ?? 20; const lowPass = lowPassParameter?.value ?? 20000;
  const enabled = effectiveParameters.find((parameter) => parameter.id === "SltEQOn" || parameter.id === "On")?.value !== false;
  const dbRange = Math.max(18, Math.min(30, ...bands.flatMap((band) => [Math.abs(band.gainParameter.min ?? 0), Math.abs(band.gainParameter.max ?? 0)])));
  const snap = (value: number, parameter: Parameter & { value: number }) => {
    const minimum = parameter.min ?? value; const maximum = parameter.max ?? value; const step = parameter.step ?? (parameter.unit === "Hz" ? 1 : .1);
    return Math.max(minimum, Math.min(maximum, Math.round(value / step) * step));
  };
  const pointFor = (event: React.PointerEvent<SVGElement>) => {
    const svg = event.currentTarget.ownerSVGElement; if (!svg) return null;
    const bounds = svg.getBoundingClientRect(); if (!bounds.width || !bounds.height) return null;
    return { x: (event.clientX - bounds.left) / bounds.width * canvas.width, y: (event.clientY - bounds.top) / bounds.height * canvas.height };
  };
  const applyDraft = (updates: EqGraphUpdate[]) => setDraft((current) => Object.fromEntries([...Object.entries(current), ...updates.map(({ parameter, value }) => [parameter.id, value])]));
  const publish = (updates: EqGraphUpdate[], final = false) => {
    pendingUpdates.current = updates;
    if (final) {
      if (publishTimer.current) clearTimeout(publishTimer.current);
      publishTimer.current = null; pendingUpdates.current = [];
      updates.forEach(({ parameter, value }) => onParameterChange?.(parameter, value));
      return;
    }
    if (publishTimer.current) return;
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null; const queued = pendingUpdates.current; pendingUpdates.current = [];
      queued.forEach(({ parameter, value }) => onParameterChange?.(parameter, value));
    }, 120);
  };
  const beginBand = (event: React.PointerEvent<SVGCircleElement>, band: EqualizerBand) => {
    if (!onParameterChange) return;
    const point = pointFor(event); if (!point) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "band", id: band.id, pointerId: event.pointerId, offsetX: point.x - xForFrequency(band.frequency), offsetY: point.y - yForGain(band.gain, dbRange) };
    setActiveControl(band.id);
  };
  const moveBand = (event: React.PointerEvent<SVGCircleElement>, band: EqualizerBand, final = false) => {
    const state = drag.current; if (!state || state.kind !== "band" || state.id !== band.id || state.pointerId !== event.pointerId) return;
    const point = pointFor(event); if (!point) return;
    const updates: EqGraphUpdate[] = [];
    if (band.frequencyParameter) updates.push({ parameter: band.frequencyParameter, value: snap(frequencyForX(point.x - state.offsetX), band.frequencyParameter) });
    updates.push({ parameter: band.gainParameter, value: snap(gainForY(point.y - state.offsetY, dbRange), band.gainParameter) });
    lastDragUpdates.current = updates; applyDraft(updates); publish(updates, final);
  };
  const endBand = (event: React.PointerEvent<SVGCircleElement>, band: EqualizerBand) => {
    moveBand(event, band, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null; lastDragUpdates.current = []; setActiveControl(null);
  };
  const beginCutoff = (event: React.PointerEvent<SVGRectElement>, parameter: Parameter & { value: number }) => {
    if (!onParameterChange) return;
    const point = pointFor(event); if (!point) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "cutoff", id: parameter.id, pointerId: event.pointerId, offsetX: point.x - xForFrequency(parameter.value), offsetY: 0 };
    setActiveControl(parameter.id);
  };
  const moveCutoff = (event: React.PointerEvent<SVGRectElement>, parameter: Parameter & { value: number }, final = false) => {
    const state = drag.current; if (!state || state.kind !== "cutoff" || state.id !== parameter.id || state.pointerId !== event.pointerId) return;
    const point = pointFor(event); if (!point) return;
    let frequency = snap(frequencyForX(point.x - state.offsetX), parameter);
    if (parameter.id === "SltEQHP") frequency = Math.min(frequency, lowPass);
    if (parameter.id === "SltEQLP") frequency = Math.max(frequency, highPass);
    const updates = [{ parameter, value: frequency }]; lastDragUpdates.current = updates; applyDraft(updates); publish(updates, final);
  };
  const endCutoff = (event: React.PointerEvent<SVGRectElement>, parameter: Parameter & { value: number }) => {
    moveCutoff(event, parameter, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null; lastDragUpdates.current = []; setActiveControl(null);
  };
  const cancelDrag = (event: React.PointerEvent<SVGElement>) => {
    if (lastDragUpdates.current.length) publish(lastDragUpdates.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null; lastDragUpdates.current = []; setActiveControl(null);
  };
  const nudgeBand = (event: React.KeyboardEvent<SVGGElement>, band: EqualizerBand) => {
    const updates: EqGraphUpdate[] = [];
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && band.frequencyParameter) {
      const factor = Math.pow(2, (event.key === "ArrowRight" ? 1 : -1) / 12);
      updates.push({ parameter: band.frequencyParameter, value: snap(band.frequency * factor, band.frequencyParameter) });
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") updates.push({ parameter: band.gainParameter, value: snap(band.gain + (event.key === "ArrowUp" ? 1 : -1) * (band.gainParameter.step ?? .1), band.gainParameter) });
    if (!updates.length) return; event.preventDefault(); applyDraft(updates); publish(updates, true);
  };
  useEffect(() => { if (!drag.current) setDraft({}); }, [parameters]);
  useEffect(() => () => { if (publishTimer.current) clearTimeout(publishTimer.current); }, []);

  const points = Array.from({ length: 121 }, (_, index) => {
    const hz = 20 * Math.pow(1000, index / 120);
    const bandGain = bands.reduce((sum, band) => { const octaves = Math.log2(hz / band.frequency); return sum + band.gain * Math.exp(-.5 * Math.pow(octaves * band.q * 1.35, 2)); }, 0);
    const filterGain = hz < highPass ? -12 * Math.log2(highPass / hz) : hz > lowPass ? -12 * Math.log2(hz / lowPass) : 0;
    return `${plot.left + index * (plot.right - plot.left) / 120},${yForGain(bandGain + filterGain, dbRange)}`;
  }).join(" ");
  const activeBand = bands.find((band) => band.id === activeControl);
  const activeCutoff = activeControl === highPassParameter?.id ? highPassParameter : activeControl === lowPassParameter?.id ? lowPassParameter : undefined;

  return <div className={cn("graphic-eq", compact && "graphic-eq--compact", !enabled && "graphic-eq--disabled", onParameterChange && bands.length && "graphic-eq--editable", activeControl && "graphic-eq--dragging")}>
    {!compact && <div className="eq-graph-status"><span><i /> DRAG A NODE</span><strong>{activeBand ? `${Math.round(activeBand.frequency)} Hz · ${activeBand.gain >= 0 ? "+" : ""}${activeBand.gain.toFixed(1)} dB · Q ${activeBand.q.toFixed(1)}` : activeCutoff ? `${activeCutoff.label} · ${Math.round(activeCutoff.value)} Hz` : `${bands.length} band${bands.length === 1 ? "" : "s"} · HP ${Math.round(highPass)} Hz · LP ${Math.round(lowPass)} Hz`}</strong></div>}
    <svg ref={svgRef} viewBox={`0 0 ${canvas.width} ${canvas.height}`} preserveAspectRatio="none" aria-label="Interactive block equalizer">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#55e3ec" stopOpacity=".28"/><stop offset=".55" stopColor="#6489ed" stopOpacity=".1"/><stop offset="1" stopColor="#9a6ff2" stopOpacity=".015"/></linearGradient><filter id={`${gradientId}-glow`}><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <rect className="eq-plot-bg" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top}/>
      {[50, 200, 500, 2000, 5000].map((hz) => <line className="eq-grid-minor" key={hz} x1={xForFrequency(hz)} x2={xForFrequency(hz)} y1={plot.top} y2={plot.bottom}/>)}
      {[20, 100, 1000, 10000, 20000].map((hz) => <line className="eq-grid-major" key={hz} x1={xForFrequency(hz)} x2={xForFrequency(hz)} y1={plot.top} y2={plot.bottom}/>)}
      {[-dbRange, -dbRange / 2, 0, dbRange / 2, dbRange].map((gain) => { const y = yForGain(gain, dbRange); return <g key={gain}><line className={gain === 0 ? "eq-zero-line" : "eq-grid-major"} x1={plot.left} x2={plot.right} y1={y} y2={y}/>{!compact && <text className="eq-db-label" x="39" y={y + 3} textAnchor="end">{gain > 0 ? "+" : ""}{gain}</text>}</g>; })}
      <rect className="eq-filter-shade" x={plot.left} y={plot.top} width={Math.max(0, xForFrequency(highPass) - plot.left)} height={plot.bottom - plot.top}/>
      <rect className="eq-filter-shade" x={xForFrequency(lowPass)} y={plot.top} width={Math.max(0, plot.right - xForFrequency(lowPass))} height={plot.bottom - plot.top}/>
      <polygon className="eq-curve-fill" points={`${plot.left},${plot.bottom} ${points} ${plot.right},${plot.bottom}`} fill={`url(#${gradientId})`}/>
      <polyline className="eq-curve-glow" points={points}/><polyline className="eq-curve" points={points}/>
      {[highPassParameter, lowPassParameter].filter((parameter): parameter is Parameter & { value: number } => Boolean(parameter)).map((parameter) => { const x = xForFrequency(parameter.value); const label = parameter.id === "SltEQHP" ? "HP" : "LP"; return <g className={cn("eq-cutoff", activeControl === parameter.id && "active")} key={parameter.id}><line x1={x} x2={x} y1={plot.top} y2={plot.bottom}/><path d={`M${x - 7} ${plot.top + 2} H${x + 7} L${x} ${plot.top + 11} Z`}/><text x={x} y={plot.top + 24} textAnchor="middle">{label}</text>{onParameterChange && <rect className="eq-cutoff-hit" x={x - 22} y={plot.top} width="44" height={plot.bottom - plot.top} onPointerDown={(event) => beginCutoff(event, parameter)} onPointerMove={(event) => moveCutoff(event, parameter)} onPointerUp={(event) => endCutoff(event, parameter)} onPointerCancel={cancelDrag}/>}</g>; })}
      {bands.map((band, index) => { const x = xForFrequency(band.frequency); const y = yForGain(band.gain, dbRange); return <g key={band.id} className={cn("eq-band-handle", !band.frequencyParameter && "eq-band-handle--fixed", activeControl === band.id && "active")} role="slider" tabIndex={onParameterChange ? 0 : -1} aria-label={`${band.label}, ${Math.round(band.frequency)} hertz, ${band.gain.toFixed(1)} decibels`} onKeyDown={(event) => nudgeBand(event, band)}><circle className="eq-band-halo" cx={x} cy={y} r={compact ? 10 : 14}/><circle className="eq-band-dot" cx={x} cy={y} r={compact ? 7 : 10}/><text className="eq-band-index" x={x} y={y + 3} textAnchor="middle">{index + 1}</text>{onParameterChange && <circle className="eq-band-hit" cx={x} cy={y} r="24" onPointerDown={(event) => beginBand(event, band)} onPointerMove={(event) => moveBand(event, band)} onPointerUp={(event) => endBand(event, band)} onPointerCancel={cancelDrag}/>}<title>{`${band.label}: ${Math.round(band.frequency)} Hz · ${band.gain.toFixed(1)} dB · Q ${band.q.toFixed(1)}`}</title></g>; })}
    </svg>
    <div className="eq-axis">{[{ hz: 20, label: "20 Hz" }, { hz: 100, label: "100" }, { hz: 1000, label: "1k" }, ...(canvas.width >= 420 ? [{ hz: 10000, label: "10k" }] : []), { hz: 20000, label: "20 kHz" }].map(({ hz, label }) => <span key={hz} style={{ left: `${xForFrequency(hz) / canvas.width * 100}%`, transform: hz === 20000 ? "translateX(-100%)" : "translateX(-50%)" }}>{label}</span>)}</div>{!bands.length && <p>This block does not expose its slot EQ controls.</p>}
  </div>;
}
