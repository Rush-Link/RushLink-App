import { useState } from "react";
import { Activity, AlertTriangle, ArrowRight, Bluetooth, Cable, Check, ChevronRight, CircleHelp, Clipboard, Cloud, Code2, Download, Gauge, Laptop, Link2, Network, Pencil, PlugZap, Radar, RefreshCw, Router, Save, Shield, Trash2, Unplug, Wifi } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { Badge, Button, Card, Input, Label, Select, Switch, Tabs } from "../components/ui";
import { ConnectionOrb } from "../components/system/controls";
import { ReflectionEditor } from "../components/system/reflection-editor";
import { MidiOutEditor } from "../components/system/midi-out-editor";
import { deviceApi } from "../services/device-api";
import { deviceErrorDetail, deviceErrorMessage } from "../services/device-errors";
import { midiConnection, useMidiConnection } from "../services/midi-connection";
import { PageTitle } from "../components/system/page-title";
import { cn } from "../lib/utils";
import "../styles/settings-modern.css";

type SettingsTab = "device" | "global" | "midi" | "editing" | "appearance" | "services";
type MidiSettingsView = "controller" | "device";
type ConnectionChoice = "discover" | "flex-prime" | "prime" | "core" | "custom";

const HEADRUSH_CONNECTION_CHOICES = [
  { id: "discover", label: "Find automatically", detail: "Scan local network", icon: Radar, address: "" },
  { id: "flex-prime", label: "Flex Prime", detail: "Full RushLink support", icon: PlugZap, address: "headrushflexprime.local" },
  { id: "prime", label: "Prime", detail: "Capability checked", icon: Router, address: "headrushprime.local" },
  { id: "core", label: "Core", detail: "Capability checked", icon: Router, address: "headrushcore.local" },
  { id: "custom", label: "Custom address", detail: "Hostname, URL or IP", icon: Pencil, address: "" },
] as const;

function choiceForAddress(address: string): ConnectionChoice {
  return HEADRUSH_CONNECTION_CHOICES.find((choice) => choice.address && choice.address.toLowerCase() === address.trim().toLowerCase())?.id ?? "custom";
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) { return <Card className="settings-section"><div className="settings-section__head"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-section__body">{children}</div></Card>; }
function SettingSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div><Switch label={title} checked={checked} onCheckedChange={onChange} /></div>; }
function DeviceSettingsPanel({ icon, eyebrow, title, description, color, children }: { icon: React.ReactNode; eyebrow: string; title: string; description: string; color: string; children: React.ReactNode }) { return <Card className="device-settings-panel" style={{ "--device-setting-color": color } as React.CSSProperties}><header><span>{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2><p>{description}</p></div><Badge tone="green">LIVE</Badge></header><div className="device-settings-panel__body">{children}</div></Card>; }
function DeviceSettingsControlGroup({ number, title, description, className, children }: { number: string; title: string; description: string; className?: string; children: React.ReactNode }) { return <section className={cn("device-settings-control-group", className)}><header><span>{number}</span><div><strong>{title}</strong><small>{description}</small></div></header>{children}</section>; }

function DeviceConnectionSettings() {
  const store = useAppStore();
  const [choice, setChoice] = useState<ConnectionChoice>(() => choiceForAddress(store.preferences.address));
  const [customAddress, setCustomAddress] = useState(() => choiceForAddress(store.preferences.address) === "custom" ? store.preferences.address : "");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<typeof deviceApi.discover>>>([]);
  const selected = HEADRUSH_CONNECTION_CHOICES.find((candidate) => candidate.id === choice)!;

  const connectTo = (target: string) => {
    const normalized = target.trim();
    if (!normalized || store.connectionBusy) return;
    store.setPreference("address", normalized);
    void store.connect(normalized);
  };
  const discover = async () => {
    setDiscovering(true); setDiscoveryError(null); setDiscovered([]);
    try {
      const devices = await deviceApi.discover();
      setDiscovered(devices);
      if (!devices.length) setDiscoveryError("No compatible HeadRush unit answered on this network.");
    } catch (error) {
      setDiscoveryError(deviceErrorMessage(error));
    } finally { setDiscovering(false); }
  };

  return <>
    <div className={cn("settings-device-status", store.device && "connected")}>
      <div className="settings-device-status__copy"><small><i aria-hidden="true"/>{store.device ? "CONNECTED HEADRUSH" : "DEVICE CONNECTION"}</small><strong>{store.device?.name ?? "Choose how to connect"}</strong><span>{store.device ? `${store.device.host} · firmware ${store.device.firmware}` : "Your choice controls which local address RushLink uses."}</span></div>
      {store.device ? <Button size="sm" variant="outline" onClick={() => void store.disconnect()}>Disconnect</Button> : <Badge>OFFLINE</Badge>}
    </div>

    <div className="settings-choice-heading"><div><span>1</span><div><strong>Select your device</strong><small>Use discovery, pick a known HeadRush model, or provide your own address.</small></div></div><Badge tone="cyan">LOCAL NETWORK</Badge></div>
    <div className="settings-device-choices" role="radiogroup" aria-label="HeadRush connection method">
      {HEADRUSH_CONNECTION_CHOICES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={choice === option.id} className={cn(choice === option.id && "selected")} onClick={() => setChoice(option.id)}>
        <span><option.icon size={20}/></span><strong>{option.label}</strong><small>{option.detail}</small>{choice === option.id && <i><Check size={11}/></i>}
      </button>)}
    </div>

    <div className="settings-connect-panel">
      {choice === "discover" && <div className="settings-discovery-workspace">
        <div className="settings-connect-copy"><span><Radar size={20}/></span><div><strong>Find a HeadRush on this network</strong><small>RushLink checks the known local addresses and shows every unit that responds.</small></div></div>
        <Button variant="primary" loading={discovering} disabled={store.connectionBusy} onClick={() => void discover()}><Wifi size={16}/>Scan for devices</Button>
        {discoveryError && <div className="settings-connect-error" role="alert"><AlertTriangle size={16}/><span>{discoveryError}</span></div>}
        {discovered.length > 0 && <div className="settings-discovered-list" aria-label="Discovered HeadRush devices">{discovered.map((device) => <button type="button" key={`${device.id}:${device.host}`} onClick={() => connectTo(device.host)} disabled={store.connectionBusy}><span><ConnectionOrb status={device.status}/></span><span><strong>{device.name}</strong><small>{device.host} · {device.model}</small></span><Badge tone="green">FOUND</Badge><ArrowRight size={16}/></button>)}</div>}
      </div>}

      {choice !== "discover" && choice !== "custom" && <div className="settings-known-device">
        <div className="settings-connect-copy"><span><selected.icon size={20}/></span><div><strong>Connect to HeadRush {selected.label}</strong><small>RushLink will use the model’s standard local-network hostname.</small></div></div>
        <div className="settings-known-address"><small>LOCAL ADDRESS</small><strong>{selected.address}</strong></div>
        <Button variant="primary" loading={store.connectionBusy} onClick={() => connectTo(selected.address)}>Connect <ArrowRight size={16}/></Button>
      </div>}

      {choice === "custom" && <form className="settings-custom-address" onSubmit={(event) => { event.preventDefault(); connectTo(customAddress); }}>
        <div className="settings-connect-copy"><span><Network size={20}/></span><div><strong>Use a custom network address</strong><small>Enter a local hostname, private IP address, or full HTTP URL.</small></div></div>
        <label htmlFor="settings-device-address"><span>HeadRush address</span><div><Network size={16}/><Input id="settings-device-address" aria-label="Custom HeadRush address" autoFocus value={customAddress} onChange={(event) => setCustomAddress(event.target.value)} placeholder="192.168.1.100 or my-headrush.local"/></div></label>
        <Button type="submit" variant="primary" loading={store.connectionBusy} disabled={!customAddress.trim()}>Connect <ArrowRight size={16}/></Button>
      </form>}
    </div>
    {(store.connectionError || discoveryError) && choice !== "discover" && <div className="settings-connect-error" role="alert"><AlertTriangle size={16}/><span><strong>Connection unsuccessful</strong><small>{store.connectionError ?? discoveryError}</small></span></div>}
  </>;
}

export function SettingsPage() {
  const store = useAppStore(); const p = store.preferences; const tree = store.liveSubtree ?? {}; const live = store.liveSnapshot; const midi = useMidiConnection(); const [tab, setTab] = useState<SettingsTab>(() => { const saved = localStorage.getItem("rushlink-settings-tab"); return (["device", "global", "midi", "editing", "appearance", "services"] as SettingsTab[]).includes(saved as SettingsTab) ? saved as SettingsTab : "device"; });
  const [midiView, setMidiView] = useState<MidiSettingsView>(() => localStorage.getItem("rushlink-midi-settings-view") === "device" ? "device" : "controller");
  const selectTab = (next: SettingsTab) => { localStorage.setItem("rushlink-settings-tab", next); setTab(next); };
  const selectMidiView = (next: MidiSettingsView) => { localStorage.setItem("rushlink-midi-settings-view", next); setMidiView(next); };
  const service = async (kind: "cloud" | "tone3000", connected: boolean) => { const path = kind === "cloud" ? "/Evil/Cloud/Master" : "/Evil/API/Tone3000"; const method = connected ? "logout" : kind === "cloud" ? "requestUserCodeForLogin" : "startLogin"; try { const result = await deviceApi.callMethod(path, method); store.addDiagnostic({ level: "info", source: "Services", message: connected ? `Signed out of ${kind}` : `Started ${kind} sign-in`, detail: JSON.stringify(result.body) }); await store.refreshPage("settings", "manual"); } catch (error) { store.addDiagnostic({ level: "warning", source: "Services", message: `Could not manage ${kind}`, detail: deviceErrorDetail(error) }); } };
  return <div className="page settings-page"><PageTitle eyebrow="RUSHLINK" title="Settings" description="Connection, reflected device settings, editing safety, appearance and cloud services." /><div className="settings-layout"><Card className="settings-nav">{([{ id: "device", label: "Device & network", icon: Router }, { id: "global", label: "Device settings", icon: Gauge }, { id: "midi", label: "MIDI", icon: Cable }, { id: "editing", label: "Editing & safety", icon: Shield }, { id: "appearance", label: "Appearance", icon: Laptop }, { id: "services", label: "Cloud services", icon: Cloud }] as const).map((item) => <button key={item.id} className={cn(tab === item.id && "active")} onClick={() => selectTab(item.id)}><item.icon size={18} /><span>{item.label}</span><ChevronRight size={15} /></button>)}</Card><section className="settings-content">
    {tab === "device" && <><SettingsSection icon={<Router size={18} />} title="Connect your HeadRush" description="Choose the unit first. A custom address field appears only when you ask for it."><DeviceConnectionSettings/></SettingsSection><SettingsSection icon={<Network size={18} />} title="Connection behavior" description="Control how RushLink finds and maintains your device session."><SettingSwitch title="Connect automatically at startup" description="Try the last selected device address when RushLink opens." checked={p.autoDiscovery ?? true} onChange={(value) => store.setPreference("autoDiscovery", value)} /><SettingSwitch title="Reconnect after an interruption" description="Restore the live session automatically if the network briefly drops." checked={p.autoReconnect ?? true} onChange={(value) => store.setPreference("autoReconnect", value)} /></SettingsSection></>}
    {tab === "global" && <div className="device-settings-workspace"><div className="device-settings-hero"><span><Gauge size={22}/></span><div><small>FLEX PRIME · DEVICE-WIDE</small><h2>Shape how the pedal behaves</h2><p>Clear groups replace the raw property list. Changes are still written directly to the connected HeadRush.</p></div><span className="device-live-apply"><PlugZap size={13}/>Live apply</span></div>
      <DeviceSettingsPanel icon={<Gauge size={20}/>} eyebrow="AUDIO SYSTEM" title="Inputs, outputs and FX loop" description="Set physical operating levels and stereo routing for the whole device." color="#5ee7f0">
        <DeviceSettingsControlGroup className="device-settings-control-group--levels" number="01" title="Inputs and operating levels" description="Choose the default rig input and match the pedal to connected equipment."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/Audio" object={tree["/Evil/Engine/Settings/Audio"]} include={["RigInput", "MainOutLevel", "FXReturnLevel"]} labels={{ RigInput: "Rig input", MainOutLevel: "Main output", FXReturnLevel: "FX return" }} refreshPage="settings" /></DeviceSettingsControlGroup>
        <DeviceSettingsControlGroup number="02" title="FX loop routing" description="Choose whether the external send and return paths operate in stereo."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/Audio" object={tree["/Evil/Engine/Settings/Audio"]} include={["ExternalSendStereo", "ExternalReturnStereo"]} refreshPage="settings" /></DeviceSettingsControlGroup>
      </DeviceSettingsPanel>
      <DeviceSettingsPanel icon={<Shield size={20}/>} eyebrow="WORKFLOW" title="Editing and footswitch behaviour" description="Control automatic assistance and the physical switch interaction model." color="#ae8cff">
        <DeviceSettingsControlGroup number="01" title="Editing assistance" description="Decide when the pedal confirms changes and creates helpful assignments."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/General" object={tree["/Evil/Engine/Settings/General"]} include={["ConfirmDirtyFlag", "AutoAssignments", "AutoAmpCab"]} refreshPage="settings" /></DeviceSettingsControlGroup>
        <DeviceSettingsControlGroup number="02" title="Performance switches" description="Configure the tempo LED, dedicated switch targets and press timing."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/General" object={tree["/Evil/Engine/Settings/General"]} include={["InvertTempoLED", "LooperFSAssignment", "TunerFSAssignment", "OnPressFS"]} refreshPage="settings" /></DeviceSettingsControlGroup>
      </DeviceSettingsPanel>
      <DeviceSettingsPanel icon={<Activity size={20}/>} eyebrow="EXPRESSION" title="Pedal behaviour" description="Device-wide expression options, including drummer intensity and tuner-at-zero." color="#59e6a6">
        <DeviceSettingsControlGroup number="01" title="Global pedal options" description="These preferences apply independently from per-rig expression assignments."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/ExpressionPedal" object={tree["/Evil/Engine/Settings/ExpressionPedal"]} refreshPage="settings" /></DeviceSettingsControlGroup>
      </DeviceSettingsPanel>
    </div>}
    {tab === "midi" && <div className="midi-settings-workspace"><div className="midi-settings-hero"><span className="midi-settings-hero__icon"><Cable size={23}/></span><div><small>MIDI CONTROL</small><h2>Controller input and HeadRush hardware</h2><p>RushLink receives external MIDI as input. Device actions travel over the reflected network API—not as MIDI sent from this app.</p></div><span className={cn("midi-header-status", midi.ready && "ready")}>{midi.ready ? "Input ready" : "Not connected"}</span></div>
      <Tabs className="midi-settings-tabs" value={midiView} onValueChange={selectMidiView} items={[{ value: "controller", label: "Controller input" }, { value: "device", label: "HeadRush hardware" }]}/>

      {midiView === "controller" && <>
      <div className="midi-signal-flow" aria-label="RushLink MIDI signal flow">
        <div><span>1</span><strong>MIDI controller</strong><small>USB, keyboard, pedal or Bluetooth</small></div><ArrowRight aria-hidden="true" size={17}/><div><span>2</span><strong>RushLink input mapping</strong><small>Matches the message to a StageHand control</small></div><ArrowRight aria-hidden="true" size={17}/><div><span>3</span><strong>Reflected device API</strong><small>Applies the supported action to HeadRush</small></div>
      </div>
      <DeviceSettingsPanel icon={<Link2 size={20}/>} eyebrow="RUSHLINK · INPUT ONLY" title="External controller input" description="Connect the keyboard, pad or foot controller that will trigger RushLink mappings." color="#67b8ff">
        <div className="midi-transport-status"><span className={cn("midi-transport-status__orb", midi.ready && "ready", midi.connecting && "connecting")}/><div><small>CONTROLLER TRANSPORT</small><strong>{midi.ready ? "MIDI connection ready" : "No controller connected"}</strong><span>{midi.status}{midi.bleDeviceName ? ` · ${midi.bleDeviceName}` : ""}</span></div><Badge tone={midi.ready ? "green" : midi.connecting ? "amber" : "neutral"}>{midi.connecting ? "CONNECTING" : midi.ready ? "ACTIVE" : "OFFLINE"}</Badge></div>
        <div className="midi-port-grid midi-port-grid--input-only"><label><span>Receive controls from</span><small>Keyboard, foot controller or all available inputs</small><Select aria-label="MIDI input" value={midi.inputId} onChange={(event) => midiConnection.selectInput(event.target.value)}><option value="all">All MIDI inputs</option>{midi.inputs.map((input) => <option key={input.id} value={input.id}>{[input.manufacturer, input.name].filter(Boolean).join(" · ") || input.id}</option>)}</Select></label></div>
        <div className="midi-transport-actions"><Button variant="primary" loading={midi.connecting} onClick={() => void midiConnection.connect()}><RefreshCw size={14}/>{midi.enabled ? "Rescan MIDI" : "Connect Web MIDI"}</Button><Button variant="outline" disabled={midi.connecting} onClick={() => void midiConnection.connectBluetooth()}><Bluetooth size={14}/>Connect Bluetooth MIDI</Button>{midi.enabled && <Button variant="ghost" onClick={() => midiConnection.disconnect()}><Unplug size={14}/>Disconnect</Button>}</div>
      </DeviceSettingsPanel>

      <div className="midi-scope-card"><div className="midi-scope-card__available"><Check size={17}/><span><strong>Available in RushLink</strong><small>External MIDI can trigger supported StageHand rig, scene, effect and device actions.</small></span></div><div className="midi-scope-card__unavailable"><AlertTriangle size={17}/><span><strong>Not available through the device API</strong><small>Looper and Practice Tool remotes remain hidden because current firmware exposes no matching HTTP control or readable state.</small></span></div></div>
      </>}

      {midiView === "device" && <>
      <div className="midi-device-boundary"><Cable size={17}/><div><strong>These are HeadRush hardware settings</strong><span>RushLink edits them through the reflected API. The pedal—not RushLink—receives, forwards or sends the configured physical MIDI messages.</span></div></div>
      <DeviceSettingsPanel icon={<Cable size={20}/>} eyebrow="HEADRUSH HARDWARE" title="Physical MIDI behaviour" description="Configure MIDI received, forwarded and emitted by the connected pedal itself." color="#ae8cff">
        <DeviceSettingsControlGroup number="01" title="Routing and clock" description="Forward incoming data and decide whether the device follows incoming MIDI clock."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/Midi" object={tree["/Evil/Engine/Settings/Midi"]} include={["MIDIThrough", "MBCIn"]} refreshPage="settings" /></DeviceSettingsControlGroup>
        <DeviceSettingsControlGroup number="02" title="Program Change" description="Choose the hardware channel and whether the pedal sends or accepts Program Change."><ReflectionEditor appearance="settings" path="/Evil/Engine/Settings/Midi" object={tree["/Evil/Engine/Settings/Midi"]} include={["Channel", "SendProgramChange", "ReceiveProgramChange"]} refreshPage="settings" /></DeviceSettingsControlGroup>
      </DeviceSettingsPanel>

      <MidiOutEditor object={tree["/Evil/Engine/MIDIOutCtrl"]}/>
      </>}
    </div>}
    {tab === "editing" && <SettingsSection icon={<Shield size={18} />} title="Write behavior" description="Choose how RushLink edits move to the device."><div className="write-mode-cards">{(["ask", "immediate", "staged"] as const).map((mode) => <button key={mode} className={cn(p.writeMode === mode && "active")} onClick={() => store.setPreference("writeMode", mode)}><span>{mode === "ask" ? <CircleHelp size={19} /> : mode === "immediate" ? <PlugZap size={19} /> : <Save size={19} />}</span><strong>{mode === "ask" ? "Ask on first edit" : mode === "immediate" ? "Write immediately" : "Stage and apply"}</strong><small>{mode === "ask" ? "Choose on the first change" : mode === "immediate" ? "Update live" : "Review a batch"}</small></button>)}</div><SettingSwitch title="Backup before destructive changes" description="Capture a restore point before deletes and restores." checked={p.autoBackup} onChange={(value) => store.setPreference("autoBackup", value)} /><SettingSwitch title="Confirm rig replacement" description="Ask before replacing a dirty rig." checked={p.confirmRigReplacement ?? true} onChange={(value) => store.setPreference("confirmRigReplacement", value)} /><SettingSwitch title="Keep operation history" description="Retain automatic rig before/after states." checked={p.keepHistory ?? true} onChange={(value) => store.setPreference("keepHistory", value)} /></SettingsSection>}
    {tab === "appearance" && <SettingsSection icon={<Laptop size={18} />} title="Interface" description="Tune RushLink for desktop, touch or stage."><Label>Control density<Select value={p.density} onChange={(event) => store.setPreference("density", event.target.value as typeof p.density)}><option value="comfortable">Comfortable</option><option value="compact">Compact desktop</option><option value="stage">Stage / touch</option></Select></Label><SettingSwitch title="Reduce motion" description="Minimize spatial transitions." checked={p.reduceMotion} onChange={(value) => store.setPreference("reduceMotion", value)} /><SettingSwitch title="High contrast" description="Increase text and border contrast." checked={p.highContrast} onChange={(value) => store.setPreference("highContrast", value)} /><SettingSwitch title="Keep display awake in StageHand" description="Prevent sleep during performance." checked={p.keepAwake} onChange={(value) => store.setPreference("keepAwake", value)} /></SettingsSection>}
    {tab === "services" && <><SettingsSection icon={<Cloud size={18} />} title="HeadRush Cloud" description="Authentication is owned by the connected unit."><div className="service-connection"><span className="service-connection__icon"><Cloud size={19} /></span><div className="service-connection__copy"><strong>HeadRush Cloud</strong><small>{live?.cloud.loggedIn ? "Signed in on Flex Prime" : "Not signed in"}</small></div><div className={cn("service-connection__status", live?.cloud.loggedIn && "connected")}><i/><span>{live?.cloud.loggedIn ? "Signed in" : "Not connected"}</span></div><Button size="sm" variant={live?.cloud.loggedIn ? "outline" : "primary"} onClick={() => void service("cloud", live?.cloud.loggedIn ?? false)}>{live?.cloud.loggedIn ? "Sign out" : "Start sign-in"}</Button></div></SettingsSection><SettingsSection icon={<Activity size={18} />} title="Tone3000" description="Live capture discovery and downloads used by TonePilot."><div className="service-connection"><span className="service-connection__icon"><Activity size={19} /></span><div className="service-connection__copy"><strong>Tone3000</strong><small>{live?.tone3000.loggedIn ? "Signed in on Flex Prime" : "Not signed in"}</small></div><div className={cn("service-connection__status", live?.tone3000.loggedIn && "connected")}><i/><span>{live?.tone3000.loggedIn ? "Signed in" : "Not connected"}</span></div><Button size="sm" variant={live?.tone3000.loggedIn ? "outline" : "primary"} onClick={() => void service("tone3000", live?.tone3000.loggedIn ?? false)}>{live?.tone3000.loggedIn ? "Sign out" : "Start sign-in"}</Button></div></SettingsSection></>}
  </section></div></div>;
}

function exportDiagnostics(value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `rushlink-diagnostics-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function DiagnosticsPage() {
  const store = useAppStore(); const { diagnostics, capabilities, device, addDiagnostic } = store; const [tab, setTab] = useState<"events" | "capabilities">("events");
  const publicCapabilities = capabilities ? { product: capabilities.product, firmware: capabilities.firmware, objectCount: capabilities.objectCount, propertyCount: capabilities.propertyCount, flags: capabilities.flags } : null;
  const report = { generatedAt: new Date().toISOString(), device, capabilities: publicCapabilities, diagnostics, sync: { source: store.lastSyncSource, objectCount: store.liveSnapshot?.objectCount } }; const copy = () => { void navigator.clipboard?.writeText(JSON.stringify(report, null, 2)); addDiagnostic({ level: "success", source: "Diagnostics", message: "Sanitized diagnostics copied" }); };
  return <div className="page"><PageTitle eyebrow="DEVICE HEALTH" title="Diagnostics" description="Review connection health, synchronization activity, device capabilities and recent app events." actions={<><Button onClick={copy}><Clipboard size={15} /> Copy report</Button><Button variant="primary" onClick={() => exportDiagnostics(report)}><Download size={15} /> Export bundle</Button></>} /><div className="diagnostic-summary"><Card><ConnectionOrb status={device?.status ?? "offline"} /><div><span>SESSION</span><strong>{device?.status ?? "Offline"}</strong><small>{device?.host ?? "No address"}</small></div></Card><Card><Code2 size={20} /><div><span>REFLECTION</span><strong>{capabilities?.objectCount ?? 0} objects</strong><small>{capabilities?.propertyCount.toLocaleString() ?? 0} properties</small></div></Card><Card><Activity size={20} /><div><span>EVENT STREAM</span><strong>{store.lastSyncSource ?? "Waiting"}</strong><small>{store.liveSnapshot?.syncedAt ? new Date(store.liveSnapshot.syncedAt).toLocaleTimeString() : "No sync"}</small></div></Card><Card><Gauge size={20} /><div><span>LATENCY</span><strong>{device?.latencyMs ?? "—"} ms</strong><small>Local network</small></div></Card></div><Tabs value={tab} onValueChange={setTab} items={[{ value: "events", label: "Event log", count: diagnostics.length }, { value: "capabilities", label: "Capabilities" }]} className="page-tabs" />
    {tab === "events" && <Card className="event-log"><div className="event-log__head"><span>TIME</span><span>LEVEL</span><span>SOURCE</span><span>EVENT</span><Button size="sm" onClick={() => store.clearDiagnostics()}><Trash2 size={13} /> Clear</Button></div>{diagnostics.map((event) => <div className="event-row" key={event.id}><code>{event.time}</code><Badge tone={event.level === "error" ? "red" : event.level === "warning" ? "amber" : event.level === "success" ? "green" : "blue"}>{event.level}</Badge><strong>{event.source}</strong><div><span>{event.message}</span>{event.detail && <small>{event.detail}</small>}</div></div>)}</Card>}
    {tab === "capabilities" && <div className="capability-layout"><Card><div className="section-heading"><div><span className="eyebrow">DETECTED PROFILE</span><h2>{capabilities?.product ?? "No device"}</h2></div><Badge tone="green">FIRMWARE {capabilities?.firmware ?? "—"}</Badge></div><div className="capability-grid">{Object.entries(capabilities?.flags ?? {}).map(([key, available]) => <div key={key}><span>{available ? <Check size={15} /> : <AlertTriangle size={15} />}</span><strong>{key.replace(/([A-Z])/g, " $1")}</strong><Badge tone={available ? "green" : "neutral"}>{available ? "YES" : "NO"}</Badge></div>)}</div></Card></div>}
  </div>;
}
