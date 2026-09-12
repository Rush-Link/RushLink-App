import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cable, Copy, Disc3, Drum,
  FastForward, Flag, Gauge, Grip, Layers3, Link2, Lock, Maximize2, Minimize2,
  Move, MoveVertical, Music2, Pause, Play, Plus, RadioTower, Repeat2, Rewind,
  RotateCcw, Route, Save, Search, Settings2, SkipBack, SkipForward, Sparkles, Square,
  Star, Timer, Trash2, Unlock, VolumeX, Waves, Zap,
} from "lucide-react";
import { actionPalette, type LiveButtonTemplate } from "../data/demo-data";
import { adjacentLiveIndex, canPlaceLiveFootprint, DEFAULT_LIVE_STAGE_SPACING, LIVE_DECK_ACTIONS, LIVE_DECK_DEFAULTS, LIVE_DECK_LAYOUTS, LIVE_SWITCH_LABELS, liveDeckDimensions, liveDeckFootprintChoices, liveDeckFootprintDimensions, liveFootprintIndexes, liveIndexToCell, normalizeLiveDeckActions, normalizeLiveDeckFootprint, normalizeLiveDimensions, normalizeLiveMidiCommand, normalizeLiveStageSpacing } from "../domain/live-layout";
import type { HeadRushPropertyMeta, LiveActionBinding, LiveActionType, LiveButton, LiveDeckFootprint, LiveGesture, LiveStageSpacing, Rig } from "../domain/types";
import { FLEX_PRIME_MIDI_REFERENCE, flexPrimeMidiCommand } from "../domain/headrush-midi";
import { denormalizeValue } from "../domain/headrush-reflection";
import { canonicalLiveSwitchType, liveActionAllowedForGesture, resolveLiveButtonGesture } from "../domain/stage-gestures";
import { findStageMidiMatch, type StageMidiMessage } from "../domain/stage-midi";
import { deviceApi } from "../services/device-api";
import { midiConnection, useMidiConnection } from "../services/midi-connection";
import { useAppStore } from "../stores/app-store";
import { Badge, Button, Card, Dialog, IconButton, Input, Label, Select } from "../components/ui";
import { WorkspacePanelToggle } from "../components/system/workspace-panel-toggle";
import { useStageFullscreen } from "../hooks/use-stage-fullscreen";
import { useWorkspacePanel } from "../hooks/use-workspace-panel";
import { cn } from "../lib/utils";
import "../styles/live-tone.css";
import "../styles/stagehand-v2.css";

const icons: Record<string, React.ElementType> = {
  "skip-back": SkipBack, "skip-forward": SkipForward, timer: Timer, gauge: Gauge,
  layers: Layers3, zap: Zap, waves: Waves, sparkles: Sparkles, repeat: Repeat2,
  disc: Disc3, drum: Drum, activity: Activity, route: Route, flag: Flag, music: Music2,
  "volume-x": VolumeX, "rotate-ccw": RotateCcw, "move-vertical": MoveVertical,
  terminal: Settings2, star: Star,
};

const ACTION_LABELS: Record<LiveActionType, string> = {
  "rig-prev": "Previous rig", "rig-next": "Next rig", scene: "Scene", "block-toggle": "Effect block",
  tuner: "Tuner", "tap-tempo": "Tap tempo", looper: "Looper remote", drums: "Drums", practice: "Practice Tool remote",
  expression: "Expression A/B", snapshot: "App snapshot", custom: "Custom / reserved",
};
const unavailableRig: Rig = {
  id: "", name: "Connect to your HeadRush", author: "RushLink", color: "#64748b",
  tags: [], tempo: 0, favorite: false, modified: "", blocks: [],
};
export type PaletteItem = Omit<LiveButton, "id"> & { group: string; styleColor?: string; presetId?: string; presetName?: string };

export const PALETTE_CATEGORIES = [
  { id: "Favourites", label: "Favourites", description: "Your quickest reusable controls", accent: "#f1c75b", icon: "star" },
  { id: "My controls", label: "My controls", description: "Controls saved from the editor", accent: "#ed78bd", icon: "sparkles" },
  { id: "Rig", label: "Rig navigation", description: "Previous and next rig", accent: "#58dbe7", icon: "route" },
  { id: "Rig blocks", label: "Rig effects", description: "Blocks from the attached rig", accent: "#f0a25e", icon: "zap" },
  { id: "Scenes", label: "Scenes", description: "Visual scene recalls A–F", accent: "#9b7bf3", icon: "layers" },
  { id: "Tuner", label: "Tuner & tempo", description: "Tuning, mute and tap tempo", accent: "#eb6f91", icon: "gauge" },
  { id: "Drums", label: "Drum machine", description: "Transport, song parts and decks", accent: "#579cf2", icon: "drum" },
] as const;

type PaletteCategoryId = typeof PALETTE_CATEGORIES[number]["id"];

export function stagehandPaletteCategory(item: PaletteItem): PaletteCategoryId {
  if (item.group === "My controls" || item.multiFunction) return "My controls";
  if (item.group === "Rig") return "Rig";
  if (item.group === "Rig blocks") return "Rig blocks";
  if (item.group === "Scenes") return "Scenes";
  if (item.action === "tuner" || item.action === "tap-tempo") return "Tuner";
  if (item.action === "drums") return "Drums";
  return "My controls";
}

export function stagehandPaletteAccent(item: PaletteItem) {
  return PALETTE_CATEGORIES.find((category) => category.id === stagehandPaletteCategory(item))?.accent ?? "#58dbe7";
}

export function stagehandPaletteItemKey(item: PaletteItem) {
  return item.presetId ? `preset:${item.presetId}` : [item.group, item.action, item.target ?? "", item.widget ?? "", item.widgetLayout ?? "", item.label].join(":");
}

export function filterStagehandPalette(items: PaletteItem[], category: PaletteCategoryId, favouriteKeys: string[]): PaletteItem[] {
  if (category === "Favourites") {
    const favourites = new Set(favouriteKeys);
    return items.filter((item) => favourites.has(stagehandPaletteItemKey(item)));
  }
  return items.filter((item) => stagehandPaletteCategory(item) === category);
}

function blockTone(category: string) {
  if (["drive", "overdrive", "eq"].includes(category)) return "amber";
  if (["delay", "chorus", "modulation", "phaser"].includes(category)) return "mint";
  if (["reverb", "pitch", "ir", "cab"].includes(category)) return "violet";
  if (["amp", "distortion", "clone"].includes(category)) return "rose";
  return "cyan";
}

function blockIcon(category: string) {
  if (["delay"].includes(category)) return "timer";
  if (["reverb"].includes(category)) return "sparkles";
  if (["chorus", "modulation", "phaser", "flanger", "rotary"].includes(category)) return "waves";
  if (["pitch", "synth", "filter"].includes(category)) return "music";
  if (["eq", "dynamics", "compressor"].includes(category)) return "move-vertical";
  if (["amp", "clone", "capture"].includes(category)) return "activity";
  if (["cab", "ir"].includes(category)) return "disc";
  if (["looper"].includes(category)) return "repeat";
  return "zap";
}

function blockPalette(rig: Rig): PaletteItem[] {
  return rig.blocks.filter((block) => !block.empty && !["input", "output"].includes(block.category)).map((block, index) => ({
    group: "Rig blocks", label: block.name.toUpperCase(), subtitle: block.model, action: "block-toggle",
    target: block.id, switchType: "toggle", color: blockTone(block.category), styleColor: block.color,
    icon: blockIcon(block.category),
    active: block.enabled, midi: flexPrimeMidiCommand("block-toggle", undefined, block.slot ?? index),
  }));
}

function activeFromDevice(button: LiveButton, rig: Rig, currentScene: number | undefined, tree: ReturnType<typeof useAppStore.getState>["liveSubtree"]) {
  if (button.action === "block-toggle") return rig.blocks.find((block) => block.id === button.target)?.enabled ?? button.active;
  if (button.action === "scene") return button.target === "ABCDEF"[Math.max(0, (currentScene ?? 1) - 1)];
  if (button.action === "tuner" && button.target === "mute") return tree?.["/Evil/Engine/AudioCtrl/Tuner"]?.value?.TunerMuting === true;
  if (button.action === "tuner") return tree?.["/Evil/Engine/AudioCtrl/Input"]?.value?.TunerOn === true;
  if (button.action === "drums" && button.target === "toggle") return tree?.["/Evil/Engine/DrumsCtrl"]?.value?.isPlaying === true || tree?.["/Evil/Engine/DrumsCtrl"]?.value?.isPlaying === 1;
  if (button.action === "drums" && button.target === "mute") return tree?.["/Evil/Engine/DrumsCtrl"]?.value?.isMuted === true || tree?.["/Evil/Engine/DrumsCtrl"]?.value?.isMuted === 1;
  return button.active;
}

interface StageWidgetData {
  tuner: { open: boolean; note: string; cents: number; reference: number };
  drums: { playing: boolean; muted: boolean; kit: string; part: string; bar: number; beat: number };
}

interface LivePadProps {
  button: LiveButton | null; index: number; editable: boolean; selected: boolean; moving: boolean; active?: boolean; disabled?: boolean; spanRows: number; spanColumns: number; gridStyle: React.CSSProperties;
  dragging: boolean; dragOver: boolean; widgetData: StageWidgetData;
  tunerCentsMeta?: HeadRushPropertyMeta; tunerDeviceId?: string;
  onSelect: () => void; onTrigger: (gesture?: LiveGesture) => void; onWidgetAction: (target: string, gesture?: LiveGesture) => void;
  onDragBegin: (index: number) => void; onDragHover: (index: number) => void; onDragFinish: (from: number, to: number) => void; onDragCancel: () => void;
}

function tunerData(values: Record<string, unknown>, fallback: StageWidgetData["tuner"], centsMeta?: HeadRushPropertyMeta): StageWidgetData["tuner"] {
  const note = String(values.TunerString ?? fallback.note).trim();
  const hasCents = values.TunerCents !== undefined && values.TunerCents !== null;
  const rawCents = Number(values.TunerCents);
  return {
    ...fallback,
    note,
    cents: note ? hasCents ? Math.round(centsMeta ? denormalizeValue(rawCents, centsMeta) : rawCents) : fallback.cents : 0,
    reference: Number(values.TunerRef ?? fallback.reference),
  };
}

export function StageTunerWidget({ tuner, centsMeta, deviceId }: { tuner: StageWidgetData["tuner"]; centsMeta?: HeadRushPropertyMeta; deviceId?: string }) {
  const [readout, setReadout] = useState(tuner);
  useEffect(() => { setReadout(tuner); }, [tuner.open, tuner.note, tuner.cents, tuner.reference]);
  useEffect(() => {
    if (!tuner.open || !deviceApi.isNative()) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      if (!stopped && document.visibilityState !== "hidden") {
        try {
          const values = await deviceApi.tunerValues();
          if (!stopped) setReadout((current) => tunerData(values, current, centsMeta));
        } catch { /* The normal page synchronizer will recover the readout. */ }
      }
      if (!stopped) timer = window.setTimeout(poll, 180);
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [tuner.open, centsMeta, deviceId]);
  return <div className="stage-widget stage-widget--tuner"><span><Gauge size={18}/><b>LIVE TUNER</b><em>{readout.reference} Hz</em></span><strong>{readout.open ? readout.note || "—" : "OFF"}</strong><div className={cn("stage-tuner-meter", !readout.open && "inactive")}><i style={{ left: `${Math.max(4, Math.min(96, 50 + readout.cents))}%` }}/></div><small>{!readout.open ? "Tap to start · hold to mute" : readout.note ? `${readout.cents > 0 ? "+" : ""}${readout.cents} cents` : "Play a string · hold to mute"}</small><em className={cn("stage-tuner-source", readout.open && "live")}>{readout.open ? "DEVICE FFT · LIVE" : "DEVICE TUNER · STANDBY"}</em></div>;
}

const DECK_ACTION_META: Record<"drums", Record<string, { label: string; icon: React.ElementType }>> = {
  drums: {
    toggle: { label: "PLAY", icon: Play }, fill: { label: "FILL", icon: Waves }, bridge: { label: "BRIDGE", icon: Route },
    outro: { label: "OUTRO", icon: Flag }, mute: { label: "MUTE", icon: VolumeX }, accent: { label: "ACCENT", icon: Activity },
  },
};

const COMPACT_DECK_LABELS: Record<string, string> = {
  record: "REC", toggle: "PLAY", insert: "INS", peel: "PEEL", mute: "MUTE", reverse: "REV",
  fill: "FILL", bridge: "BRG", outro: "OUT", accent: "ACC",
};

export function MultiButtonDeck({ button, editable, widgetData, onWidgetAction, spanRows, spanColumns }: Pick<LivePadProps, "button" | "editable" | "widgetData" | "onWidgetAction"> & { button: LiveButton; spanRows?: number; spanColumns?: number }) {
  const [feedbackIndex, setFeedbackIndex] = useState<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const kind = "drums" as const;
  const layout = button.widgetLayout ?? "2x2";
  const dimensions = liveDeckDimensions(layout);
  const preferredFootprint = liveDeckFootprintDimensions(normalizeLiveDeckFootprint(layout, button.widgetSize ?? layout));
  const renderedRows = spanRows ?? preferredFootprint.rows;
  const renderedColumns = spanColumns ?? preferredFootprint.columns;
  const actions = normalizeLiveDeckActions(kind, layout, button.widgetActions);
  const deckStatus = widgetData.drums.part || `${Math.max(0, widgetData.drums.bar)}:${Math.max(0, widgetData.drums.beat)}`;
  const title = widgetData.drums.kit || "DRUMS";
  useEffect(() => () => { if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current); }, []);
  const flash = (index: number) => { if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current); setFeedbackIndex(index); feedbackTimer.current = window.setTimeout(() => setFeedbackIndex(null), 180); };
  return <div className={cn("stage-widget", "stage-widget--multi", `stage-widget--${kind}`, `stage-widget--layout-${layout}`, `stage-widget--footprint-${renderedRows}x${renderedColumns}`)}>
    <header><span><Drum size={17}/><b>{title}</b></span><em title={`${layout.replace("x", "×")} · ${deckStatus}`}>{layout.replace("x", "×")} · {deckStatus}</em></header>
    <div className="stage-widget-deck-grid" style={{ gridTemplateColumns: `repeat(${dimensions.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${dimensions.rows}, minmax(0, 1fr))` }}>
      {actions.map((target, index) => {
        const meta = DECK_ACTION_META[kind][target] ?? { label: target.toUpperCase(), icon: Zap };
        const Icon = meta.icon;
        const command = flexPrimeMidiCommand(kind, target);
        const isAccent = target === "accent";
        const isActive = target === "toggle" ? widgetData.drums.playing : target === "mute" ? widgetData.drums.muted : false;
        const displayLabel = renderedRows === 1 && renderedColumns === 1 ? COMPACT_DECK_LABELS[target] ?? meta.label : meta.label;
        return <button key={`${index}-${target}`} type="button" aria-label={`${meta.label} · ${kind} · CC ${command.number}`} className={cn(`action-${target}`, isActive && "active", target === "record" && "record", feedbackIndex === index && "triggered")} onClick={isAccent ? undefined : (event) => { event.stopPropagation(); flash(index); onWidgetAction(target); }} onPointerDown={isAccent ? (event) => { event.stopPropagation(); flash(index); onWidgetAction(target, "press"); } : (event) => event.stopPropagation()} onPointerUp={isAccent ? (event) => { event.stopPropagation(); onWidgetAction(target, "release"); } : (event) => event.stopPropagation()}>
          {target === "toggle" && isActive ? <Pause size={14}/> : <Icon size={13}/>}<span>{target === "toggle" && isActive ? "STOP" : displayLabel}</span><i>CC {command.number}</i>
        </button>;
      })}
    </div>
  </div>;
}

export function LivePad({ button, index, editable, selected, moving, active, disabled, spanRows, spanColumns, gridStyle, dragging, dragOver, widgetData, tunerCentsMeta, tunerDeviceId, onSelect, onTrigger, onWidgetAction, onDragBegin, onDragHover, onDragFinish, onDragCancel }: LivePadProps) {
  const [pressed, setPressed] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const holdFired = useRef(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const dragActive = useRef(false);
  const suppressClick = useRef(false);
  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); if (tapTimer.current) window.clearTimeout(tapTimer.current); }, []);
  const editPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!editable || !button || event.button !== 0) return;
    dragOrigin.current = { x: event.clientX, y: event.clientY }; dragActive.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const editPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!editable || !button || !dragOrigin.current) return;
    const distance = Math.hypot(event.clientX - dragOrigin.current.x, event.clientY - dragOrigin.current.y);
    if (!dragActive.current && distance >= 7) { dragActive.current = true; onDragBegin(index); }
    if (!dragActive.current) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-live-index]");
    const targetIndex = Number(target?.dataset.liveIndex);
    if (Number.isInteger(targetIndex)) onDragHover(targetIndex);
  };
  const editPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!editable || !dragOrigin.current) return;
    if (dragActive.current) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-live-index]");
      const targetIndex = Number(target?.dataset.liveIndex);
      suppressClick.current = true; onDragFinish(index, Number.isInteger(targetIndex) ? targetIndex : index);
    }
    dragOrigin.current = null; dragActive.current = false;
  };
  const editPointerCancel = () => { dragOrigin.current = null; dragActive.current = false; onDragCancel(); };
  const select = () => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(); };
  if (!button) return <button style={gridStyle} data-live-index={index} data-context-kind="stage-slot" disabled={disabled} className={cn("live-pad live-pad--empty", dragOver && "drag-over", moving && "move-target")} onClick={onSelect}><Plus size={20}/><span>{moving || dragOver ? "Drop here" : "Add control"}</span><em>{index + 1}</em></button>;
  const Icon = icons[button.icon] ?? Zap;
  const switchType = button.switchType ?? "trigger";
  const padSubtitle = button.multiFunction ? `T ${button.tapBinding?.label ?? "—"} · H ${button.holdBinding?.label ?? "—"} · 2× ${button.doubleBinding?.label ?? "—"}` : button.subtitle;
  const clearHold = () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; };
  const pointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (editable || disabled) return;
    event.currentTarget.setPointerCapture?.(event.pointerId); setPressed(true); holdFired.current = false;
    if (switchType === "momentary") onTrigger("press");
    if (switchType === "hold" || switchType === "multi") holdTimer.current = window.setTimeout(() => { holdFired.current = true; onTrigger("hold"); }, button.holdMs ?? 650);
  };
  const pointerUp = () => {
    if (editable || disabled) return;
    setPressed(false); clearHold();
    if (switchType === "momentary") { onTrigger("release"); return; }
    if (switchType === "hold" || holdFired.current) return;
    if (switchType === "multi") {
      if (tapTimer.current) { window.clearTimeout(tapTimer.current); tapTimer.current = null; onTrigger("double"); }
      else tapTimer.current = window.setTimeout(() => { tapTimer.current = null; onTrigger("release"); }, 260);
    }
  };
  const keyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (editable || disabled || !["Enter", " "].includes(event.key) || event.repeat) return;
    if (switchType === "trigger" || switchType === "toggle") return;
    event.preventDefault();
    if (switchType === "momentary") { onTrigger("press"); window.setTimeout(() => onTrigger("release"), 80); return; }
    onTrigger(switchType === "hold" ? "hold" : "release");
  };
  const sharedClass = cn("live-pad", `live-pad--${button.color}`, active && "active", selected && "selected", dragOver && "drag-over", dragging && "dragging", moving && "move-target", pressed && "pressed", disabled && "unavailable", spanColumns > 1 && "live-pad--wide", spanRows > 1 && "live-pad--tall", button.widget && "live-pad--widget", button.widget === "drums" && "live-pad--multibutton");
  const padStyle = button.accentColor ? { ...gridStyle, "--pad-color": button.accentColor } as React.CSSProperties : gridStyle;
  if (button.widget) {
    const tunerControl = button.widget === "tuner";
    return <div style={padStyle} role="group" tabIndex={0} aria-label={tunerControl ? `${button.label} · tap tuner · hold mute` : button.label} data-live-index={index} data-context-kind="stage-control" data-button-id={button.id} className={sharedClass} onClick={() => editable && select()}
      onPointerDown={(event) => { editPointerDown(event); if (tunerControl) pointerDown(event); }} onPointerMove={editPointerMove}
      onPointerUp={(event) => { editPointerUp(event); if (tunerControl) pointerUp(); }}
      onPointerCancel={() => { editPointerCancel(); if (tunerControl) { setPressed(false); clearHold(); } }}
      onKeyDown={tunerControl ? keyboard : undefined}>
    {editable && <Grip className="live-pad__grip" size={15}/>}<span className="live-pad__slot">{index + 1} · {spanRows}×{spanColumns}</span><span className="live-pad__state"><i/></span>
    {button.widget === "tuner" && <StageTunerWidget tuner={widgetData.tuner} centsMeta={tunerCentsMeta} deviceId={tunerDeviceId}/>}
    {button.widget === "drums" && <MultiButtonDeck button={button} editable={editable} widgetData={widgetData} onWidgetAction={onWidgetAction} spanRows={spanRows} spanColumns={spanColumns}/>} 
    </div>;
  }
  return <button style={padStyle} data-live-index={index} data-context-kind="stage-control" data-button-id={button.id} className={sharedClass} aria-pressed={switchType === "toggle" ? Boolean(active) : undefined} disabled={disabled}
    onClick={() => editable ? select() : (!["momentary", "hold", "multi"].includes(switchType) && onTrigger("release"))}
    onPointerDown={(event) => { editPointerDown(event); pointerDown(event); }} onPointerMove={editPointerMove} onPointerUp={(event) => { editPointerUp(event); pointerUp(); }} onPointerCancel={() => { editPointerCancel(); setPressed(false); clearHold(); if (switchType === "momentary") onTrigger("release"); }} onKeyDown={keyboard}>
    {editable && <Grip className="live-pad__grip" size={15}/>}<span className="live-pad__slot">{index + 1}</span><span className="live-pad__state"><i/></span><Icon className="live-pad__icon" size={24}/><strong>{button.label}</strong><small>{padSubtitle}</small><span className="live-pad__meta"><b>{LIVE_SWITCH_LABELS[switchType]}</b><i>{button.midi.type.toUpperCase()} {button.midi.number}</i></span>
  </button>;
}

function bindingTargets(action: LiveActionType, rig: Rig): Array<{ value: string; label: string }> {
  if (action === "scene") return "ABCDEF".split("").map((scene) => ({ value: scene, label: `Scene ${scene}` }));
  if (action === "block-toggle") return rig.blocks.filter((block) => !block.empty && !["input", "output"].includes(block.category)).map((block) => ({ value: block.id, label: `Slot ${block.slot + 1} · ${block.name}` }));
  if (action === "tuner") return [{ value: "", label: "Open / close tuner" }, { value: "mute", label: "Mute / unmute output" }];
  if (action === "drums") return [["toggle", "Play / stop"], ["fill", "Fill"], ["bridge", "Bridge"], ["outro", "Outro"], ["mute", "Mute"]].map(([value, label]) => ({ value, label }));
  return [];
}

function defaultBindingTarget(action: LiveActionType, rig: Rig) {
  if (action === "scene") return "A";
  if (action === "block-toggle") return rig.blocks.find((block) => !block.empty && !["input", "output"].includes(block.category))?.id;
  if (action === "drums") return "toggle";
  return undefined;
}

function GestureBinding({ title, hint, gesture, value, rig, onChange }: { title: string; hint: string; gesture: LiveGesture; value?: LiveActionBinding; rig: Rig; onChange: (binding?: LiveActionBinding) => void }) {
  const targets = value ? bindingTargets(value.action, rig) : [];
  return <div className={cn("stagehand-gesture-binding", value && "assigned")}><header><b>{title}</b><span>{hint}</span><i>{value ? "ASSIGNED" : "EMPTY"}</i></header><Select aria-label={`${title} action`} value={value?.action ?? ""} onChange={(event) => { const action = event.target.value as LiveActionType; if (!action) { onChange(undefined); return; } const target = defaultBindingTarget(action, rig); onChange({ action, target, label: ACTION_LABELS[action] }); }}><option value="">No action</option>{Object.entries(ACTION_LABELS).filter(([action]) => !["snapshot", "looper", "practice", "expression", "custom"].includes(action) && liveActionAllowedForGesture(action as LiveActionType, gesture)).map(([action, label]) => <option key={action} value={action}>{label}</option>)}</Select>{value && targets.length > 0 && <Select aria-label={`${title} target`} value={value.target ?? ""} onChange={(event) => { const target = event.target.value || undefined; const targetLabel = targets.find((item) => item.value === event.target.value)?.label; onChange({ ...value, target, label: targetLabel ? `${ACTION_LABELS[value.action]} · ${targetLabel}` : ACTION_LABELS[value.action] }); }}>{targets.map((target) => <option key={`${value.action}-${target.value}`} value={target.value}>{target.label}</option>)}</Select>}</div>;
}

function StageSpacingSlider({ label, value, maximum, onChange }: { label: string; value: number; maximum: number; onChange: (value: number) => void }) {
  const id = `stagehand-spacing-${label.toLowerCase().replaceAll(" ", "-")}`;
  return <div className="stagehand-spacing-control"><span><label htmlFor={id}>{label}</label><output htmlFor={id}>{value} px</output></span><input id={id} type="range" min={0} max={maximum} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))}/></div>;
}

export function LivePlayPage() {
  const store = useAppStore(useShallow((state) => ({
    liveLayout: state.liveLayout, liveSnapshot: state.liveSnapshot, liveStages: state.liveStages, liveSubtree: state.liveSubtree,
    selectedLiveStageId: state.selectedLiveStageId, selectedSetlistId: state.selectedSetlistId, device: state.device,
    rigs: state.rigs, setlists: state.setlists, preferences: state.preferences,
    favoriteLiveControlKeys: state.favoriteLiveControlKeys, liveControlPresets: state.liveControlPresets,
    addLiveButton: state.addLiveButton, attachLiveStageToRig: state.attachLiveStageToRig, createLiveStage: state.createLiveStage,
    deleteLiveControlPreset: state.deleteLiveControlPreset, deleteLiveStage: state.deleteLiveStage, duplicateLiveStage: state.duplicateLiveStage,
    loadRig: state.loadRig, moveLiveButton: state.moveLiveButton, removeLiveButton: state.removeLiveButton,
    renameLiveStage: state.renameLiveStage, saveLiveControlPreset: state.saveLiveControlPreset, selectLiveStage: state.selectLiveStage,
    setLiveDimensions: state.setLiveDimensions, setLiveLocked: state.setLiveLocked, setLiveSpacing: state.setLiveSpacing, setPage: state.setPage,
    toggleFavoriteLiveControl: state.toggleFavoriteLiveControl, updateLiveButton: state.updateLiveButton, updateMidi: state.updateMidi,
  })));
  const layout = store.liveLayout; const midi = useMidiConnection();
  const controlsPanel = useWorkspacePanel("stagehand", "stagehand-controls");
  const stageScreen = useStageFullscreen();
  const [editRequested, setEdit] = useState(false); const edit = editRequested && !layout.locked && !stageScreen.fullscreen; const [editorTab, setEditorTab] = useState<"stage" | "control">("stage"); const [selectedIndex, setSelectedIndex] = useState<number | null>(null); const [movingIndex, setMovingIndex] = useState<number | null>(null); const [draggingIndex, setDraggingIndex] = useState<number | null>(null); const [dragTarget, setDragTarget] = useState<number | null>(null); const [paletteOpen, setPaletteOpen] = useState(false); const [paletteGroup, setPaletteGroup] = useState<PaletteCategoryId>("Rig"); const [paletteQuery, setPaletteQuery] = useState(""); const [palettePlacementError, setPalettePlacementError] = useState<string | null>(null); const [controlPresetOpen, setControlPresetOpen] = useState(false); const [controlPresetName, setControlPresetName] = useState(""); const [midiLearn, setMidiLearn] = useState("MIDI learn"); const [midiReferenceOpen, setMidiReferenceOpen] = useState(false); const [midiActivity, setMidiActivity] = useState("Waiting for MIDI"); const [actionFeedback, setActionFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const lockButton = useRef<HTMLButtonElement>(null);
  const midiLearnButtonRef = useRef<string | null>(null);
  const incomingMidiRef = useRef<(message: StageMidiMessage, source: string) => void>(() => undefined);
  const actionFeedbackTimer = useRef<number | null>(null);
  const live = store.liveSnapshot; const currentRig = live?.rig ?? store.rigs[0] ?? unavailableRig;
  const stage = store.liveStages.find((candidate) => candidate.id === store.selectedLiveStageId) ?? store.liveStages[0]; const stageRig = stage?.rigId ? store.rigs.find((rig) => rig.id === stage.rigId) : undefined; const stageMatchesDevice = !stage?.rigId || stage.rigId === currentRig.id;
  const selected = selectedIndex === null ? null : layout.buttons[selectedIndex]; const midiText = selected ? `${selected.midi.type.toUpperCase()} ${selected.midi.number} · value ${selected.midi.value} · channel ${selected.midi.channel}` : "";
  const selectedDeckKind: "drums" | null = selected?.widget === "drums" ? "drums" : null;
  const paletteItems = useMemo<PaletteItem[]>(() => [
    ...store.liveControlPresets.filter((preset) => !["looper", "practice", "expression"].includes(preset.button.action)).map((preset) => ({ ...preset.button, group: "My controls", presetId: preset.id, presetName: preset.name })),
    ...(stageRig ? blockPalette(stageRig) : []),
    ...actionPalette,
  ], [stageRig, store.liveControlPresets]);
  const searchedPalette = useMemo(() => { const query = paletteQuery.trim().toLowerCase(); return query ? paletteItems.filter((item) => `${item.presetName ?? ""} ${item.label} ${item.subtitle} ${item.group} ${item.action}`.toLowerCase().includes(query)) : paletteItems; }, [paletteItems, paletteQuery]);
  const paletteCounts = useMemo(() => Object.fromEntries(PALETTE_CATEGORIES.map((category) => [category.id, category.id === "Favourites" ? searchedPalette.filter((item) => store.favoriteLiveControlKeys.includes(stagehandPaletteItemKey(item))).length : searchedPalette.filter((item) => stagehandPaletteCategory(item) === category.id).length])) as Record<PaletteCategoryId, number>, [searchedPalette, store.favoriteLiveControlKeys]);
  const filteredPalette = useMemo(() => filterStagehandPalette(searchedPalette, paletteGroup, store.favoriteLiveControlKeys), [searchedPalette, paletteGroup, store.favoriteLiveControlKeys]);
  const paletteSections = useMemo(() => {
    const category = PALETTE_CATEGORIES.find((candidate) => candidate.id === paletteGroup)!;
    return filteredPalette.length ? [{ category, items: filteredPalette }] : [];
  }, [filteredPalette, paletteGroup]);
  const fftObject = store.liveSubtree?.["/Evil/Engine/FFTCtrl"]; const fft = fftObject?.value ?? {}; const rawCents = Number(fft.TunerCents ?? .5); const centsMeta = fftObject?.meta?.properties?.TunerCents; const tunerNote = String(fft.TunerString ?? "").trim(); const tunerOpen = store.liveSubtree?.["/Evil/Engine/AudioCtrl/Input"]?.value?.TunerOn === true;
  const drums = store.liveSubtree?.["/Evil/Engine/DrumsCtrl"]?.value ?? {}; const widgetData: StageWidgetData = { tuner: { open: tunerOpen, note: tunerNote, cents: tunerNote ? Math.round(centsMeta ? denormalizeValue(rawCents, centsMeta) : rawCents) : 0, reference: Number(fft.TunerRef ?? 440) }, drums: { playing: drums.isPlaying === true || drums.isPlaying === 1, muted: drums.isMuted === true || drums.isMuted === 1, kit: String(drums.Kit ?? live?.drums.kit ?? "Drums"), part: String(drums.PartInfo ?? ""), bar: Number(drums.currentBar ?? 0) + 1, beat: Number(drums.currentBeat ?? 0) + 1 } };
  const controlCount = layout.buttons.filter(Boolean).length;
  const spacing = normalizeLiveStageSpacing(layout.spacing);
  const updateSpacing = (key: keyof LiveStageSpacing, value: number) => store.setLiveSpacing({ [key]: value });
  const showActionFeedback = (tone: "success" | "warning", message: string) => {
    if (actionFeedbackTimer.current) window.clearTimeout(actionFeedbackTimer.current);
    setActionFeedback({ tone, message });
    actionFeedbackTimer.current = window.setTimeout(() => setActionFeedback(null), tone === "success" ? 1400 : 2800);
  };
  useEffect(() => () => { if (actionFeedbackTimer.current) window.clearTimeout(actionFeedbackTimer.current); }, []);
  useEffect(() => {
    if (!layout.locked && !stageScreen.fullscreen) return;
    setEdit(false); setSelectedIndex(null); setMovingIndex(null); setDraggingIndex(null); setDragTarget(null);
    setPaletteOpen(false); setControlPresetOpen(false); midiLearnButtonRef.current = null; setMidiLearn("MIDI learn");
  }, [layout.locked, stageScreen.fullscreen]);
  useEffect(() => { setSelectedIndex(null); setEditorTab("stage"); setMovingIndex(null); setDraggingIndex(null); setDragTarget(null); }, [store.selectedLiveStageId]);
  useEffect(() => { if (!selected && editorTab === "control") setEditorTab("stage"); }, [editorTab, selected]);
  useEffect(() => {
    if (edit || !store.preferences.keepAwake) return;
    let sentinel: { release: () => Promise<void> } | undefined;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (wakeLock) void wakeLock.request("screen").then((next) => { sentinel = next; }).catch(() => undefined);
    return () => { void sentinel?.release(); };
  }, [edit, store.preferences.keepAwake]);
  const moveControl = (from: number, to: number) => {
    const moving = layout.buttons[from]; const nextButtons = [...layout.buttons]; [nextButtons[from], nextButtons[to]] = [nextButtons[to], nextButtons[from]];
    store.moveLiveButton(from, to);
    if (moving?.widget === "drums") {
      const deckLayout = moving.widgetLayout ?? "2x2"; const requested = normalizeLiveDeckFootprint(deckLayout, moving.widgetSize ?? (moving.width === 2 ? "1x2" : "1x1"));
      const widgetSize = canPlaceLiveFootprint(layout, nextButtons, to, requested) ? requested : [...liveDeckFootprintChoices(deckLayout)].reverse().find((size) => canPlaceLiveFootprint(layout, nextButtons, to, size)) ?? "1x1";
      if (widgetSize !== moving.widgetSize) store.updateLiveButton(moving.id, { widgetSize });
    }
    if (selectedIndex === from) setSelectedIndex(to); else if (selectedIndex === to) setSelectedIndex(from); setMovingIndex(null);
  };
  const finishDrag = (from: number, to: number) => { moveControl(from, to); setDraggingIndex(null); setDragTarget(null); };
  const selectPad = (index: number, button: LiveButton | null) => { if (layout.locked || stageScreen.fullscreen) return; if (movingIndex !== null) { moveControl(movingIndex, index); return; } setSelectedIndex(index); if (button) { setEditorTab("control"); if (edit) controlsPanel.setOpen(true); return; } setEditorTab("stage"); setPalettePlacementError(null); setPaletteOpen(true); };
  const moveAdjacent = (direction: "left" | "right" | "up" | "down") => { if (selectedIndex === null) return; const target = adjacentLiveIndex(layout, selectedIndex, direction); if (target !== null) moveControl(selectedIndex, target); };
  const bestDeckFootprint = (deckLayout: NonNullable<LiveButton["widgetLayout"]>, index: number, preferred?: LiveDeckFootprint) => {
    const choices = liveDeckFootprintChoices(deckLayout); const normalized = normalizeLiveDeckFootprint(deckLayout, preferred);
    if (canPlaceLiveFootprint(layout, layout.buttons, index, normalized)) return normalized;
    return [...choices].reverse().find((size) => canPlaceLiveFootprint(layout, layout.buttons, index, size)) ?? "1x1";
  };
  const addFromPalette = (template: PaletteItem | LiveButtonTemplate) => {
    const { group: _group, styleColor: _styleColor, presetId: _presetId, presetName: _presetName, ...button } = template as PaletteItem;
    let target = selectedIndex !== null && layout.buttons[selectedIndex] === null ? selectedIndex : layout.buttons.findIndex((candidate) => candidate === null);
    if (target < 0) { setPalettePlacementError("This stage is full. Remove a control or expand the layout before adding another one."); return; }
    if (button.widget === "tuner") {
      const candidates = [...Array(layout.buttons.length).keys()];
      target = target >= 0 && canPlaceLiveFootprint(layout, layout.buttons, target, "1x2") ? target : candidates.find((index) => layout.buttons[index] === null && canPlaceLiveFootprint(layout, layout.buttons, index, "1x2")) ?? -1;
      if (target < 0) { setPalettePlacementError("Tuner Display needs two adjacent free columns. Move or remove a control, then try again."); return; }
    }
    const deck = button.widget === "drums" && button.widgetLayout;
    const uniqueId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    store.addLiveButton({ ...button, accentColor: stagehandPaletteAccent(template as PaletteItem), ...(deck ? { widgetSize: bestDeckFootprint(deck, target, button.widgetSize) } : {}), id: `live-${uniqueId}` }, target); setSelectedIndex(target); setEditorTab("control"); if (edit) controlsPanel.setOpen(true); setPalettePlacementError(null); setPaletteOpen(false);
  };
  const testSelected = () => { if (selected) void triggerControl(selected, selected.switchType === "hold" ? "hold" : "release"); };
  const triggerControl = async (button: LiveButton, gesture?: LiveGesture, target?: string) => {
    const resolvedGesture = gesture ?? "release"; const effective = resolveLiveButtonGesture(button, resolvedGesture, target);
    if (!effective) { showActionFeedback("warning", `${button.label} has no action for this gesture`); return; }
    const executed = await useAppStore.getState().triggerLiveButton(button.id, resolvedGesture, target);
    if (!executed) { showActionFeedback("warning", `${effective.label} could not be applied`); return; }
    showActionFeedback("success", `${effective.label} applied`);
  };
  incomingMidiRef.current = (message, source) => {
    if (message.released && midiLearnButtonRef.current) return;
    if (midiLearnButtonRef.current) {
      const buttonId = midiLearnButtonRef.current; midiLearnButtonRef.current = null;
      useAppStore.getState().updateMidi(buttonId, { type: message.type, channel: message.channel, number: message.number, value: message.value || 127, releaseValue: 0 });
      setMidiLearn(`Learned ${message.type.toUpperCase()} ${message.number}`); setMidiActivity(`Learned from ${source.replace("midi:", "")}`); return;
    }
    const match = findStageMidiMatch(useAppStore.getState().liveLayout.buttons, message);
    setMidiActivity(`${message.type.toUpperCase()} ${message.number} · ch ${message.channel}${match ? ` → ${match.button.label}` : " · unassigned"}`);
    if (match) void triggerControl(match.button, match.gesture, match.target);
  };
  const learnMidi = async () => {
    if (!selected) return; midiLearnButtonRef.current = selected.id; setMidiLearn("Move a key, pad or pedal…");
    if (!midiConnection.getSnapshot().ready) { const access = await midiConnection.connect(); if (!access && !midiConnection.getSnapshot().ready) setMidiLearn("Configure a MIDI input in Settings first"); }
  };
  useEffect(() => { void midiConnection.autoConnect(); return midiConnection.subscribeMessages((message, source) => incomingMidiRef.current(message, source)); }, []);
  const requestedFootprint = (button: LiveButton | null): LiveDeckFootprint => {
    if (button?.widgetSize) return button.widgetSize;
    if (button?.widget === "drums") return normalizeLiveDeckFootprint(button.widgetLayout ?? "2x2", button.widgetSize ?? (button.width === 2 ? "1x2" : "1x1"));
    return button?.width === 2 ? "1x2" : "1x1";
  };
  const pad = (button: LiveButton | null, index: number, size: LiveDeckFootprint, gridStyle: React.CSSProperties) => {
    const { rows: spanRows, columns: spanColumns } = liveDeckFootprintDimensions(size);
    return <LivePad key={button?.id ?? `empty-${index}`} button={button} index={index} editable={edit && !layout.locked} selected={selectedIndex === index} moving={movingIndex !== null && movingIndex !== index} dragging={draggingIndex === index} dragOver={dragTarget === index && draggingIndex !== index} spanRows={spanRows} spanColumns={spanColumns} gridStyle={gridStyle} disabled={Boolean(!button && (layout.locked || stageScreen.fullscreen) || !edit && button?.action === "block-toggle" && !stageMatchesDevice)} widgetData={widgetData} tunerCentsMeta={centsMeta} tunerDeviceId={store.device?.id} active={button ? activeFromDevice(button, currentRig, live?.currentScene, store.liveSubtree) : false} onSelect={() => selectPad(index, button)} onTrigger={(gesture) => { if (button) void triggerControl(button, gesture); }} onWidgetAction={(target, gesture) => { if (button) void triggerControl(button, gesture, target); }} onDragBegin={(from) => { setDraggingIndex(from); setDragTarget(from); }} onDragHover={setDragTarget} onDragFinish={finishDrag} onDragCancel={() => { setDraggingIndex(null); setDragTarget(null); }}/>;
  };
  const renderBoard = () => {
    const occupied = new Set<number>(); const result: React.ReactNode[] = [];
    for (let index = 0; index < layout.buttons.length; index++) {
      if (occupied.has(index)) continue;
      const button = layout.buttons[index]; const requested = requestedFootprint(button); const size = button && canPlaceLiveFootprint(layout, layout.buttons, index, requested) ? requested : "1x1";
      const cell = liveIndexToCell(layout, index); if (!cell) continue;
      const indexes = liveFootprintIndexes(layout, index, size) ?? [index]; indexes.slice(1).forEach((cellIndex) => occupied.add(cellIndex));
      const { rows, columns } = liveDeckFootprintDimensions(size);
      result.push(pad(button, index, size, { gridRow: `${cell.row + 1} / span ${rows}`, gridColumn: `${cell.column + 1} / span ${columns}` }));
    }
    return result;
  };

  return <div className={cn("live-page stagehand-v2", stageScreen.fullscreen && "stagehand--fullscreen", !edit && "live-page--performance", movingIndex !== null && "is-moving")}>
    <div className="stagehand-header">
    <div className="live-toolbar"><div><span className="eyebrow">STAGE WORKSPACE</span><h1>StageHand</h1><p>{stage?.name ?? "Stage"} · {layout.model} · {layout.buttons.filter(Boolean).length} controls · device-synchronised</p></div><div className="live-toolbar__actions"><Button onClick={() => setMidiReferenceOpen(true)}><Cable size={15}/> MIDI map</Button><Button className="stagehand-screen-control" ref={lockButton} aria-label={layout.locked ? "Unlock layout" : "Lock layout"} aria-pressed={layout.locked} title={layout.locked ? "Unlock to edit the stage. Performance controls remain active." : "Protect the stage layout. Performance controls remain active."} onClick={() => { lockButton.current?.focus(); store.setLiveLocked(!layout.locked); }}>{layout.locked ? <Lock size={15}/> : <Unlock size={15}/>} {layout.locked ? (stageScreen.fullscreen ? "Unlock" : "Locked") : (stageScreen.fullscreen ? "Lock" : "Unlocked")}</Button><Button disabled={layout.locked} variant={edit ? "primary" : "secondary"} onClick={() => { const nextEdit = !edit; setEdit(nextEdit); setEditorTab("stage"); if (!nextEdit) setSelectedIndex(null); setMovingIndex(null); }}><Settings2 size={15}/> {edit ? "Editing layout" : "Edit layout"}</Button>{edit && <WorkspacePanelToggle open={controlsPanel.open} onToggle={controlsPanel.toggle} controls="stagehand-controls" label="Layout controls"/>}<IconButton className="stagehand-screen-control" label={stageScreen.fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={stageScreen.fullscreen} aria-busy={stageScreen.busy} disabled={stageScreen.busy} onClick={() => void stageScreen.toggle()}>{stageScreen.fullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</IconButton></div></div>
    {stageScreen.notice && <div className="stagehand-screen-notice" role="status">{stageScreen.notice}</div>}
    <div className="stagehand-stage-bar"><div className="stagehand-stage-tabs">{store.liveStages.map((candidate, index) => { const rig = candidate.rigId ? store.rigs.find((item) => item.id === candidate.rigId) : undefined; return <button key={candidate.id} className={cn(candidate.id === store.selectedLiveStageId && "active", candidate.rigId === currentRig.id && "device-match")} onClick={() => store.selectLiveStage(candidate.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{candidate.name}</strong><small>{rig?.name ?? "Manual stage"}</small>{candidate.rigId === currentRig.id && <i title="Automatically matched to the current rig"/>}</button>; })}</div><div className="stagehand-stage-actions"><IconButton disabled={layout.locked} label="Duplicate this stage" onClick={() => store.duplicateLiveStage()}><Copy size={15}/></IconButton><Button size="sm" disabled={layout.locked} onClick={() => store.createLiveStage()}><Plus size={14}/> New stage</Button></div></div>
    <div className="performance-strip stagehand-rig-strip" aria-label="Current device rig"><div className="stagehand-current-rig"><span className="stagehand-current-rig__icon"><Music2 size={19}/><i/></span><div className="stagehand-current-rig__copy"><small>ACTIVE RIG</small><strong>{currentRig.name}</strong><span>{live ? `Scene ${"ABCDEF"[Math.max(0, live.currentScene - 1)] ?? live.currentScene}${live.loadedSetlistName ? ` · ${live.loadedSetlistName}` : ""}` : "Stage preview · device data unavailable"}</span></div></div><div className={cn("stagehand-rig-status", live && "is-live")}><i/><div><small>DEVICE</small><strong>{live ? "Live" : "Preview"}</strong></div></div><div className="tempo-readout stagehand-tempo"><Timer size={17}/><div><strong>{Math.round(currentRig.tempo)}</strong><span>BPM</span></div></div></div>
    {movingIndex !== null && <div className="stagehand-move-banner"><Move size={16}/><span>Choose any destination. Occupied controls swap places.</span><Button size="sm" onClick={() => setMovingIndex(null)}>Cancel move</Button></div>}
    </div>
    <div className={cn("live-workspace", (!edit || !controlsPanel.open) && "live-workspace--controls-collapsed")}><section className="live-board-wrap"><div className="live-board stagehand-grid" data-locked={layout.locked} style={{ "--stage-columns": layout.columns, "--stage-rows": layout.rows, "--stage-column-gap": `${spacing.columnGap}px`, "--stage-row-gap": `${spacing.rowGap}px`, "--stage-inset-top": `${spacing.insetTop}px`, "--stage-inset-right": `${spacing.insetRight}px`, "--stage-inset-bottom": `${spacing.insetBottom}px`, "--stage-inset-left": `${spacing.insetLeft}px` } as React.CSSProperties}>{renderBoard()}</div><div className="live-hint"><RadioTower size={15}/> {edit ? "Drag controls directly. Multi-button decks can occupy their full layout, a 1×2 strip, or one compact cell when space is available." : "Performance mode · trigger, latch, momentary, hold and multi-gesture controls are live."}</div>{actionFeedback && <div className={cn("stagehand-action-feedback", actionFeedback.tone)} role="status" aria-live="polite"><Activity size={15}/><span>{actionFeedback.message}</span></div>}</section>
      {edit && <aside id="stagehand-controls" className="live-inspector" hidden={!controlsPanel.open}><div className="stagehand-editor-tabs" role="tablist" aria-label="Layout editing"><button type="button" role="tab" aria-selected={editorTab === "stage"} className={editorTab === "stage" ? "active" : ""} onClick={() => setEditorTab("stage")}><Layers3 size={15}/><span><strong>Stage</strong><small>Layout and rig</small></span></button><button type="button" role="tab" aria-selected={editorTab === "control"} className={editorTab === "control" ? "active" : ""} disabled={!selected} onClick={() => { if (selected) setEditorTab("control"); }}><Zap size={15}/><span><strong>Control</strong><small>{selected ? `Slot ${selectedIndex! + 1}` : "Select a control"}</small></span></button></div>{editorTab === "stage" && <div className="stagehand-editor-panel"><div className="panel-title"><span>STAGE</span><div className="stagehand-inspector-actions"><Badge tone={stageMatchesDevice && stage?.rigId ? "green" : "neutral"}>{stage?.rigId ? stageMatchesDevice ? "CURRENT RIG" : "RIG LINKED" : "MANUAL"}</Badge><IconButton disabled={store.liveStages.length <= 1} label="Delete this stage" onClick={() => store.deleteLiveStage()}><Trash2 size={14}/></IconButton></div></div><div className="stagehand-field-pair"><Label>Stage name<Input value={stage?.name ?? ""} onChange={(event) => store.renameLiveStage(event.target.value)}/></Label><Label>Attached rig<Select value={stage?.rigId ?? ""} onChange={(event) => store.attachLiveStageToRig(event.target.value || undefined)}><option value="">Manual · any rig</option>{store.rigs.map((rig) => <option key={rig.id} value={rig.id}>{rig.name}</option>)}</Select></Label></div>{stage?.rigId && <div className={cn("stagehand-rig-link", stageMatchesDevice && "matched")}><Link2 size={15}/><span><strong>{stageRig?.name ?? "Attached rig unavailable"}</strong><small>{stageMatchesDevice ? "This stage follows the currently loaded device rig." : "Loading this rig will automatically switch StageHand to this stage."}</small></span>{stageRig && !stageMatchesDevice && <Button size="sm" onClick={() => void store.loadRig(stageRig.id, live?.rigLibrary.find((rig) => rig.id === stageRig.id)?.srId)}><Play size={13}/> Load rig</Button>}</div>}{!stage?.rigId && <p className="stagehand-rig-help">Attach a rig before adding effect-block controls. Rig-specific choices are then isolated to this stage.</p>}<div className="inspector-divider"/><div className="panel-title"><span>LAYOUT</span><Badge>{layout.rows} × {layout.columns}</Badge></div><div className="dimension-grid"><Label>Rows<Select value={layout.rows} onChange={(event) => store.setLiveDimensions(Number(event.target.value), layout.columns, layout.firstRowColumns)}>{[1,2,3,4].map((number) => <option key={number} disabled={normalizeLiveDimensions(number, layout.columns, layout.firstRowColumns).size < controlCount}>{number}</option>)}</Select></Label><Label>Columns<Select value={layout.columns} onChange={(event) => store.setLiveDimensions(layout.rows, Number(event.target.value), layout.firstRowColumns)}>{[2,3,4,5,6,7,8].map((number) => <option key={number} disabled={normalizeLiveDimensions(layout.rows, number, layout.firstRowColumns).size < controlCount}>{number}</option>)}</Select></Label><Label>First row<Select value={layout.firstRowColumns} onChange={(event) => store.setLiveDimensions(layout.rows, layout.columns, Number(event.target.value))}>{Array.from({ length: layout.columns }, (_, index) => index + 1).map((number) => <option key={number} disabled={normalizeLiveDimensions(layout.rows, layout.columns, number).size < controlCount}>{number}</option>)}</Select></Label></div><p className="stagehand-layout-capacity"><Layers3 size={13}/> {controlCount} control{controlCount === 1 ? "" : "s"} placed · smaller layouts are disabled to protect the stage.</p><div className="inspector-divider"/><div className="panel-title"><span>SPACING</span><Button size="sm" variant="ghost" onClick={() => store.setLiveSpacing(DEFAULT_LIVE_STAGE_SPACING)}><RotateCcw size={12}/> Reset</Button></div><p className="stagehand-spacing-help">Tune the distance between controls and reserve safe space around the stage for a notch, camera cutout or your grip.</p><div className="stagehand-spacing-grid stagehand-spacing-grid--blocks"><StageSpacingSlider label="Horizontal gap" value={spacing.columnGap} maximum={40} onChange={(value) => updateSpacing("columnGap", value)}/><StageSpacingSlider label="Vertical gap" value={spacing.rowGap} maximum={40} onChange={(value) => updateSpacing("rowGap", value)}/></div><div className="stagehand-safe-area-heading"><span>STAGE EDGE INSETS</span><small>Independent safe areas</small></div><div className="stagehand-safe-area-preview" aria-hidden="true" style={{ "--safe-top": `${Math.min(22, spacing.insetTop / 4)}px`, "--safe-right": `${Math.min(30, spacing.insetRight / 3)}px`, "--safe-bottom": `${Math.min(22, spacing.insetBottom / 4)}px`, "--safe-left": `${Math.min(30, spacing.insetLeft / 3)}px` } as React.CSSProperties}><div><span/><span/><span/></div></div><div className="stagehand-spacing-grid stagehand-spacing-grid--edges"><StageSpacingSlider label="Top inset" value={spacing.insetTop} maximum={96} onChange={(value) => updateSpacing("insetTop", value)}/><StageSpacingSlider label="Right inset" value={spacing.insetRight} maximum={96} onChange={(value) => updateSpacing("insetRight", value)}/><StageSpacingSlider label="Bottom inset" value={spacing.insetBottom} maximum={96} onChange={(value) => updateSpacing("insetBottom", value)}/><StageSpacingSlider label="Left inset" value={spacing.insetLeft} maximum={96} onChange={(value) => updateSpacing("insetLeft", value)}/></div></div>}{editorTab === "control" && selected && <div className="stagehand-editor-panel stagehand-editor-panel--control">
        <div className="panel-title"><span>CONTROL {selectedIndex! + 1}</span><div className="stagehand-inspector-actions">{!selected.widget && selected.width !== 2 && <IconButton label="Save as reusable control" onClick={() => { setControlPresetName(selected.label); setControlPresetOpen(true); }}><Save size={15}/></IconButton>}<IconButton label="Test control" onClick={testSelected}><RadioTower size={15}/></IconButton><IconButton label="Remove" onClick={() => { store.removeLiveButton(selected.id); setSelectedIndex(null); setEditorTab("stage"); }}><Trash2 size={15}/></IconButton></div></div><div className="stagehand-position"><Button className="stagehand-move-button" variant={movingIndex === selectedIndex ? "primary" : "secondary"} onClick={() => setMovingIndex(movingIndex === selectedIndex ? null : selectedIndex)}><Move size={15}/> Move control</Button><div><IconButton label="Move left" onClick={() => moveAdjacent("left")}><ArrowLeft size={14}/></IconButton><IconButton label="Move up" onClick={() => moveAdjacent("up")}><ArrowUp size={14}/></IconButton><IconButton label="Move down" onClick={() => moveAdjacent("down")}><ArrowDown size={14}/></IconButton><IconButton label="Move right" onClick={() => moveAdjacent("right")}><ArrowRight size={14}/></IconButton></div></div>
          <div className="stagehand-field-pair"><Label>Label<Input value={selected.label} onChange={(event) => store.updateLiveButton(selected.id, { label: event.target.value.toUpperCase() })}/></Label><Label>Subtitle<Input value={selected.subtitle} onChange={(event) => store.updateLiveButton(selected.id, { subtitle: event.target.value })}/></Label></div>{selected.widget && !selectedDeckKind && <div><span className="stagehand-field-label">DECK SIZE</span><div className="stagehand-choice-row stagehand-choice-row--size"><button className={selected.width !== 2 ? "active" : ""} onClick={() => store.updateLiveButton(selected.id, { width: 1 })}>Compact</button><button className={selected.width === 2 ? "active" : ""} onClick={() => store.updateLiveButton(selected.id, { width: 2 })}>Two slots</button></div></div>}
          {selectedDeckKind && <div className="stagehand-deck-editor">
            <span className="stagehand-field-label">BUTTON LAYOUT · MAXIMUM SIZE</span>
            <div className="stagehand-deck-layouts">{LIVE_DECK_LAYOUTS.map((deckLayout) => <button key={deckLayout} className={selected.widgetLayout === deckLayout ? "active" : ""} onClick={() => { const widgetSize = bestDeckFootprint(deckLayout, selectedIndex!, normalizeLiveDeckFootprint(deckLayout, selected.widgetSize)); store.updateLiveButton(selected.id, { widgetLayout: deckLayout, widgetSize, widgetActions: normalizeLiveDeckActions(selectedDeckKind, deckLayout, selected.widgetActions) }); }}><strong>{deckLayout.replace("x", "×")}</strong><small>{liveDeckDimensions(deckLayout).capacity} buttons</small></button>)}</div>
            <span className="stagehand-field-label">STAGE FOOTPRINT</span>
            <div className="stagehand-deck-footprints">{[...liveDeckFootprintChoices(selected.widgetLayout ?? "2x2")].reverse().map((size) => { const available = canPlaceLiveFootprint(layout, layout.buttons, selectedIndex!, size); const current = normalizeLiveDeckFootprint(selected.widgetLayout ?? "2x2", selected.widgetSize ?? (selected.width === 2 ? "1x2" : "1x1")); return <button key={size} disabled={!available} className={current === size ? "active" : ""} title={available ? `${size.replace("x", "×")} StageHand cells` : "Move the deck or clear the covered cells first"} onClick={() => store.updateLiveButton(selected.id, { widgetSize: size })}><strong>{size.replace("x", "×")}</strong><small>{size === selected.widgetLayout ? "Original" : size === "1x1" ? "Compact" : "Strip"}</small></button>; })}</div>
            <div className="stagehand-deck-binding-heading"><span className="stagehand-field-label">BUTTON ASSIGNMENTS</span><button type="button" onClick={() => store.updateLiveButton(selected.id, { widgetActions: [...LIVE_DECK_DEFAULTS[selectedDeckKind][selected.widgetLayout ?? "2x2"]] })}><RotateCcw size={11}/> Reset</button></div>
            <div className="stagehand-deck-bindings">{normalizeLiveDeckActions(selectedDeckKind, selected.widgetLayout ?? "2x2", selected.widgetActions).map((target, index, actions) => { const meta = DECK_ACTION_META[selectedDeckKind][target]; const AssignmentIcon = meta.icon; const command = flexPrimeMidiCommand(selectedDeckKind, target); return <div className="stagehand-deck-binding-row" key={index}><span className="stagehand-deck-binding-number">{String(index + 1).padStart(2, "0")}</span><span className={cn("stagehand-deck-binding-icon", `action-${target}`)}><AssignmentIcon size={14}/></span><span className="stagehand-deck-binding-copy"><strong>{meta.label}</strong><small>Drums · CC {command.number}</small></span><Select aria-label={`Button ${index + 1} assignment`} value={target} onChange={(event) => { const next = [...actions]; next[index] = event.target.value; store.updateLiveButton(selected.id, { widgetActions: next }); }}>{LIVE_DECK_ACTIONS[selectedDeckKind].map((action) => <option key={action} value={action}>{DECK_ACTION_META[selectedDeckKind][action].label} · CC {flexPrimeMidiCommand(selectedDeckKind, action).number}</option>)}</Select></div>; })}</div>
          </div>}
          <div><span className="stagehand-field-label">SWITCH BEHAVIOUR</span><div className={cn("stagehand-behaviour-lock", selected.multiFunction && "multifunction")}><span>{selected.multiFunction ? <Sparkles size={16}/> : <Lock size={15}/>}</span><div><strong>{LIVE_SWITCH_LABELS[canonicalLiveSwitchType(selected)]}</strong><small>{selected.multiFunction ? "Dedicated 1×1 control · configure each gesture below" : selected.action === "tuner" ? "Fixed mapping · tap tuner, hold mute" : "Matched to this function so every press remains reliable"}</small></div><Badge tone={selected.multiFunction ? "violet" : "neutral"}>{selected.multiFunction ? "1×1 MULTI" : "FIXED"}</Badge></div></div>
          {selected.multiFunction && <div className="stagehand-multifunction-editor"><header><span><Sparkles size={16}/><strong>MULTIFUNCTION MAP</strong></span><small>Only this dedicated control can combine unrelated actions.</small></header><div className="stagehand-gesture-editor"><GestureBinding title="TAP" hint="Quick release" gesture="release" value={selected.tapBinding} rig={stageRig ?? currentRig} onChange={(tapBinding) => store.updateLiveButton(selected.id, { tapBinding })}/><GestureBinding title="HOLD" hint={`${selected.holdMs ?? 650} ms`} gesture="hold" value={selected.holdBinding} rig={stageRig ?? currentRig} onChange={(holdBinding) => store.updateLiveButton(selected.id, { holdBinding })}/><GestureBinding title="DOUBLE" hint="Two quick taps" gesture="double" value={selected.doubleBinding} rig={stageRig ?? currentRig} onChange={(doubleBinding) => store.updateLiveButton(selected.id, { doubleBinding })}/></div><Label>Hold threshold · {selected.holdMs ?? 650} ms<input className="stagehand-range" type="range" min={350} max={1200} step={50} value={selected.holdMs ?? 650} onChange={(event) => store.updateLiveButton(selected.id, { holdMs: Number(event.target.value) })}/></Label><p><Timer size={12}/> Tap Tempo is available for TAP only; actions that require press/release are excluded from incompatible gestures.</p></div>}
          {selected.action === "tuner" && !selected.multiFunction && <Label>Hold threshold · {selected.holdMs ?? 650} ms<input className="stagehand-range" type="range" min={350} max={1200} step={50} value={selected.holdMs ?? 650} onChange={(event) => store.updateLiveButton(selected.id, { holdMs: Number(event.target.value) })}/></Label>}
          {selected.action === "scene" && <div><span className="stagehand-field-label">SCENE · DOCUMENTED CC 21–26</span><div className="stagehand-choice-row">{"ABCDEF".split("").map((scene) => <button key={scene} className={selected.target === scene ? "active" : ""} onClick={() => store.updateLiveButton(selected.id, { target: scene, label: `SCENE ${scene}`, midi: flexPrimeMidiCommand("scene", scene) })}>{scene}</button>)}</div></div>}{selected.action === "block-toggle" && (stageRig ? <Label>Effect target · {stageRig.name}<Select value={selected.target ?? ""} onChange={(event) => { const block = stageRig.blocks.find((candidate) => candidate.id === event.target.value); store.updateLiveButton(selected.id, { target: event.target.value, subtitle: block?.name ?? selected.subtitle, ...(block ? { color: blockTone(block.category), accentColor: block.color, icon: blockIcon(block.category) } : {}), midi: flexPrimeMidiCommand("block-toggle", undefined, block?.slot) }); }}>{stageRig.blocks.filter((block) => !block.empty).map((block) => <option key={block.id} value={block.id}>{block.name} · slot {block.slot + 1} · CC {75 + block.slot}</option>)}</Select></Label> : <p className="stagehand-rig-help warning">Attach a rig to this stage before choosing an effect block.</p>)}{selected.action === "drums" && !selected.widget && <div><span className="stagehand-field-label">DRUM ACTION · DOCUMENTED CC 42–47</span><div className="stagehand-choice-row stagehand-choice-row--wide">{[["toggle","Play"],["fill","Fill"],["accent","Accent"],["bridge","Bridge"],["outro","Outro"],["mute","Mute"]].map(([target,label]) => <button key={target} className={selected.target === target ? "active" : ""} onClick={() => store.updateLiveButton(selected.id, { target, subtitle: label, midi: flexPrimeMidiCommand("drums", target), switchType: target === "accent" ? "momentary" : ["toggle","mute"].includes(target) ? "toggle" : "trigger" })}>{label}</button>)}</div></div>}
          <div><span className="stagehand-field-label">ACCENT COLOUR</span><div className="color-choices">{["cyan","violet","amber","mint","rose","blue"].map((color) => <button key={color} className={cn(`tone-${color}`, selected.color === color && !selected.accentColor && "selected")} onClick={() => store.updateLiveButton(selected.id, { color, accentColor: undefined })} aria-label={color}/>)}</div></div><div className="midi-editor"><div className="panel-title"><span>MIDI INPUT MAPPING</span><Badge tone="cyan">{midiText}</Badge></div><p>Learn or enter the message an external controller will use to trigger this StageHand function.</p><div className="midi-fields"><Label>Message<Select value={selected.midi.type} onChange={(event) => store.updateMidi(selected.id, { ...selected.midi, type: event.target.value as "cc" | "pc" | "note" })}><option value="cc">Control Change</option><option value="pc">Program Change</option><option value="note">Note</option></Select></Label><Label>Channel<Input type="number" min={1} max={16} value={selected.midi.channel} onChange={(event) => store.updateMidi(selected.id, { ...selected.midi, channel: Number(event.target.value) })}/></Label><Label>Number<Input type="number" min={0} max={127} value={selected.midi.number} onChange={(event) => store.updateMidi(selected.id, { ...selected.midi, number: Number(event.target.value) })}/></Label><Label>Value<Input type="number" min={0} max={127} value={selected.midi.value} onChange={(event) => store.updateMidi(selected.id, { ...selected.midi, value: Number(event.target.value) })}/></Label></div><Button onClick={() => void learnMidi()}><Cable size={15}/> {midiLearn}</Button></div>
        </div>}{editorTab === "control" && selected && <Card className="stagehand-midi-bridge stagehand-midi-bridge--shared"><div><Cable size={17}/><span><strong>External MIDI controller</strong><small>Configured once in Settings and used as an input by every StageHand stage.</small></span></div><div className="stagehand-midi-activity"><Badge tone={midi.ready ? "green" : "amber"}>{midi.ready ? "INPUT READY" : "NOT CONFIGURED"}</Badge><small>{midiActivity}</small></div><Button size="sm" onClick={() => { localStorage.setItem("rushlink-settings-tab", "midi"); store.setPage("settings"); }}><Settings2 size={13}/> Configure in Settings</Button><p className="stagehand-midi-help">RushLink receives controller messages here; StageHand applies supported actions through the HeadRush reflection API.</p></Card>}</aside>}
    </div>
    <Dialog open={paletteOpen} onClose={() => { setPaletteOpen(false); setPalettePlacementError(null); }} title="Add StageHand control" description={stageRig ? `Rig-specific controls are scoped to ${stageRig.name}. Every card previews the same icon and accent colour it will use on stage.` : "Attach a rig to this stage to unlock its effect blocks. Global controls and performance decks remain available."} width="920px">
      <div className="stagehand-palette-tools">
        <div className="stagehand-palette-search"><Search size={16}/><Input value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Search by control, function, deck or effect…"/><span>{filteredPalette.length} result{filteredPalette.length === 1 ? "" : "s"}</span></div>
        <div className="stagehand-palette-groups" role="tablist" aria-label="Control categories">{PALETTE_CATEGORIES.map((category) => { const CategoryIcon = icons[category.icon] ?? Zap; const disabled = category.id === "Rig blocks" && !stageRig; return <button type="button" role="tab" aria-selected={paletteGroup === category.id} key={category.id} disabled={disabled} title={disabled ? "Attach a rig to this stage first" : category.description} className={paletteGroup === category.id ? "active" : ""} style={{ "--category-color": category.accent } as React.CSSProperties} onClick={() => { setPaletteGroup(category.id); setPalettePlacementError(null); }}><span><CategoryIcon size={15}/></span><div><strong>{category.label}</strong><small>{category.description}</small></div><b>{paletteCounts[category.id]}</b></button>; })}</div>
      </div>
      {palettePlacementError && <div className="stagehand-palette-rig-note warning"><Gauge size={14}/> {palettePlacementError}</div>}
      {!stageRig && <div className="stagehand-palette-rig-note"><Link2 size={14}/> Attach a rig to expose its effects here with their device colours and category icons.</div>}
      <div className="stagehand-palette-sections">{paletteSections.map(({ category, items }) => { const CategoryIcon = icons[category.icon] ?? Zap; return <section key={category.id} style={{ "--category-color": category.accent } as React.CSSProperties}>
        <header><span><CategoryIcon size={15}/></span><div><strong>{category.label}</strong><small>{category.description}</small></div><b>{items.length}</b></header>
        <div className="action-palette">{items.map((item) => { const Icon = icons[item.icon] ?? Zap; const itemKey = stagehandPaletteItemKey(item); const favourite = store.favoriteLiveControlKeys.includes(itemKey); return <div className="stagehand-palette-item" key={itemKey} style={{ "--pad-color": stagehandPaletteAccent(item) } as React.CSSProperties}><button type="button" className="stagehand-palette-item__main" onClick={() => addFromPalette(item)}><span className="stagehand-palette-item__icon"><Icon size={20}/></span><div><strong>{item.presetName ?? item.label}</strong><span>{item.subtitle}</span><small>{item.presetId ? `SAVED · ${LIVE_SWITCH_LABELS[item.switchType ?? "trigger"].toUpperCase()}` : "widget" in item && item.widget ? "MULTI-SLOT" : LIVE_SWITCH_LABELS[item.switchType ?? "trigger"].toUpperCase()} · {item.midi.type.toUpperCase()} {item.midi.number}</small></div><Plus className="stagehand-palette-item__add" size={16}/></button><div className="stagehand-palette-item__actions"><button type="button" className={cn("stagehand-palette-favourite", favourite && "active")} aria-label={favourite ? `Remove ${item.presetName ?? item.label} from favourites` : `Add ${item.presetName ?? item.label} to favourites`} onClick={() => store.toggleFavoriteLiveControl(itemKey)}><Star size={14} fill={favourite ? "currentColor" : "none"}/></button>{item.presetId && <button type="button" className="stagehand-palette-delete" aria-label={`Delete saved control ${item.presetName}`} onClick={() => store.deleteLiveControlPreset(item.presetId!)}><Trash2 size={13}/></button>}</div></div>; })}</div>
      </section>; })}</div>
      {!filteredPalette.length && <div className="stagehand-palette-empty">{paletteGroup === "Favourites" ? <Star size={22}/> : <Search size={22}/>}<strong>{paletteGroup === "Favourites" ? "No favourite controls yet" : paletteQuery.trim() ? `No matches in ${PALETTE_CATEGORIES.find((category) => category.id === paletteGroup)?.label}` : "No controls in this category"}</strong><span>{paletteGroup === "Favourites" ? "Use the star on any control to keep it ready here." : paletteQuery.trim() ? "The search now stays inside the selected category. Clear it or try another term." : "Choose another category or attach the required rig."}</span></div>}
    </Dialog>
    <Dialog open={controlPresetOpen} onClose={() => setControlPresetOpen(false)} title="Save reusable control" description="Store this 1×1 control with its behaviour, gesture assignments, colour and MIDI mapping. It will appear under My controls on every stage." footer={<><Button variant="secondary" onClick={() => setControlPresetOpen(false)}>Cancel</Button><Button disabled={!selected || !controlPresetName.trim()} onClick={() => { if (!selected) return; store.saveLiveControlPreset(controlPresetName, selected); setControlPresetOpen(false); setPaletteGroup("My controls"); }}><Save size={14}/> Save control</Button></>}>
      <div className="stagehand-save-control"><Label>Preset name<Input autoFocus value={controlPresetName} onChange={(event) => setControlPresetName(event.target.value)} placeholder="My lead scene control" onKeyDown={(event) => { if (event.key === "Enter" && selected && controlPresetName.trim()) { store.saveLiveControlPreset(controlPresetName, selected); setControlPresetOpen(false); setPaletteGroup("My controls"); } }}/></Label>{selected && <div><span style={{ "--pad-color": selected.accentColor ?? `var(--${selected.color})` } as React.CSSProperties}><Sparkles size={17}/></span><p><strong>{selected.label}</strong><small>{selected.multiFunction ? "Tap, hold and double-tap mappings included" : `${LIVE_SWITCH_LABELS[canonicalLiveSwitchType(selected)]} behaviour included`} · {selected.midi.type.toUpperCase()} {selected.midi.number}</small></p></div>}</div>
    </Dialog>
    <Dialog open={midiReferenceOpen} onClose={() => setMidiReferenceOpen(false)} title="Flex Prime MIDI reference" description="Documented incoming Control Change assignments from HeadRush Flex Prime User Guide v5.1.0, section 4.21." width="720px"><div className="stagehand-midi-reference">{FLEX_PRIME_MIDI_REFERENCE.map((item) => <div key={item.group}><span><Cable size={15}/><strong>{item.group}</strong></span><Badge tone="cyan">{item.range}</Badge><p>{item.detail}</p></div>)}</div><p className="stagehand-midi-footnote">Expression pedals use CC 1/2 with values 0–127. Footswitch CC 49–51 must receive 127 for press and 0 for release. Tap Tempo CC 64 must be sent repeatedly.</p></Dialog>
  </div>;
}
