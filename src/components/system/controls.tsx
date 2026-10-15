import { useEffect, useRef, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, CloudOff, Radio, Wifi, WifiOff } from "lucide-react";
import type { DeviceInfo, Parameter } from "../../domain/types";
import { clamp, cn } from "../../lib/utils";
import { Badge, Input, Select, Switch } from "../ui";
import { DeviceFileControl } from "./device-file-control";
import "../../styles/controls.css";

export function ConnectionOrb({ status }: { status: DeviceInfo["status"] | "offline" }) {
  return <span className={cn("connection-orb", `connection-orb--${status}`)}><span /><i /></span>;
}

export function DeviceBadge({ device, compact = false }: { device: DeviceInfo | null; compact?: boolean }) {
  const status = device?.status ?? "offline";
  return <div className={cn("device-badge", compact && "device-badge--compact")}>
    <ConnectionOrb status={status} />
    <div><strong>{device?.name ?? "Connect HeadRush"}</strong><span>{device ? `${device.host} · ${device.latencyMs} ms` : "Ready when you are"}</span></div>
    {!compact && <Badge tone={device ? "green" : "neutral"}>{device ? (device.status === "demo" ? "DEMO" : "LIVE") : "READY"}</Badge>}
  </div>;
}

export function SignalMeter({ value = 0.64, compact = false }: { value?: number; compact?: boolean }) {
  const bars = compact ? 9 : 14;
  return <div className={cn("signal-meter", compact && "signal-meter--compact")} aria-label={`Signal ${Math.round(value * 100)}%`}>
    {Array.from({ length: bars }, (_, index) => <span key={index} className={cn(index / bars < value && "active", index > bars * .76 && "hot", index > bars * .9 && "clip")} />)}
  </div>;
}

export function ValueKnob({ value, min = 0, max = 100, label, unit, onChange, size = 92 }: { value: number; min?: number; max?: number; label: string; unit?: string; onChange: (value: number) => void; size?: number }) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ y: 0, value });
  const ratio = (value - min) / (max - min);
  const angle = -135 + ratio * 270;
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => onChange(clamp(start.current.value + (start.current.y - event.clientY) * (max - min) / 180, min, max));
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [dragging, min, max, onChange]);
  const radius = size * .38; const center = size / 2;
  return <div className="value-knob" style={{ "--knob-size": `${size}px` } as React.CSSProperties}>
    <button className="value-knob__dial" style={{ width: size, height: size }} onPointerDown={(event) => { start.current = { y: event.clientY, value }; setDragging(true); }} onDoubleClick={() => onChange((min + max) / 2)} aria-label={`${label} ${value}${unit ?? ""}`}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={center} cy={center} r={radius} className="knob-track" pathLength="100" />
        <circle cx={center} cy={center} r={radius} className="knob-value" pathLength="100" strokeDasharray={`${ratio * 75} 100`} transform={`rotate(135 ${center} ${center})`} />
      </svg>
      <span className="knob-cap"><i style={{ transform: `rotate(${angle}deg)` }} /></span>
    </button>
    <strong>{Number.isInteger(value) ? value : value.toFixed(1)}<small>{unit}</small></strong><label>{label}</label>
    <input className="value-knob__range" type="range" min={min} max={max} step={Math.max(Number.EPSILON, (max - min) / 200)} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={`${label} slider`} />
  </div>;
}

function AdaptiveChoice({ parameter, onChange }: { parameter: Parameter; onChange: (value: Parameter["value"]) => void }) {
  const choices = parameter.choices ?? [];
  const selectedIndex = choices.indexOf(String(parameter.value));
  const selectRelative = (offset: number) => {
    if (!choices.length) return;
    onChange(choices[selectedIndex < 0 ? (offset > 0 ? 0 : choices.length - 1) : (selectedIndex + offset + choices.length) % choices.length]);
  };

  if (choices.length <= 8) return <div className="parameter-choice parameter-choice--tiles">
    <div className="parameter-choice__heading"><strong>{parameter.label}</strong><span>{choices[selectedIndex] ?? String(parameter.value)}</span></div>
    <div className="parameter-choice__tiles" role="group" aria-label={parameter.label}>{choices.map((choice) => <button key={choice} type="button" className={choice === String(parameter.value) ? "active" : ""} aria-pressed={choice === String(parameter.value)} onClick={() => onChange(choice)}>{choice}</button>)}</div>
  </div>;

  return <div className="parameter-choice parameter-choice--stepper">
    <div className="parameter-choice__heading"><strong>{parameter.label}</strong><span>{selectedIndex + 1} / {choices.length}</span></div>
    <div className="parameter-choice__stepper">
      <button type="button" aria-label={`Previous ${parameter.label}`} onClick={() => selectRelative(-1)}><ChevronLeft size={17}/></button>
      <output aria-live="polite"><strong>{choices[selectedIndex] ?? String(parameter.value)}</strong><small>Use arrows to browse</small></output>
      <button type="button" aria-label={`Next ${parameter.label}`} onClick={() => selectRelative(1)}><ChevronRight size={17}/></button>
    </div>
  </div>;
}

export function ParameterControl({ parameter, onChange, onPreview, compact = false, choiceStyle = "select" }: { parameter: Parameter; onChange: (value: Parameter["value"]) => void; onPreview?: (value: Parameter["value"]) => Promise<void> | void; compact?: boolean; choiceStyle?: "select" | "adaptive" }) {
  if (parameter.writable === false) return <fieldset className="parameter-readonly" disabled aria-label={`${parameter.label} is controlled by the device`}><ParameterControl parameter={{ ...parameter, writable: true }} compact={compact} choiceStyle={choiceStyle} onChange={() => undefined}/></fieldset>;
  if (parameter.deviceFile) return <DeviceFileControl parameter={parameter} compact={compact} onChange={onChange} onPreview={onPreview} />;
  if (parameter.choices && choiceStyle === "adaptive") return <AdaptiveChoice parameter={parameter} onChange={onChange}/>;
  if (parameter.choices) {
    const value = String(parameter.value);
    const choices = [...new Set(parameter.choices)];
    const missing = !choices.includes(value);
    return <label className="parameter-selection">
      <span className="parameter-selection__label">{parameter.label}</span>
      <Select aria-label={parameter.label} value={value} title={value || "Choose an option"} disabled={!choices.length} onChange={(event) => onChange(event.target.value)}>
        {missing && <option value={value} disabled>{value || (choices.length ? "Choose an option" : "No options available")}</option>}
        {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </Select>
    </label>;
  }
  if (compact && typeof parameter.value === "number") {
    const min = parameter.min ?? 0; const max = parameter.max ?? 100; const step = parameter.step ?? Math.max(Number.EPSILON, (max - min) / 200);
    const fill = max === min ? 0 : clamp((parameter.value - min) / (max - min) * 100, 0, 100);
    return <label className="parameter-compact" style={{ "--parameter-fill": `${fill}%` } as React.CSSProperties}><span><strong>{parameter.label}</strong><output>{Number.isInteger(parameter.value) ? parameter.value : parameter.value.toFixed(1)}<small>{parameter.unit}</small></output></span><input aria-label={parameter.label} type="range" min={min} max={max} step={step} value={parameter.value} onChange={(event) => onChange(Number(event.target.value))}/></label>;
  }
  if (typeof parameter.value === "boolean") return <div className="parameter-row"><div><strong>{parameter.label}</strong><span>{parameter.value ? "Enabled" : "Bypassed"}</span></div><Switch label={parameter.label} checked={parameter.value} onCheckedChange={onChange} /></div>;
  if (typeof parameter.value === "number") return <ValueKnob value={parameter.value} min={parameter.min} max={parameter.max} label={parameter.label} unit={parameter.unit} onChange={onChange} />;
  return <label className="parameter-text"><span>{parameter.label}</span><Input value={String(parameter.value)} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function NetworkStatus({ online, label }: { online: boolean; label?: string }) {
  return <div className={cn("network-status", online && "network-status--online")}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{label ?? (online ? "Online" : "Offline")}</span></div>;
}

export function CloudStatus({ online }: { online: boolean }) { return <div className="cloud-status">{online ? <Radio size={15} /> : <CloudOff size={15} />} {online ? "Services available" : "Cloud unavailable"}</div>; }

export function MiniWave({ color = "#6ee7f2" }: { color?: string }) {
  return <svg className="mini-wave" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true"><path d="M0 17 C9 4, 14 30, 23 17 S38 5,47 17 62 29,72 17 86 3,96 17 108 27,120 13" fill="none" stroke={color} strokeWidth="2" /><path d="M0 17 C9 4, 14 30, 23 17 S38 5,47 17 62 29,72 17 86 3,96 17 108 27,120 13 L120 34 L0 34Z" fill={color} opacity=".08" /></svg>;
}

export function CpuIndicator({ value }: { value: number }) { return <span className="cpu-indicator"><Activity size={14} /><span style={{ "--cpu": `${value}%` } as React.CSSProperties}>{value}% CPU</span></span>; }
