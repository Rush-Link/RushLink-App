import { useEffect, useMemo, useState } from "react";
import { Cable, CirclePlay, Plus, Save, Send, X } from "lucide-react";
import type { HeadRushObject } from "../../domain/types";
import { cn } from "../../lib/utils";
import { deviceApi } from "../../services/device-api";
import { deviceErrorDetail, deviceErrorMessage } from "../../services/device-errors";
import { useAppStore } from "../../stores/app-store";
import { Badge, Button, Card, Input, Switch } from "../ui";
import { ReflectionEditor } from "./reflection-editor";
import "../../styles/midi-out-editor.css";

const MIDI_OUT_PATH = "/Evil/Engine/MIDIOutCtrl";
const MIDI_MESSAGE_TYPES = ["None", "Program Change", "Control Change", "Note-On", "Note-Off"] as const;

function methodResult(response: { body: unknown }) {
  const body = response.body as { methodReturnValue?: unknown } | undefined;
  const result = body?.methodReturnValue ?? response.body;
  if (typeof result !== "string") return result;
  try { return JSON.parse(result); } catch { return result; }
}

function midiField(base: string, lane: number, alternate: boolean) {
  return `${base}${alternate ? "Alt" : ""}${lane + 1}`;
}

function fieldsForMessage(lane: number, alternate: boolean, type: number) {
  const typeField = midiField("Type", lane, alternate);
  if (type === 0) return [typeField];
  const channel = midiField("Chan", lane, alternate);
  const value1 = midiField("Val1", lane, alternate);
  const value2 = midiField("Val2", lane, alternate);
  if (type === 1) return [typeField, channel, midiField("MSB", lane, alternate), midiField("LSB", lane, alternate), value1];
  return [typeField, channel, value1, value2];
}

function labelsForMessage(lane: number, alternate: boolean, type: number) {
  const labels: Record<string, string> = {
    [midiField("Type", lane, alternate)]: "Message type",
    [midiField("Chan", lane, alternate)]: "MIDI channel",
    [midiField("MSB", lane, alternate)]: "Bank MSB",
    [midiField("LSB", lane, alternate)]: "Bank LSB",
    [midiField("Val1", lane, alternate)]: type === 1 ? "Program" : type === 2 ? "CC number" : "Note",
    [midiField("Val2", lane, alternate)]: type === 2 ? "CC value" : "Velocity",
  };
  return labels;
}

export function MidiOutEditor({ object }: { object?: HeadRushObject }) {
  const store = useAppStore();
  const [lane, setLane] = useState(0);
  const [alternate, setAlternate] = useState(false);
  const [altEnabled, setAltEnabled] = useState(Boolean(object?.value?.HasAlt));
  const [creating, setCreating] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<string[]>([]);
  const [presetsBusy, setPresetsBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const values = object?.value ?? {};
  const typeField = midiField("Type", lane, alternate);
  const type = Number(values[typeField] ?? 0);
  const fields = useMemo(() => fieldsForMessage(lane, alternate, type), [alternate, lane, type]);
  const labels = useMemo(() => labelsForMessage(lane, alternate, type), [alternate, lane, type]);
  const loadedPreset = typeof values.LoadedPreset === "string" ? values.LoadedPreset : "";

  useEffect(() => {
    const next = Boolean(object?.value?.HasAlt);
    setAltEnabled(next);
    if (!next) setAlternate(false);
  }, [object?.value?.HasAlt]);

  const refreshPresets = async () => {
    setPresetsBusy(true);
    try {
      const response = await deviceApi.callMethod(MIDI_OUT_PATH, "presets", []);
      const result = methodResult(response);
      setPresets(Array.isArray(result) ? result.filter((name): name is string => typeof name === "string") : []);
    } catch { setPresets([]); }
    finally { setPresetsBusy(false); }
  };

  useEffect(() => { void refreshPresets(); }, []);

  const action = async (method: string, args: unknown[], success: string) => {
    setBusy(method); setFeedback(null);
    try {
      const response = await deviceApi.callMethod(MIDI_OUT_PATH, method, args);
      if (response.status < 200 || response.status >= 300 || methodResult(response) === false) throw new Error(`${method} was rejected by the device.`);
      setFeedback(success);
      store.addDiagnostic({ level: "success", source: "MIDI Out", message: success });
      await store.refreshPage("settings", "manual");
      return true;
    } catch (error) {
      const message = deviceErrorMessage(error);
      setFeedback(message);
      store.addDiagnostic({ level: "warning", source: "MIDI Out", message: `Could not ${method}`, detail: message });
      return false;
    } finally { setBusy(null); }
  };

  const toggleAlternate = async (enabled: boolean) => {
    setAltEnabled(enabled);
    if (!enabled) setAlternate(false);
    try {
      const response = await deviceApi.setProperties(MIDI_OUT_PATH, { HasAlt: enabled });
      if (response.status < 200 || response.status >= 300) throw new Error("The device rejected the toggle-state change.");
      await store.refreshPage("settings", "manual");
    } catch (error) {
      setAltEnabled(!enabled);
      if (enabled) setAlternate(false);
      store.addDiagnostic({ level: "warning", source: "MIDI Out", message: "Could not update alternate state", detail: deviceErrorDetail(error) });
    }
  };

  return <Card className="midi-out-studio">
    <header className="midi-out-studio__head"><span className="midi-out-studio__icon"><Send size={20}/></span><div><small>HEADRUSH · PHYSICAL MIDI OUT</small><h2>Rig MIDI Out messages</h2><p>Configure up to five messages sent by the pedal’s hardware MIDI output. RushLink only edits this device-side setup through the reflected API.</p></div><span className="midi-header-status engine">Pedal output</span></header>

    <div className="midi-preset-bar">
      <label className="midi-preset-select"><Cable size={17}/><span><small>MESSAGE PRESET</small><select aria-label="MIDI Out preset" disabled={presetsBusy || busy !== null} value={presets.includes(loadedPreset) ? loadedPreset : ""} onChange={(event) => { const name = event.target.value; if (name) void action("loadPreset", [name, false], `Loaded MIDI preset “${name}”`); }}><option value="">{presetsBusy ? "Loading presets…" : "Unsaved message setup"}</option>{presets.map((name) => <option key={name} value={name}>{name}</option>)}</select></span></label>
      <div className="midi-preset-actions"><Button variant="outline" loading={busy === "test"} onClick={() => void action("test", [], "The pedal tested its MIDI Out messages")}><CirclePlay size={15}/>Test on pedal</Button><Button variant="outline" disabled={!loadedPreset} loading={busy === "saveCurrentPreset"} onClick={() => void action("saveCurrentPreset", [], "MIDI preset updated")}><Save size={15}/>Save</Button><Button variant="primary" onClick={() => setCreating(true)}><Plus size={15}/>Save as preset</Button></div>
    </div>

    {creating && <form className="midi-preset-create" onSubmit={(event) => { event.preventDefault(); const name = presetName.trim(); if (!name) return; void action("createPreset", [name], `Saved MIDI preset “${name}”`).then((saved) => { if (saved) { setPresetName(""); setCreating(false); void refreshPresets(); } }); }}><label htmlFor="midi-preset-name"><span>New preset name</span><Input id="midi-preset-name" autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Stage controller"/></label><Button type="submit" variant="primary" loading={busy === "createPreset"} disabled={!presetName.trim()}>Create preset</Button><Button type="button" variant="ghost" aria-label="Cancel new MIDI preset" onClick={() => { setCreating(false); setPresetName(""); }}><X size={16}/></Button></form>}

    <div className="midi-lane-strip" role="tablist" aria-label="MIDI Out message slots">{Array.from({ length: 5 }, (_, index) => {
      const laneType = Number(values[midiField("Type", index, alternate)] ?? 0);
      return <button type="button" role="tab" aria-selected={lane === index} className={cn(lane === index && "active", laneType > 0 && "configured")} key={index} onClick={() => setLane(index)}><span>{index + 1}</span><span><strong>Message {index + 1}</strong><small>{MIDI_MESSAGE_TYPES[laneType] ?? "Unknown"}</small></span><i/></button>;
    })}</div>

    <div className="midi-message-editor">
      <div className="midi-message-editor__toolbar"><div><small>EDITING MESSAGE {lane + 1}</small><strong>{alternate ? "Alternate state" : "Primary state"}</strong></div><div className="midi-state-switcher"><button type="button" className={!alternate ? "active" : ""} onClick={() => setAlternate(false)}>Primary</button>{altEnabled ? <button type="button" className={alternate ? "active alternate" : ""} onClick={() => setAlternate(true)}>Alternate</button> : <button type="button" className="add" onClick={() => { void toggleAlternate(true); setAlternate(true); }}><Plus size={13}/>Add alternate</button>}<Switch label="Enable alternate MIDI state" checked={altEnabled} onCheckedChange={(enabled) => void toggleAlternate(enabled)}/></div></div>
      <ReflectionEditor appearance="settings" columns="compact" path={MIDI_OUT_PATH} object={object} include={fields} labels={labels} refreshPage="settings" emptyText="The connected firmware did not expose this message slot."/>
      <div className="midi-message-help"><span>{type === 0 ? "Choose a message type to reveal its channel and data controls." : type === 1 ? "Program Change uses optional bank MSB/LSB values; Off is represented by −1 on the device." : type === 2 ? "Control Change sends a controller number and value from 0–127." : "Note messages send note and velocity values from 0–127."}</span><Badge tone={type === 0 ? "neutral" : "green"}>{type === 0 ? "EMPTY" : "READY"}</Badge></div>
    </div>

    {feedback && <div className="midi-action-feedback" role="status">{feedback}</div>}
  </Card>;
}

export { fieldsForMessage, midiField };
