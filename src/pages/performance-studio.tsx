import {
  Activity, AudioLines, Check, CircleStop, Clock3, Drum,
  Gauge, Link2, ListMusic, Music, Pause, Play, Plus,
  Power, RefreshCw, RotateCcw, Save, Sparkles, Volume2, VolumeX, Waves,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button, Card, Dialog, Input, Select, Switch, Tabs } from "../components/ui";
import { ReflectionEditor } from "../components/system/reflection-editor";
import { denormalizeValue, parameterDeviceValue, parametersForObject } from "../domain/headrush-reflection";
import { advanceDrumFrame, deviceDrumFrame, drumBeatDurationMs, drumBeatsRemaining, drumCounts, drumPhraseProgress, type DrumTransportFrame } from "../domain/drum-transport";
import type { HeadRushObject, Parameter } from "../domain/types";
import { deviceApi } from "../services/device-api";
import { deviceErrorMessage } from "../services/device-errors";
import { useAppStore } from "../stores/app-store";
import { PageTitle } from "../components/system/page-title";
import { EqGraph } from "./editor";

const DRUMS = "/Evil/Engine/DrumsCtrl"; const TUNER_INPUT = "/Evil/Engine/AudioCtrl/Input"; const TUNER = "/Evil/Engine/AudioCtrl/Tuner"; const FFT = "/Evil/Engine/FFTCtrl"; const MAIN_EQ = "/Evil/Engine/GlobalEQMain"; const AMP_EQ = "/Evil/Engine/GlobalEQAmp";
const values = (object: HeadRushObject | undefined) => object?.value ?? {};
const returned = (body: unknown) => { if (!body || typeof body !== "object") return body; const record = body as { methodReturnValue?: unknown }; const result = record.methodReturnValue ?? body; if (typeof result !== "string") return result; try { return JSON.parse(result); } catch { return result; } };
function shown(object: HeadRushObject | undefined, property: string, digits = 0) { const raw = Number(object?.value?.[property] ?? 0); const meta = object?.meta?.properties?.[property]; const result = meta?.type === "number" ? denormalizeValue(raw, meta) : raw; return Number.isFinite(result) ? result.toFixed(digits) : "—"; }

function DeviceTuner() {
  const store = useAppStore(); const tree = store.liveSubtree ?? {}; const fftObject = tree[FFT]; const inputOn = tree[TUNER_INPUT]?.value?.TunerOn === true; const reportedMuted = tree[TUNER]?.value?.TunerMuting === true; const [active, setActive] = useState(inputOn); const [muted, setMuted] = useState(reportedMuted); const [readout, setReadout] = useState<Record<string, unknown>>(values(fftObject)); const [busy, setBusy] = useState(false); const [muteBusy, setMuteBusy] = useState(false); const [error, setError] = useState<string | null>(null); const owned = useRef(false);
  const rawCents = Number(readout.TunerCents ?? .5); const centsMeta = fftObject?.meta?.properties?.TunerCents; const cents = readout.TunerString ? Math.round(centsMeta ? denormalizeValue(rawCents, centsMeta) : rawCents) : 0; const note = String(readout.TunerString ?? "").trim(); const inTune = Boolean(note) && Math.abs(cents) <= 3;
  const stop = useCallback(async () => { setBusy(true); try { await deviceApi.setDeviceTuner(false); setActive(false); owned.current = false; setReadout((current) => ({ ...current, TunerString: "" })); } catch (reason) { setError(deviceErrorMessage(reason)); } finally { setBusy(false); } }, []);
  const start = async () => { setBusy(true); setError(null); try { await deviceApi.setDeviceTuner(true); owned.current = true; setActive(true); } catch (reason) { setError(deviceErrorMessage(reason)); } finally { setBusy(false); } };
  const change = async (path: string, property: string, next: unknown) => { setError(null); try { await deviceApi.setProperties(path, { [property]: next }); if (path === FFT) setReadout((current) => ({ ...current, [property]: next })); } catch (reason) { setError(deviceErrorMessage(reason)); } };
  const changeMute = async (next: boolean) => {
    const previous = muted;
    setMuted(next);
    setMuteBusy(true);
    setError(null);
    try {
      const confirmed = await deviceApi.setTunerMuted(next);
      if (confirmed !== next) throw new Error(`The pedal reported tuner mute as ${confirmed ? "on" : "off"} after the change.`);
      setMuted(confirmed);
    } catch (reason) {
      setMuted(previous);
      setError(deviceErrorMessage(reason));
    } finally { setMuteBusy(false); }
  };
  useEffect(() => setMuted(reportedMuted), [reportedMuted]);
  useEffect(() => { store.setPerformanceTunerActive(active); if (!active) return; let disposed = false; const pull = async () => { if (disposed || document.visibilityState !== "visible") return; try { const next = await deviceApi.tunerValues(); if (!disposed) setReadout(next); } catch (reason) { if (!disposed) setError(deviceErrorMessage(reason)); } }; void pull(); const timer = window.setInterval(() => void pull(), 180); return () => { disposed = true; window.clearInterval(timer); }; }, [active]);
  useEffect(() => () => { store.setPerformanceTunerActive(false); if (owned.current) void deviceApi.setDeviceTuner(false); }, []);
  return <Card className={active ? "device-tuner active" : "device-tuner"}><div className="performance-card-head"><div><span className="eyebrow">FLEX PRIME FFT STREAM</span><h2>Device tuner</h2><p>Pitch comes directly from the unit—no microphone permission or duplicate local pitch analysis.</p></div><div><Badge tone={active ? "green" : "neutral"}>{active ? "LISTENING" : "STANDBY"}</Badge><Badge tone={inTune ? "green" : note ? "amber" : "neutral"}>{inTune ? "IN TUNE" : note ? "ADJUST" : "NO SIGNAL"}</Badge></div></div>
    <div className="tuner-stage"><div className="tuner-note"><small>{readout.TunerLow === true ? "BASS" : "GUITAR"}</small><strong>{note || "—"}</strong><span>{note ? `${cents > 0 ? "+" : ""}${cents} cents` : "Play a single note"}</span></div><div className="tuner-track"><div className="tuner-scale">{[-50,-25,0,25,50].map((tick) => <i key={tick} className={tick === 0 ? "center" : ""}><small>{tick > 0 ? `+${tick}` : tick}</small></i>)}</div><b className={inTune ? "in-tune" : ""} style={{ left: `${50 + Math.max(-50, Math.min(50, cents))}%` }}/></div></div>
    <div className="tuner-controls"><Button className={`tuner-control__power ${active ? "is-active" : ""}`} loading={busy} variant="secondary" onClick={() => void (active ? stop() : start())}>{active ? <VolumeX size={16}/> : <AudioLines size={16}/>} {active ? "Close tuner" : "Open device tuner"}</Button><label className="tuner-control tuner-control--mode"><span>Mode</span><div className="mode-buttons"><button className={readout.TunerLow !== true ? "active" : ""} onClick={() => void change(FFT, "TunerLow", false)}>Guitar</button><button className={readout.TunerLow === true ? "active" : ""} onClick={() => void change(FFT, "TunerLow", true)}>Bass</button></div></label><label className="tuner-control tuner-control--reference"><span>Reference</span><Select value={Number(readout.TunerRef ?? 440)} onChange={(event) => void change(FFT, "TunerRef", Number(event.target.value))}>{[432,435,438,440,441,442,444].map((hz) => <option key={hz} value={hz}>{hz} Hz</option>)}</Select></label><label className="tuner-control tuner-control--mute tuner-mute"><span>Mute outputs</span><Switch checked={muted} disabled={!active || muteBusy} onCheckedChange={(next) => void changeMute(next)}/></label></div>{error && <p className="performance-inline-error">{error}</p>}<small className="tuner-load-note"><Activity size={12}/> While open, RushLink reads only the tiny FFTCtrl object about five times per second and suppresses full-page refreshes from pitch events.</small>
  </Card>;
}

type DrumPanel = "groove" | "sound" | "automation";

const DRUM_GROOVE_PROPERTIES = ["Tempo", "Kit", "StyleList", "StyleVari", "Intensity", "Vol"];
const DRUM_PANEL_TABS: Array<{ value: DrumPanel; label: string; description: string; icon: typeof Drum }> = [
  { value: "groove", label: "Groove", description: "Style, tempo and dynamics", icon: Waves },
  { value: "sound", label: "Kit", description: "Balance and drum character", icon: Drum },
  { value: "automation", label: "Performance", description: "Fills, feel and response", icon: Sparkles },
];
const DRUM_CONTROL_GROUPS: Record<Exclude<DrumPanel, "groove">, Array<{ title: string; description: string; properties: string[] }>> = {
  sound: [
    { title: "Kit balance", description: "Set the level of each instrument family without hunting through menus.", properties: ["KickVol", "SnareVol", "TomVol", "CymbVol"] },
    { title: "Kit character", description: "Shape pitch, weight, decay, saturation and room as one sound-design section.", properties: ["Tune", "Timbre", "Length", "Drive", "Reverb"] },
    { title: "Accent voice", description: "Choose the hit performed by Accent and set how far it steps forward.", properties: ["AccentSel", "AccentLevel"] },
  ],
  automation: [
    { title: "Phrase changes", description: "Decide how fills and bridges move the drummer into its next section.", properties: ["AutoFill", "AutoFillRate", "FillMode", "Mode"] },
    { title: "Timing & feel", description: "Control count-in, quantisation and the amount of human movement.", properties: ["CountIn", "AccQuantise", "AutoTempo", "Groove", "GrooveDepth"] },
    { title: "Performance response", description: "Set how accents and the expression pedal behave while playing.", properties: ["AccentOneshot", "AutoPedal"] },
  ],
};

function DrumMachineStudio({ object }: { object?: HeadRushObject }) {
  const store = useAppStore();
  const reflectedDrum = values(object);
  const [drum, setLiveDrum] = useState<Record<string, unknown>>(() => ({ ...reflectedDrum }));
  const [panel, setPanel] = useState<DrumPanel>("groove");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [preset, setPreset] = useState(String(drum.LoadedPreset ?? ""));
  const [presetDialog, setPresetDialog] = useState(false);
  const [presetQuery, setPresetQuery] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [renamePresetName, setRenamePresetName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transport, setTransport] = useState<DrumTransportFrame | null>(() => deviceDrumFrame(reflectedDrum));
  const [deviceSync, setDeviceSync] = useState(0);
  const [phraseNotice, setPhraseNotice] = useState<string | null>(null);
  const [accentHeld, setAccentHeld] = useState(false);
  const phraseNoticeTimer = useRef<number | undefined>(undefined);
  const navigateWorkspaceTabs = (event: KeyboardEvent<HTMLButtonElement>, current: DrumPanel) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const panels = DRUM_PANEL_TABS.map((item) => item.value);
    const currentIndex = panels.indexOf(current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + panels.length) % panels.length;
    const next = panels[nextIndex];
    setPanel(next);
    window.requestAnimationFrame(() => document.getElementById(`drum-workspace-tab-${next}`)?.focus());
  };
  const playing = drum.isPlaying === true || drum.isPlaying === 1;
  const muted = drum.isMuted === true || drum.isMuted === 1;
  const fillEngaged = drum.isFillEngaged === true || Number(drum.isFillEngaged) > 0;
  const currentBeat = Math.max(-1, Number(drum.currentBeat ?? -1));
  const currentBar = Math.max(-1, Number(drum.currentBar ?? -1));
  const { barCount, beatCount } = drumCounts(drum);
  const tempoMeta = object?.meta?.properties?.Tempo;
  const tempoRaw = Number(drum.Tempo ?? 0);
  const bpm = Math.max(30, Math.min(240, tempoMeta && Number.isFinite(tempoRaw) ? denormalizeValue(tempoRaw, tempoMeta) : Number.isFinite(tempoRaw) && tempoRaw >= 30 ? tempoRaw : 120));
  const phraseProgress = drumPhraseProgress(transport);
  const beatsRemaining = drumBeatsRemaining(transport);
  const partInfo = String(drum.PartInfo ?? "").trim();
  const phraseName = partInfo || String(drum.StyleVari ?? "Main groove");

  const pullDrum = useCallback(async () => {
    const next = await deviceApi.properties(DRUMS);
    if (Object.keys(next).length) setLiveDrum(next);
    return next;
  }, []);

  const announcePhrase = (message: string) => {
    window.clearTimeout(phraseNoticeTimer.current);
    setPhraseNotice(message);
    phraseNoticeTimer.current = window.setTimeout(() => setPhraseNotice(null), 2_500);
  };

  const refreshPresets = useCallback(async () => {
    setBusy("presets"); setError(null);
    try {
      const result = returned((await deviceApi.callMethod(DRUMS, "presets")).body);
      setPresets(Array.isArray(result) ? result.map(String) : []);
    } catch (reason) { setError(deviceErrorMessage(reason)); } finally { setBusy(null); }
  }, []);

  const run = async (method: string, args: unknown[] = [], refresh = true) => {
    setBusy(method); setError(null);
    try {
      await deviceApi.callMethod(DRUMS, method, args);
      if (refresh) await store.refreshPage("tools", "manual");
      if (deviceApi.isNative()) window.setTimeout(() => void pullDrum().catch(() => undefined), 120);
      return true;
    } catch (reason) { setError(deviceErrorMessage(reason)); return false; } finally { setBusy(null); }
  };

  const createPreset = async () => {
    const name = newPresetName.trim();
    if (!name) return;
    const ok = await run("createPreset", [name]);
    if (!ok) return;
    setPreset(name);
    setRenamePresetName(name);
    setNewPresetName("");
    await refreshPresets();
  };

  const setDrumProperty = async (property: string, next: unknown) => {
    setBusy(property); setError(null);
    try { await deviceApi.setProperties(DRUMS, { [property]: next }); await store.refreshPage("tools", "manual"); }
    catch (reason) { setError(deviceErrorMessage(reason)); } finally { setBusy(null); }
  };

  const startAccent = () => {
    if (accentHeld) return;
    setAccentHeld(true);
    announcePhrase("Accent held");
    void run("playAccent", [], false);
  };

  const stopAccent = () => {
    setAccentHeld(false);
    announcePhrase("Accent released");
    void run("stopAccent", [], false);
  };

  useEffect(() => {
    void deviceApi.callMethod(DRUMS, "drumsPageOpened").then(async () => { await store.refreshPage("tools", "manual"); if (deviceApi.isNative()) await pullDrum(); }).catch((reason) => setError(deviceErrorMessage(reason)));
    void refreshPresets();
    return () => { void deviceApi.callMethod(DRUMS, "drumsPageClosed"); };
  }, [pullDrum, refreshPresets]);

  useEffect(() => {
    if (object?.value) setLiveDrum((current) => ({ ...current, ...object.value }));
  }, [object]);

  useEffect(() => {
    if (!playing) { setTransport(null); return; }
    const reported = deviceDrumFrame(drum);
    if (reported) { setTransport(reported); setDeviceSync((value) => value + 1); }
  }, [playing, currentBar, currentBeat, barCount, beatCount]);

  useEffect(() => {
    if (!playing || !transport) return;
    const timer = window.setInterval(() => setTransport((current) => current ? advanceDrumFrame(current) : current), drumBeatDurationMs(bpm));
    return () => window.clearInterval(timer);
  }, [playing, bpm, deviceSync, Boolean(transport)]);

  useEffect(() => {
    if (!playing || !deviceApi.isNative()) return;
    let disposed = false;
    const pull = async () => { if (disposed || document.visibilityState !== "visible") return; try { await pullDrum(); } catch (reason) { if (!disposed) setError(deviceErrorMessage(reason)); } };
    const timer = window.setInterval(() => void pull(), 900);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [playing, pullDrum]);

  useEffect(() => () => window.clearTimeout(phraseNoticeTimer.current), []);

  return <Card className="drum-master drum-console">
    <header className="drum-studio-head">
      <div className="drummer-brand"><span><Drum size={20}/></span><div><small>FLEX PRIME RHYTHM ENGINE</small><h2>Drummer</h2></div></div>
      <div className="drum-session-summary">
        <div className="primary"><small>GROOVE</small><strong>{String(drum.StyleVari ?? "Choose a groove")}</strong></div>
        <div><small>KIT</small><strong>{String(drum.Kit ?? "Not reported")}</strong></div>
        <div><small>TEMPO</small><strong>{bpm.toFixed(1)} <span>BPM</span></strong></div>
      </div>
      <div className="drummer-toolbar__actions"><Badge tone={playing ? "green" : "neutral"}>{playing ? "PLAYING" : "READY"}</Badge>{muted && <Badge tone="amber">MUTED</Badge>}<Button onClick={() => setPresetDialog(true)}><ListMusic size={15}/> Presets <span className="drummer-preset-count">{presets.length}</span></Button></div>
    </header>
    <div className="drum-performance-surface">
      <section className="drum-transport-deck">
        <div className="drum-surface-label"><span>TRANSPORT</span><small>Pedal playback</small></div>
        <button className={playing ? "drum-main-play active" : "drum-main-play"} disabled={busy === "togglePlay"} onClick={() => void run("togglePlay")} aria-label={playing ? "Pause drummer" : "Play drummer"}><span>{playing ? <Pause size={25}/> : <Play size={25}/>}</span><div><strong>{playing ? "Pause" : "Play"}</strong><small>{playing ? "Keep the current position" : "Start the selected groove"}</small></div></button>
        <div className="drum-transport-secondary"><button disabled={busy === "restart"} onClick={() => { announcePhrase("Restarting at the first bar"); void run("restart"); }}><RefreshCw size={16}/><span>Restart</span></button><button className={muted ? "active-muted" : ""} disabled={busy === "toggleMute"} onClick={() => void run("toggleMute")}>{muted ? <Volume2 size={16}/> : <VolumeX size={16}/>}<span>{muted ? "Unmute" : "Mute"}</span></button></div>
        <span className="drum-device-connection"><Activity size={12}/> Live control on Flex Prime</span>
      </section>
      <section className={playing ? "drummer-phrase active" : "drummer-phrase"}>
        <div className="drummer-phrase__head"><div><span className="drummer-phrase__pulse"/><small>{playing ? "NOW PLAYING" : "PHRASE MONITOR"}</small><strong>{playing ? phraseName : "Start the drummer to follow its structure"}</strong></div><span className="drummer-phrase__sync"><Activity size={12}/>{transport ? transport.source === "device" ? "Device sync" : "Tempo clock" : "Waiting"}</span></div>
        <div className="drummer-phrase__lanes"><div className="drummer-phrase__lane"><span>BAR</span><div>{Array.from({ length: 4 }, (_, index) => <i key={index} className={`${index >= barCount ? "disabled " : ""}${playing && transport?.bar === index ? "active" : ""}`}><b>{index + 1}</b></i>)}</div><output>{transport ? `${transport.bar + 1}/${barCount}` : `—/${barCount}`}</output></div><div className="drummer-phrase__lane beat"><span>BEAT</span><div>{Array.from({ length: 6 }, (_, index) => <i key={index} className={`${index >= beatCount ? "disabled " : ""}${playing && transport?.beat === index ? "active" : ""}`}><b>{index + 1}</b></i>)}</div><output>{transport ? `${transport.beat + 1}/${beatCount}` : `—/${beatCount}`}</output></div></div>
        <div className="drummer-phrase__progress"><span style={{ width: `${phraseProgress}%` }}/></div><div className="drummer-phrase__foot" aria-live="polite"><span>{phraseNotice ?? (playing && beatsRemaining !== null ? beatsRemaining ? `${beatsRemaining} beat${beatsRemaining === 1 ? "" : "s"} to phrase end` : "Phrase resolves on the next beat" : "Device counters engage when playback starts")}</span><b>{partInfo || (fillEngaged ? "Fill engaged" : muted ? "Output muted" : `${barCount} bars · ${beatCount}/4`)}</b></div>
      </section>
      <section className="drum-performance-deck">
        <div className="drum-surface-label"><span>PERFORM</span><small>Phrase-aware commands</small></div>
        <div className="drummer-actions">
          <button className={fillEngaged ? "engaged" : ""} disabled={busy === "playFill"} onClick={() => { announcePhrase("Fill requested for the next phrase"); void run("playFill", [], false); }}><span className="drummer-action-icon"><Drum size={18}/></span><div><strong>Fill</strong><small>Next phrase</small></div><b>01</b></button>
          <button className={accentHeld ? "engaged accent" : "accent"} disabled={busy === "playAccent" || busy === "stopAccent"} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startAccent(); }} onPointerUp={stopAccent} onPointerCancel={stopAccent} onKeyDown={(event) => { if (!event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); startAccent(); } }} onKeyUp={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); stopAccent(); } }}><span className="drummer-action-icon"><Sparkles size={18}/></span><div><strong>Accent</strong><small>Press & hold</small></div><b>02</b></button>
          <button disabled={busy === "playBridge"} onClick={() => { announcePhrase("Bridge requested at the phrase boundary"); void run("playBridge", [], false); }}><span className="drummer-action-icon"><Music size={18}/></span><div><strong>Bridge</strong><small>Next section</small></div><b>03</b></button>
          <button className="outro" disabled={busy === "playOutro"} onClick={() => { announcePhrase("Outro requested at the phrase boundary"); void run("playOutro", [], false); }}><span className="drummer-action-icon"><CircleStop size={18}/></span><div><strong>Outro</strong><small>End cleanly</small></div><b>04</b></button>
        </div>
      </section>
    </div>
    <section className="drum-workbench">
      <div className="drum-workbench-head"><div><span className="eyebrow">SHAPE THE DRUMMER</span><strong>Sound and performance settings</strong><small>Select a workspace; every change is heard immediately on the pedal.</small></div><span className="drummer-device-note"><Activity size={12}/> Device live</span></div>
      <nav className="drum-workspace-tabs" role="tablist" aria-label="Drummer editing workspace">{DRUM_PANEL_TABS.map((item) => { const Icon = item.icon; const selected = panel === item.value; return <button key={item.value} id={`drum-workspace-tab-${item.value}`} type="button" role="tab" className={selected ? "active" : ""} aria-selected={selected} aria-controls={`drum-workspace-panel-${item.value}`} tabIndex={selected ? 0 : -1} onClick={() => setPanel(item.value)} onKeyDown={(event) => navigateWorkspaceTabs(event, item.value)}><span><Icon size={17}/></span><div><strong>{item.label}</strong><small>{item.description}</small></div></button>; })}</nav>
      <div className="drum-workspace-content" id={`drum-workspace-panel-${panel}`} role="tabpanel" aria-labelledby={`drum-workspace-tab-${panel}`}>{panel === "groove" ? <ReflectionEditor path={DRUMS} object={object} include={DRUM_GROOVE_PROPERTIES} columns="compact" appearance="drum-groove" refreshPage="tools"/> : <div className={`drum-control-groups drum-control-groups--${panel}`}>{DRUM_CONTROL_GROUPS[panel].map((group, index) => <section key={group.title} className="drum-control-group"><header><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{group.title}</strong><small>{group.description}</small></div></header><ReflectionEditor path={DRUMS} object={object} include={group.properties} columns="compact" appearance={panel === "sound" ? "drum-mixer" : "drum-feel"} refreshPage="tools"/></section>)}</div>}{panel === "automation" && <div className="fill-pool"><div><span className="eyebrow">FILL VARIATIONS</span><strong>Include only the fills you want Auto Fill to choose</strong></div><div>{Array.from({ length: 8 }, (_, index) => { const property = `Fill${index + 1}Alwd`; const on = drum[property] === true; return <button key={property} className={on ? "active" : ""} disabled={busy === property} aria-pressed={on} onClick={() => void setDrumProperty(property, !on)}><span>{index + 1}</span><small>{on ? "Included" : "Excluded"}</small></button>; })}</div></div>}</div>
    </section>
    {error && <p className="performance-inline-error">{error}</p>}
    <Dialog open={presetDialog} onClose={() => { setPresetDialog(false); setConfirmDelete(false); }} title="Drummer presets" description="Browse and manage presets stored by the Flex Prime Drum Machine." width="760px" footer={<><Button onClick={() => void refreshPresets()} loading={busy === "presets"}><RefreshCw size={14}/> Refresh device</Button><Button variant="primary" onClick={() => setPresetDialog(false)}>Done</Button></>}>
      <div className="drum-preset-browser">
        <aside className="drum-preset-library">
          <label><span>FIND A PRESET</span><Input aria-label="Find drummer preset" value={presetQuery} placeholder="Search device presets" onChange={(event) => setPresetQuery(event.target.value)}/></label>
          <div className="drum-preset-list" role="listbox" aria-label="Device drummer presets">{presets.filter((item) => item.toLowerCase().includes(presetQuery.trim().toLowerCase())).map((item) => { const loaded = item === String(drum.LoadedPreset ?? ""); return <button key={item} type="button" role="option" aria-selected={preset === item} className={preset === item ? "selected" : ""} onClick={() => { setPreset(item); setRenamePresetName(item); setConfirmDelete(false); }} onDoubleClick={() => void run("loadPreset", [item]).then((ok) => ok && setPresetDialog(false))}><span><ListMusic size={15}/></span><div><strong>{item}</strong><small>{loaded ? "Loaded on the pedal" : "Device preset"}</small></div>{loaded && <Check size={14}/>}</button>; })}{!presets.filter((item) => item.toLowerCase().includes(presetQuery.trim().toLowerCase())).length && <p>No matching presets on the device.</p>}</div>
          <small className="drum-preset-library__hint">Select to inspect · double-click to load</small>
        </aside>
        <section className="drum-preset-detail">
          {preset ? <><div className="drum-preset-selected"><span><ListMusic size={19}/></span><div><small>SELECTED PRESET</small><strong>{preset}</strong><p>{preset === String(drum.LoadedPreset ?? "") ? "This preset is currently loaded on the pedal and can be updated from the current settings." : "Load this preset before editing or replacing its stored settings."}</p></div></div><div className="drum-preset-primary-actions"><Button variant="primary" loading={busy === "loadPreset"} onClick={() => void run("loadPreset", [preset]).then((ok) => ok && setPresetDialog(false))}><Play size={15}/> Load preset</Button><Button disabled={preset !== String(drum.LoadedPreset ?? "")} loading={busy === "saveCurrentPreset"} onClick={() => void run("saveCurrentPreset").then(refreshPresets)}><Save size={15}/> Update loaded preset</Button></div><div className="drum-preset-rename"><label><span>RENAME SELECTED</span><Input value={renamePresetName} placeholder="Preset name" onChange={(event) => setRenamePresetName(event.target.value)}/></label><Button disabled={!renamePresetName.trim() || renamePresetName.trim() === preset} onClick={() => void run("renamePreset", [preset, renamePresetName.trim()]).then(refreshPresets)}>Rename</Button></div><div className="drum-preset-danger">{confirmDelete ? <><span>Delete “{preset}” from the pedal?</span><Button variant="danger" loading={busy === "deletePreset"} onClick={() => void run("deletePreset", [preset]).then((ok) => { if (ok) { setPreset(""); setConfirmDelete(false); void refreshPresets(); } })}>Delete preset</Button><Button onClick={() => setConfirmDelete(false)}>Cancel</Button></> : <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete selected preset</Button>}</div></> : <div className="drum-preset-empty"><ListMusic size={24}/><strong>Select a preset</strong><p>Choose a device preset on the left to load, update, rename or delete it.</p></div>}
          <div className="drum-preset-create">
            <header><span><Plus size={17}/></span><div><small>NEW DEVICE PRESET</small><strong>Save the current drummer setup</strong><p>Store the groove, kit, mix and performance settings currently active on the pedal.</p></div></header>
            <div className="drum-preset-create__form"><label><span>PRESET NAME</span><Input aria-label="New drummer preset name" value={newPresetName} placeholder="For example: Tight studio shuffle" onChange={(event) => setNewPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && newPresetName.trim()) { event.preventDefault(); void createPreset(); } }}/></label><Button variant="primary" disabled={!newPresetName.trim()} loading={busy === "createPreset"} onClick={() => void createPreset()}><Plus size={14}/> Create preset</Button></div>
          </div>
        </section>
      </div>
    </Dialog>
  </Card>;
}

function GlobalEqConsole({ tree }: { tree: Record<string, HeadRushObject> }) {
  const store = useAppStore();
  const [output, setOutput] = useState<"main" | "amp">("main");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = output === "main" ? MAIN_EQ : AMP_EQ;
  const object = tree[path];
  const enabled = object?.value?.On === true;
  const parameters = parametersForObject(object, ["On","MasterGain","Type1","Freq1","Gain1","Q1","Freq2","Gain2","Q2","Freq3","Gain3","Q3","Type4","Freq4","Gain4","Q4"]);
  const graphParameters = parameters.filter((parameter) => parameter.id !== "On" && parameter.id !== "MasterGain" && !parameter.id.startsWith("Type"));

  const commit = async (parameter: Parameter, next: Parameter["value"]) => {
    setError(null);
    try { await deviceApi.setProperties(path, { [parameter.sourceProperty ?? parameter.id]: parameterDeviceValue(parameter, next) }); }
    catch (reason) { setError(deviceErrorMessage(reason)); }
  };
  const setEnabled = async (next: boolean) => {
    setBusy("power"); setError(null);
    try { await deviceApi.setProperties(path, { On: next }); await store.refreshPage("tools", "manual"); }
    catch (reason) { setError(deviceErrorMessage(reason)); } finally { setBusy(null); }
  };
  const reset = async () => {
    setBusy("reset"); setError(null);
    try {
      if (output === "main") await deviceApi.callMethod(path, "reset");
      else {
        const defaults = Object.fromEntries(Object.entries(object?.meta?.properties ?? {}).flatMap(([property, meta]) => meta.readOnly || meta["x-options"]?.default === undefined ? [] : [[property, meta["x-options"]?.default]]));
        await deviceApi.setProperties(path, defaults);
      }
      await store.refreshPage("tools", "manual");
    } catch (reason) { setError(deviceErrorMessage(reason)); } finally { setBusy(null); }
  };
  const bands = [
    { number: "01", title: "Low contour", caption: "Shelf or low cut", fields: ["Type1","Freq1","Gain1","Q1"] },
    { number: "02", title: "Low-mid focus", caption: "Parametric bell", fields: ["Freq2","Gain2","Q2"] },
    { number: "03", title: "High-mid focus", caption: "Parametric bell", fields: ["Freq3","Gain3","Q3"] },
    { number: "04", title: "High contour", caption: "Shelf or high cut", fields: ["Type4","Freq4","Gain4","Q4"] },
  ];

  return <Card className={enabled ? "global-eq-console enabled" : "global-eq-console"}>
    <div className="global-eq-head"><div><span className="eyebrow">DEVICE OUTPUT PROCESSING</span><h2>Global EQ</h2><p>Shape the room without changing the current rig. Drag the numbered nodes or use the precise band controls.</p></div><div className="global-eq-head__actions"><Tabs value={output} onValueChange={setOutput} items={[{ value: "main", label: "Main output" }, { value: "amp", label: "Amp output" }]}/><button className={enabled ? "eq-power active" : "eq-power"} disabled={busy === "power"} onClick={() => void setEnabled(!enabled)}><Power size={15}/><span>{enabled ? "Processing on" : "Bypassed"}</span></button></div></div>
    <div className="global-eq-stage"><div className="global-eq-stage__summary"><div><small>ACTIVE TARGET</small><strong>{output === "main" ? "Main L/R" : "Amp output"}</strong></div><div><small>MASTER</small><strong>{shown(object, "MasterGain", 1)} dB</strong></div><Badge tone={enabled ? "green" : "neutral"}>{enabled ? "LIVE" : "BYPASS"}</Badge></div><EqGraph parameters={graphParameters} onParameterChange={(parameter, next) => void commit(parameter, next)}/></div>
    <div className="global-eq-controls"><div className="eq-master-control"><div><span>MASTER TRIM</span><small>Output compensation after the four bands</small></div><ReflectionEditor path={path} object={object} include={["MasterGain"]} columns="compact" refreshPage="tools"/><Button loading={busy === "reset"} onClick={() => void reset()}><RotateCcw size={14}/> Reset flat</Button></div><div className="eq-band-grid">{bands.map((band) => <section key={band.number}><header><span>{band.number}</span><div><strong>{band.title}</strong><small>{band.caption}</small></div></header><ReflectionEditor path={path} object={object} include={band.fields} columns="compact" refreshPage="tools"/></section>)}</div></div>
    {error && <p className="performance-inline-error">{error}</p>}
  </Card>;
}

export function PerformanceToolsPage() {
  const store = useAppStore(); const tree = store.liveSubtree ?? {}; const rig = store.liveSnapshot?.rig ?? store.rigs.find((item) => item.id === store.selectedRigId); const syncLabel = store.liveSnapshot?.syncedAt ? new Date(store.liveSnapshot.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Offline";
  const healthTone = store.device?.status === "ready" ? "green" : store.connectionBusy ? "amber" : "neutral";
  return <div className="page performance-studio-page"><PageTitle eyebrow="DEVICE-NATIVE PERFORMANCE SUITE" title="Performance Tools" description="Stateful device tools for the Flex Prime drum engine, tuner and output shaping." actions={<><Badge tone={healthTone}><Activity size={11}/>{store.connectionBusy ? "SYNCING" : store.device?.status === "ready" ? "LIVE DEVICE" : "OFFLINE"}</Badge><Button disabled={!store.device} onClick={() => void store.refreshPage("tools", "manual")}><RefreshCw size={15} className={store.syncBusy ? "spin" : ""}/> Refresh tools</Button></>}/>
    <Card className="performance-status-strip"><span><Gauge size={15}/><small>DEVICE CPU</small><strong>{store.liveSnapshot ? `${store.liveSnapshot.cpuPercent}%` : "—"}</strong></span><span><Waves size={15}/><small>CURRENT RIG</small><strong>{rig?.name ?? "No rig"}</strong></span><span><Clock3 size={15}/><small>LAST UPDATE</small><strong>{syncLabel}</strong></span><span><Link2 size={15}/><small>TRANSPORT</small><strong>{store.lastSyncSource ?? "waiting"}</strong></span><span className="performance-status-note"><Activity size={14}/><small>Adaptive sync</small><strong>WebSocket + scoped polling</strong></span></Card>
    <DrumMachineStudio object={tree[DRUMS]}/>
    <div className="performance-tuner-row"><DeviceTuner/></div>
    <GlobalEqConsole tree={tree}/>
  </div>;
}
