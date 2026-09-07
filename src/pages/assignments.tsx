import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  CircleOff,
  Edit3,
  Layers3,
  Link2,
  MoveVertical,
  Palette,
  Play,
  Plus,
  Power,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Badge, Button, Card, Dialog, IconButton, Input, Switch, Tabs } from "../components/ui";
import { colorForIndex } from "../domain/headrush-reflection";
import { expressionPedalCapabilities } from "../domain/expression-pedal";
import { ReflectionEditor } from "../components/system/reflection-editor";
import { deviceApi } from "../services/device-api";
import { deviceErrorDetail } from "../services/device-errors";
import { useAppStore } from "../stores/app-store";
import { PageTitle } from "../components/system/page-title";
import "../styles/assignments-upgrades.css";
import "../styles/assignment-studio.css";
import "../styles/expression-studio.css";

const FOOTSWITCH = "/Evil/Engine/FootSwitch";
const SCENE_LETTERS = "ABCDEF";
const SCENE_MODES = ["FOLLOW RIG", "ON", "OFF"] as const;
const COLORS = ["Neutral", "Green", "Dark green", "Amber", "Orange", "Red", "Pink", "Violet", "Blue", "Cyan", "White", "Grey", "Aqua", "Black"];
const MODE_LABELS = ["Toggle", "Hold", "Scene"] as const;
const SCENE_ROUTING = [null, { before: 3, branch: 4, after: 3 }, { before: 5, branch: 3, after: 3 }, { before: 7, branch: 2, after: 3 }, { before: 0, branch: 7, after: 0 }] as const;
const ROUTING_LABELS = ["Straight", "Middle split 3-4-3", "Middle split 5-3-3", "Middle split 7-2-3", "Immediate split"];
const asList = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
const numeric = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function useFootswitchWriter(source: string) {
  const store = useAppStore();
  const [busy, setBusy] = useState(false);
  const write = async (properties: Record<string, unknown>) => {
    setBusy(true);
    try {
      await deviceApi.setProperties(FOOTSWITCH, properties);
      await store.refreshPage(store.page, "manual");
    } catch (error) {
      store.addDiagnostic({ level: "warning", source, message: "Could not update rig control assignment", detail: deviceErrorDetail(error) });
    } finally { setBusy(false); }
  };
  return { busy, write };
}

type AssignmentPicker = { number: number; step: "module" | "operation" | "appearance" };
type OperationChoice = { label: string; isDisabled: boolean };

export function FootswitchAssignmentsPanel() {
  const store = useAppStore();
  const fs = store.liveSubtree?.[FOOTSWITCH]?.value ?? {};
  const rig = store.liveSnapshot?.rig ?? store.rigs[0];
  const [bank, setBank] = useState<"A" | "B">("A");
  const [picker, setPicker] = useState<AssignmentPicker | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [draftModules, setDraftModules] = useState<Record<number, string>>({});
  const [operations, setOperations] = useState<Record<number, OperationChoice[]>>({});
  const [operationBusy, setOperationBusy] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [sceneEditor, setSceneEditor] = useState<number | null>(null);
  const { busy, write } = useFootswitchWriter("Footswitches");
  const virtualSlots = bank === "A" ? [1, 2, 3] : [4, 5, 6];
  const rigModuleNames = new Set((rig?.blocks ?? []).filter((block) => !block.empty).map((block) => block.name));

  const closePicker = () => { setPicker(null); setPickerQuery(""); };
  const openPicker = (number: number, step: AssignmentPicker["step"]) => {
    setPicker({ number, step });
    setPickerQuery("");
  };
  const chooseModule = async (number: number, module: string) => {
    if (module === "Unassigned") {
      await write({ [`Module${number}`]: module, [`Operation${number}`]: "" });
      closePicker();
      return;
    }
    setDraftModules((current) => ({ ...current, [number]: module }));
    setPicker({ number, step: "operation" });
    setPickerQuery("");
    setOperationBusy(number);
    try {
      const choices = await deviceApi.footswitchOperations(number - 1, module);
      const currentOperation = String(fs[`Operation${number}`] ?? "");
      const nextChoices = choices.length ? choices : currentOperation ? [{ label: currentOperation, isDisabled: false }] : [];
      setOperations((current) => ({ ...current, [number]: nextChoices }));
      const available = nextChoices.filter((choice) => !choice.isDisabled);
      if (available.length === 1) {
        await write({ [`Module${number}`]: module, [`Operation${number}`]: available[0].label });
        closePicker();
      }
    } catch (error) {
      store.addDiagnostic({ level: "warning", source: "Footswitches", message: `Could not load actions for ${module}`, detail: deviceErrorDetail(error) });
      setOperations((current) => ({ ...current, [number]: [] }));
    } finally { setOperationBusy(null); }
  };
  const moveAssignment = async (number: number, direction: -1 | 1) => {
    const target = number + direction;
    if (!virtualSlots.includes(target)) return;
    try {
      await deviceApi.callMethod(FOOTSWITCH, "moveAssignment", [number - 1, target - 1]);
      await store.refreshPage(store.page, "manual");
    } catch (error) {
      store.addDiagnostic({ level: "warning", source: "Footswitches", message: "Could not move assignment", detail: deviceErrorDetail(error) });
    }
  };

  return <div className="rig-controls-panel assignment-studio">
    <div className="rig-controls-heading assignment-studio__heading">
      <div><span className="eyebrow">PHYSICAL CONTROLS</span><h3>Footswitch assignment studio</h3><p>Choose a behavior first. RushLink only reveals the choices that apply to it.</p></div>
      <Tabs value={bank} onValueChange={(next) => { setBank(next); closePicker(); }} items={[{ value: "A", label: "Bank A" }, { value: "B", label: "Bank B" }]} />
    </div>
    <div className="footswitch-board footswitch-board--editor footswitch-board--smart">{virtualSlots.map((number, physicalIndex) => {
      const mode = numeric(fs[`ModeNew${number}`]);
      const module = String(fs[`Module${number}`] ?? "Unassigned");
      const operation = String(fs[`Operation${number}`] ?? "");
      const label = String(fs[`FootSwitchText${number}`] ?? `FS ${number}`);
      const colorIndex = numeric(fs[`FootSwitchColour${number}`]);
      const enabled = fs[`FootSwitchOn${number}`] === true;
      const canEditLabel = fs[`FootSwitchTextEditable${number}`] !== false;
      const sceneIndex = number - 1;
      const sceneOverrides = Array.from({ length: 14 }, (_, index) => numeric(fs[`Scene${number}_${index + 1}_Mode`])).filter(Boolean).length;
      const isPickerOpen = picker?.number === number;
      const moduleChoices = asList(fs[`ModuleList${number}`]).filter((item) => item.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase()));
      const operationChoices = operations[number] ?? [];
      return <Card className={`smart-footswitch ${enabled ? "enabled" : "disabled"} ${isPickerOpen ? "editing" : ""}`} key={number} style={{ "--block-color": colorForIndex(colorIndex) } as CSSProperties}>
        <div className="smart-footswitch__top">
          <span><b>SWITCH {physicalIndex + 1}</b><small>BANK {bank}</small></span>
          <div className="smart-footswitch__move">
            <IconButton label="Move assignment left" disabled={physicalIndex === 0 || busy} onClick={() => void moveAssignment(number, -1)}><ArrowLeft size={13} /></IconButton>
            <IconButton label="Move assignment right" disabled={physicalIndex === 2 || busy} onClick={() => void moveAssignment(number, 1)}><ArrowRight size={13} /></IconButton>
          </div>
          <Switch checked={enabled} disabled={busy} label={`Enable switch ${physicalIndex + 1}`} onCheckedChange={(next) => void write({ [`FootSwitchOn${number}`]: next })} />
        </div>
        <div className="smart-footswitch__identity">
          <span className="footswitch-ring"><i /></span>
          <div>
            {editingLabel === number ? <Input autoFocus defaultValue={label} maxLength={24} aria-label={`Switch ${physicalIndex + 1} label`} onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setEditingLabel(null);
            }} onBlur={(event) => { setEditingLabel(null); if (event.target.value !== label) void write({ [`UserFootSwitchText${number}`]: event.target.value.toUpperCase() }); }} /> : <button className="smart-footswitch__label" onClick={() => canEditLabel && setEditingLabel(number)} disabled={!canEditLabel}><strong>{label}</strong>{canEditLabel && <Edit3 size={12} />}</button>}
            <span>{mode === 2 ? `Scene ${SCENE_LETTERS[sceneIndex]} · ${sceneOverrides} overrides` : module === "Unassigned" ? "No action assigned" : `${module} · ${operation || "Choose action"}`}</span>
          </div>
        </div>
        <div className="assignment-mode-switch" role="radiogroup" aria-label={`Switch ${physicalIndex + 1} behavior`}>{MODE_LABELS.map((modeLabel, modeIndex) => <button key={modeLabel} className={mode === modeIndex ? "active" : ""} onClick={() => void write({ [`ModeNew${number}`]: modeIndex })} disabled={busy} role="radio" aria-checked={mode === modeIndex}>{modeIndex === 2 ? <Sparkles size={12} /> : modeIndex === 1 ? <SlidersHorizontal size={12} /> : <Power size={12} />}{modeLabel}</button>)}</div>
        <div className="smart-footswitch__actions">
          {mode === 2 ? <button className="assignment-primary-action scene-link" onClick={() => setSceneEditor(number)}><span><Sparkles size={15} /><b>Edit Scene {SCENE_LETTERS[sceneIndex]}</b><small>{fs[`SceneActive${number}`] === true ? "Active on device" : `${sceneOverrides} block overrides`}</small></span><ChevronRight size={15} /></button> : <button className="assignment-primary-action" onClick={() => openPicker(number, "module")}><span><SlidersHorizontal size={15} /><b>{module === "Unassigned" ? "Assign an action" : module}</b><small>{module === "Unassigned" ? "Effect, utility or MIDI" : operation || "Choose action"}</small></span><ChevronRight size={15} /></button>}
          <IconButton label="Choose LED color" onClick={() => openPicker(number, "appearance")}><Palette size={15} /></IconButton>
        </div>
        {isPickerOpen && <div className="assignment-picker">
          <div className="assignment-picker__head"><span><b>{picker.step === "module" ? "Choose target" : picker.step === "operation" ? `What should ${draftModules[number] ?? module} do?` : "Switch appearance"}</b><small>{picker.step === "module" ? "Rig blocks are shown first" : picker.step === "operation" ? "Only device-supported actions are listed" : "Changes the hardware LED ring"}</small></span><IconButton label="Close picker" onClick={closePicker}><X size={14} /></IconButton></div>
          {picker.step === "module" && <><label className="assignment-picker__search"><Search size={13} /><Input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="Find an effect or utility…" /></label><div className="assignment-choice-list">{moduleChoices.sort((a, b) => Number(rigModuleNames.has(b)) - Number(rigModuleNames.has(a))).map((choice) => <button key={choice} className={rigModuleNames.has(choice) ? "on-rig" : ""} onClick={() => void chooseModule(number, choice)}><span className="assignment-choice-icon">{choice === "Unassigned" ? <CircleOff size={14} /> : <SlidersHorizontal size={14} />}</span><span><b>{choice}</b><small>{rigModuleNames.has(choice) ? "In current rig" : choice === "Unassigned" ? "Clear assignment" : "Device utility"}</small></span>{choice === module ? <Check size={14} /> : <ChevronRight size={14} />}</button>)}</div></>}
          {picker.step === "operation" && <div className="assignment-operation-list">{operationBusy === number ? <span className="assignment-picker__loading">Reading supported actions…</span> : operationChoices.length ? operationChoices.map((choice) => <button key={choice.label} disabled={choice.isDisabled || busy} className={choice.label === operation ? "active" : ""} onClick={() => void write({ [`Module${number}`]: draftModules[number] ?? module, [`Operation${number}`]: choice.label }).then(closePicker)}><span>{choice.label}</span>{choice.label === operation && <Check size={14} />}</button>) : <span className="assignment-picker__loading">No actions were reported for this target.</span>}</div>}
          {picker.step === "appearance" && <div className="assignment-color-grid">{COLORS.map((color, index) => <button key={color} className={colorIndex === index ? "active" : ""} style={{ "--choice-color": colorForIndex(index) } as CSSProperties} title={color} aria-label={color} onClick={() => void write({ [`FootSwitchColour${number}`]: index }).then(closePicker)}><i />{colorIndex === index && <Check size={11} />}</button>)}</div>}
        </div>}
      </Card>;
    })}</div>
    <Dialog open={sceneEditor !== null} onClose={() => setSceneEditor(null)} title={`Scene ${sceneEditor === null ? "" : SCENE_LETTERS[sceneEditor - 1]}`} description="Edit this footswitch scene without leaving hardware assignment." width="1260px" footer={<Button variant="primary" onClick={() => setSceneEditor(null)}>Done</Button>}>
      <div className="scene-assignment-dialog">{sceneEditor !== null && <SceneAssignmentsPanel initialScene={sceneEditor} />}</div>
    </Dialog>
  </div>;
}

type PresetPicker = { slot: number; effect: string; current: string };

export function SceneAssignmentsPanel({ initialScene = 1 }: { initialScene?: number } = {}) {
  const store = useAppStore();
  const fs = store.liveSubtree?.[FOOTSWITCH]?.value ?? {};
  const rig = store.liveSnapshot?.rig ?? store.rigs[0];
  const [scene, setScene] = useState(Math.max(1, Math.min(6, initialScene)));
  const [sceneState, setSceneState] = useState<1 | 2>(1);
  const [presetPicker, setPresetPicker] = useState<PresetPicker | null>(null);
  const [presetOptions, setPresetOptions] = useState<string[]>([]);
  const [presetQuery, setPresetQuery] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const { busy, write } = useFootswitchWriter("Scenes");
  const statePrefix = sceneState === 2 ? "State2" : "";
  const numberOfStates = numeric(fs[`SceneNumberOfStates${scene}`], 1) === 2 ? 2 : 1;
  const activeScene = numeric(fs.LastScene, -1) + 1;

  const sceneCounts = (sceneNumber: number, state: 1 | 2 = 1) => {
    const prefix = state === 2 ? "State2" : "";
    const counts = { follow: 0, on: 0, off: 0 };
    for (let slot = 1; slot <= 14; slot += 1) {
      const block = rig?.blocks[slot - 1];
      if (!block || block.empty) continue;
      const mode = numeric(fs[`${prefix}Scene${sceneNumber}_${slot}_Mode`]);
      if (mode === 1) counts.on += 1;
      else if (mode === 2) counts.off += 1;
      else counts.follow += 1;
    }
    return counts;
  };
  const selectedCounts = sceneCounts(scene, sceneState);
  const chooseScene = (nextScene: number) => {
    setScene(nextScene);
    setSceneState(numeric(fs[`SceneState${nextScene}`]) === 1 && numeric(fs[`SceneNumberOfStates${nextScene}`], 1) === 2 ? 2 : 1);
    setPresetPicker(null);
  };
  const chooseState = (state: 1 | 2) => {
    setSceneState(state);
    setPresetPicker(null);
    void write({ [`SceneState${scene}`]: state - 1 });
  };
  const addSecondState = async () => {
    try {
      await deviceApi.callMethod(FOOTSWITCH, "createNewSceneState", [scene - 1, 0]);
      await write({ [`SceneNumberOfStates${scene}`]: 2, [`SceneState${scene}`]: 1 });
      setSceneState(2);
    } catch (error) {
      store.addDiagnostic({ level: "warning", source: "Scenes", message: "Could not create alternate scene state", detail: deviceErrorDetail(error) });
    }
  };
  const recallScene = () => void write({ LastScene: scene - 1, LastSceneState: sceneState - 1 });
  const applyModesFromRig = () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) {
      const block = rig?.blocks[index];
      if (block && !block.empty) properties[`${statePrefix}Scene${scene}_${index + 1}_Mode`] = block.enabled === false ? 2 : 1;
    }
    void write(properties);
  };
  const clearModes = () => {
    const properties = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`${statePrefix}Scene${scene}_${index + 1}_Mode`, 0]));
    void write(properties);
  };
  const openPresetPicker = async (slot: number, effect: string, current: string) => {
    setPresetPicker({ slot, effect, current });
    setPresetQuery("");
    setPresetOptions([...new Set(["No Preset", current].filter(Boolean))]);
    setPresetBusy(true);
    try {
      const presets = await deviceApi.blockPresets(effect);
      setPresetOptions([...new Set(["No Preset", current, ...presets].filter(Boolean))]);
    } catch (error) {
      store.addDiagnostic({ level: "warning", source: "Scenes", message: `Could not load presets for ${effect}`, detail: deviceErrorDetail(error) });
    } finally { setPresetBusy(false); }
  };
  const chain = store.liveSubtree?.["/Evil/Engine/Patch/Chain"]?.value ?? {};
  const routing = numeric(chain.Routing);
  const sceneActionRows = [
    fs.AnySwitchDoubling === true && { label: "Doubling", key: `${statePrefix}SceneDoubleSwitch${scene}`, options: ["No change", "A", "B"] },
    routing >= 1 && routing <= 4 && `${statePrefix}ScenePathSwitch${scene}` in fs && { label: "Path", key: `${statePrefix}ScenePathSwitch${scene}`, options: ["No change", "A", "B"] },
    `${statePrefix}SceneExtAmp${scene}` in fs && { label: "Ext amp", key: `${statePrefix}SceneExtAmp${scene}`, options: ["No change", "None", "Tip", "Ring", "Both"] },
  ].filter(Boolean) as Array<{ label: string; key: string; options: string[] }>;
  const sceneLedKey = `${statePrefix}MacroColour${scene}`;
  const sceneLed = Math.max(0, numeric(fs[sceneLedKey], 1) - 1);

  const renderSlot = (index: number) => {
    const slot = index + 1;
    const modeKey = `${statePrefix}Scene${scene}_${slot}_Mode`;
    const presetKey = `${statePrefix}Scene${scene}Slot${slot}Preset`;
    const mode = numeric(fs[modeKey]);
    const preset = String(fs[presetKey] ?? "No Preset");
    const block = rig?.blocks[index];
    const effect = block?.name ?? String(fs[`${statePrefix}Scene${scene}_${slot}_Effect`] ?? "Empty Slot");
    const empty = !block || block.empty === true;
    return <Card key={slot} className={`visual-scene-slot scene-state--${mode} ${empty ? "empty" : ""}`} style={{ "--scene-block-color": block?.color ?? "#566273" } as CSSProperties}>
      <div className="visual-scene-slot__head"><span>{slot.toString().padStart(2, "0")}</span><i />{mode > 0 && <b>{mode === 1 ? "FORCE ON" : "FORCE OFF"}</b>}</div>
      <strong>{empty ? "Empty" : effect}</strong>
      {!empty && <>
        <div className="scene-mode-buttons" role="radiogroup" aria-label={`${effect} scene state`}>{SCENE_MODES.map((label, modeIndex) => <button key={label} className={mode === modeIndex ? "active" : ""} onClick={() => void write({ [modeKey]: modeIndex })} disabled={busy} aria-label={label} title={label} role="radio" aria-checked={mode === modeIndex}>{modeIndex === 0 ? "—" : modeIndex === 1 ? "ON" : "OFF"}</button>)}</div>
        <button className={`scene-preset-trigger ${preset !== "No Preset" ? "set" : ""}`} onClick={() => void openPresetPicker(slot, effect, preset)}><span>{preset || "No Preset"}</span><ChevronRight size={11} /></button>
      </>}
    </Card>;
  };
  const routeConfig = SCENE_ROUTING[routing] ?? null;
  // Keep all five topology cells mounted, even for Immediate Split. Omitting
  // an empty serial section shifts the junctions into the wrong CSS columns.
  const renderSegment = (start: number, count: number, label: string, className = "") => <section
    className={`visual-scene-segment ${className} ${count === 0 ? "is-empty" : ""}`}
    style={{ "--scene-columns": Math.max(1, count) } as CSSProperties}
    aria-hidden={count === 0 ? true : undefined}
  >
    {count > 0 && <><small>{label}</small><div>{Array.from({ length: count }, (_, offset) => renderSlot(start + offset))}</div></>}
  </section>;
  const renderLiveChain = () => {
    if (!routeConfig) return <div className="visual-scene-chain visual-scene-chain--straight"><div className="visual-scene-row">{Array.from({ length: 7 }, (_, index) => renderSlot(index))}</div><div className="visual-scene-turn" aria-label="Signal path continues from slot 7 to slot 8"><span>07</span><b><ArrowRight size={12} /> SIGNAL CONTINUES</b><span>08</span></div><div className="visual-scene-row">{Array.from({ length: 7 }, (_, index) => renderSlot(index + 7))}</div></div>;
    const branchAStart = routeConfig.before;
    const branchBStart = branchAStart + routeConfig.branch;
    const afterStart = branchBStart + routeConfig.branch;
    return <div className="visual-scene-chain visual-scene-chain--split">
      {renderSegment(0, routeConfig.before, "SERIAL · BEFORE SPLIT", "before")}
      <div className="visual-scene-split-node" aria-label="Signal splits into paths A and B">
        <svg viewBox="0 0 40 284" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 0 152 H 10 C 27 152 22 82 40 82 M 10 152 C 27 152 22 222 40 222" />
          <circle cx="10" cy="152" r="2.5" />
        </svg>
        <span>SPLIT</span>
      </div>
      <div className="visual-scene-branches">
        {renderSegment(branchAStart, routeConfig.branch, "PATH A", "branch-a")}
        {renderSegment(branchBStart, routeConfig.branch, "PATH B", "branch-b")}
      </div>
      <div className="visual-scene-merge-node" aria-label="Paths A and B merge into the serial path">
        <svg viewBox="0 0 40 284" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 0 82 C 18 82 13 152 30 152 H 40 M 0 222 C 18 222 13 152 30 152" />
          <circle cx="30" cy="152" r="2.5" />
        </svg>
        <span>MERGE</span>
      </div>
      {renderSegment(afterStart, routeConfig.after, "SERIAL · AFTER MERGE", "after")}
    </div>;
  };

  return <div className="rig-controls-panel visual-scene-editor">
    <div className="scene-browser-strip" role="tablist" aria-label="Scenes">{Array.from({ length: 6 }, (_, index) => {
      const sceneNumber = index + 1;
      const counts = sceneCounts(sceneNumber);
      const isActive = activeScene === sceneNumber || fs[`SceneActive${sceneNumber}`] === true;
      const sceneColor = colorForIndex(Math.max(0, numeric(fs[`MacroColour${sceneNumber}`], 1) - 1));
      return <button key={sceneNumber} role="tab" aria-selected={scene === sceneNumber} className={`${scene === sceneNumber ? "selected" : ""} ${isActive ? "live" : ""}`} style={{ "--scene-color": sceneColor } as CSSProperties} onClick={() => chooseScene(sceneNumber)}>
        <span className="scene-browser-strip__letter">{SCENE_LETTERS[index]}</span>
        <span><strong>{String(fs[`FootSwitchText${sceneNumber}`] ?? `Scene ${SCENE_LETTERS[index]}`)}</strong><small>{counts.on + counts.off ? `${counts.on} on · ${counts.off} off` : "Follows current rig"}</small></span>
        {numeric(fs[`SceneNumberOfStates${sceneNumber}`], 1) === 2 && <Badge tone="violet">A/B</Badge>}
        {isActive && <i>LIVE</i>}
      </button>;
    })}</div>

    <Card className="visual-scene-toolbar">
      <div className="visual-scene-toolbar__title"><span className="scene-hero-letter" style={{ "--scene-color": colorForIndex(sceneLed) } as CSSProperties}>{SCENE_LETTERS[scene - 1]}</span><div><span className="eyebrow">SCENE WORKBENCH</span><h2>{String(fs[`FootSwitchText${scene}`] ?? `Scene ${SCENE_LETTERS[scene - 1]}`)}</h2><p>{selectedCounts.on} forced on · {selectedCounts.off} forced off · {selectedCounts.follow} follow the rig</p></div></div>
      <div className="scene-state-switcher"><span>State</span><button className={sceneState === 1 ? "active" : ""} onClick={() => chooseState(1)}>A</button>{numberOfStates === 2 ? <button className={sceneState === 2 ? "active" : ""} onClick={() => chooseState(2)}>B</button> : <button className="add" onClick={() => void addSecondState()} disabled={busy}><Plus size={12} /> Add B</button>}</div>
      <div className="visual-scene-toolbar__actions"><Button size="sm" onClick={applyModesFromRig} disabled={busy}>Match rig</Button><Button size="sm" variant="ghost" onClick={clearModes} disabled={busy}>Clear overrides</Button><Button size="sm" variant="primary" onClick={recallScene} loading={busy}><Play size={14} /> Recall on device</Button></div>
    </Card>

    <Card className="visual-scene-chain-card">
      <div className="visual-scene-chain-card__head"><div><strong>Current rig signal path</strong><span>Live blocks and routing from {rig?.name ?? "the device"}; scene controls only change recall state.</span></div><div className="scene-chain-status"><Badge tone="green">LIVE RIG</Badge><Badge tone="cyan">{ROUTING_LABELS[routing] ?? `Routing ${routing}`}</Badge><div className="scene-legend"><span><i className="follow" /> Follow</span><span><i className="on" /> On</span><span><i className="off" /> Off</span></div></div></div>
      <div className="visual-scene-chain-scroll">{renderLiveChain()}</div>
      {presetPicker && <div className="scene-preset-picker">
        <div className="scene-preset-picker__head"><span><b>{presetPicker.effect}</b><small>Preset for slot {presetPicker.slot} in Scene {SCENE_LETTERS[scene - 1]} / {sceneState === 1 ? "A" : "B"}</small></span><label><Search size={13} /><Input value={presetQuery} onChange={(event) => setPresetQuery(event.target.value)} placeholder="Filter presets…" /></label><IconButton label="Close presets" onClick={() => setPresetPicker(null)}><X size={14} /></IconButton></div>
        <div className="scene-preset-options">{presetOptions.filter((preset) => preset.toLocaleLowerCase().includes(presetQuery.toLocaleLowerCase())).map((preset) => <button key={preset} className={presetPicker.current === preset ? "active" : ""} onClick={() => void write({ [`${statePrefix}Scene${scene}Slot${presetPicker.slot}Preset`]: preset }).then(() => setPresetPicker(null))}><span>{preset}</span>{presetPicker.current === preset && <Check size={13} />}</button>)}{presetBusy && <span>Loading device presets…</span>}</div>
      </div>}
    </Card>

    <Card className="scene-behavior-panel">
      <div><span className="eyebrow">SCENE BEHAVIOR</span><strong>Only supported controls are shown</strong><small>These actions happen alongside the block changes when the scene is recalled.</small></div>
      <label className="scene-led-picker"><span>LED</span>{COLORS.slice(0, 9).map((color, index) => <button key={color} className={sceneLed === index ? "active" : ""} style={{ "--choice-color": colorForIndex(index) } as CSSProperties} title={color} onClick={() => void write({ [sceneLedKey]: index + 1 })}><i /></button>)}</label>
      {sceneActionRows.map((row) => <div className="scene-action-row" key={row.key}><span>{row.label}</span><div>{row.options.map((option, index) => <button key={option} className={numeric(fs[row.key]) === index ? "active" : ""} onClick={() => void write({ [row.key]: index })}>{option}</button>)}</div></div>)}
    </Card>

    <Card className="scene-save-strip"><Layers3 size={19} /><div><strong>{numberOfStates === 2 ? "Two-state scene" : "Single-state scene"}</strong><span>Scene assignments are stored with {rig?.name ?? "the current rig"}.</span></div><Button variant="primary" onClick={() => void store.saveCurrentRig()}><Save size={15} /> Save rig</Button></Card>
  </div>;
}

export function ExpressionAssignmentsPanel() {
  const store = useAppStore(); const tree = store.liveSubtree ?? {};
  const [selectedPedal, setSelectedPedal] = useState<1 | 2>(1);
  const [openAssignment, setOpenAssignment] = useState<number | null>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const path = `/Evil/Engine/Pedal${selectedPedal}`;
  const object = tree[path];
  const values = object?.value ?? {};
  const pedalMode = selectedPedal === 1 ? Math.max(0, Math.min(2, numeric(values.PedalMode))) : null;
  const modeName = pedalMode === 0 ? "Classic" : pedalMode === 1 ? "Advanced" : pedalMode === 2 ? "Auto-Engage" : "External";
  const capabilities = expressionPedalCapabilities(selectedPedal, pedalMode as 0 | 1 | 2 | null);
  const percentage = (value: unknown, fallback: number) => { const parsed = numeric(value, fallback); return Math.round(parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed); };
  const write = async (property: string, value: unknown) => {
    setBusy(property);
    try { await deviceApi.setProperties(path, { [property]: value }); await store.refreshPage("editor", "manual"); }
    catch (error) { store.addDiagnostic({ level: "warning", source: "Expression", message: `Could not update ${property}`, detail: deviceErrorDetail(error) }); }
    finally { setBusy(null); }
  };
  const assignments = Array.from({ length: 4 }, (_, offset) => {
    const number = offset + 1; const module = String(values[`Module${number}`] ?? "").trim(); const parameter = String(values[`Param${number}`] ?? "").trim();
    return { number, module, parameter, min: percentage(values[`Min${number}`], 0), max: percentage(values[`Max${number}`], 100), colour: colorForIndex(numeric(values[`AssignmentColour${number}`], selectedPedal === 1 ? 9 : 8)), assigned: Boolean((module && module.toLocaleLowerCase() !== "unassigned") || parameter) };
  });
  const visibleAssignments = assignments.slice(0, capabilities.assignmentLimit);
  const assignedCount = visibleAssignments.filter((assignment) => assignment.assigned).length;

  return <div className="expression-studio rig-controls-panel">
    <div className="expression-studio__hero"><span><MoveVertical size={20}/></span><div><span className="eyebrow">EXPRESSION WORKSPACE</span><h3>Shape movement, not menus</h3><p>Configure pedal mode, engage behaviour and parameter ranges with every change written directly to the current rig.</p></div><Badge tone={store.liveSnapshot ? "green" : "neutral"}>{store.liveSnapshot ? "LIVE DEVICE" : "OFFLINE"}</Badge></div>
    <div className="expression-pedal-tabs">{([1, 2] as const).map((pedalNumber) => { const pedalPath = `/Evil/Engine/Pedal${pedalNumber}`; const pedalValues = tree[pedalPath]?.value ?? {}; const modeIndex = pedalNumber === 1 ? Math.max(0, Math.min(2, numeric(pedalValues.PedalMode))) as 0 | 1 | 2 : null; const pedalCapabilities = expressionPedalCapabilities(pedalNumber, modeIndex); const count = Array.from({ length: pedalCapabilities.assignmentLimit }, (_, index) => { const module = String(pedalValues[`Module${index + 1}`] ?? "").trim(); const parameter = String(pedalValues[`Param${index + 1}`] ?? "").trim(); return Boolean((module && module.toLocaleLowerCase() !== "unassigned") || parameter); }).filter(Boolean).length; const mode = pedalNumber === 1 ? ["CLASSIC", "ADVANCED", "AUTO-ENGAGE"][modeIndex ?? 0] : "EXTERNAL"; return <button key={pedalNumber} className={selectedPedal === pedalNumber ? "active" : ""} onClick={() => { setSelectedPedal(pedalNumber); setOpenAssignment(1); }}><div className={`expression-pedal-mini ${pedalNumber === 2 ? "violet" : "cyan"}`}><span/><i/></div><span><small>PEDAL {pedalNumber === 1 ? "A" : "B"}</small><strong>{pedalNumber === 1 ? "Onboard expression" : "External expression"}</strong><em>{mode} · {count}/{pedalCapabilities.assignmentLimit} assignments</em></span><ChevronRight size={16}/></button>; })}</div>
    <div className="expression-studio__workspace">
      <Card className={`expression-pedal-stage expression-pedal-stage--${selectedPedal === 1 ? "cyan" : "violet"}`}><div className="expression-pedal-stage__top"><div className="expression-pedal-modern"><span className="expression-pedal-modern__tread"><i/><i/><i/><i/><i/></span><b>{selectedPedal === 1 ? "A" : "B"}</b><small>HEEL</small><em>TOE</em></div><div><Badge tone={selectedPedal === 1 ? "cyan" : "violet"}>PEDAL {selectedPedal === 1 ? "A" : "B"}</Badge><h2>{selectedPedal === 1 ? "Onboard expression" : "External expression"}</h2><p>{capabilities.description}</p></div><div className={`expression-pedal-stats ${capabilities.supportsAutoEngage ? "" : "expression-pedal-stats--two"}`}><span><b>{modeName}</b><small>MODE</small></span><span><b>{assignedCount}/{capabilities.assignmentLimit}</b><small>MAPPED</small></span>{capabilities.supportsAutoEngage && <span><b>{numeric(values.AutoEngageDelay)} ms</b><small>ENGAGE</small></span>}</div></div></Card>
      <div className="expression-pedal-config">
        {selectedPedal === 1 && <Card className="expression-mode-card"><div className="expression-section-title"><span><CircleGauge size={16}/></span><div><strong>Pedal mode</strong><small>Choose how the toe switch and assignments behave.</small></div>{busy === "PedalMode" && <Badge tone="cyan">WRITING</Badge>}</div><div className="expression-mode-picker">{[{ name: "Classic", detail: "One parameter per A/B bank", icon: "1×" }, { name: "Advanced", detail: "Up to four parameters per bank", icon: "4×" }, { name: "Auto-Engage", detail: "Movement activates one target", icon: "AUTO" }].map((mode, index) => <button key={mode.name} disabled={busy !== null} className={pedalMode === index ? "active" : ""} onClick={() => { setOpenAssignment(1); void write("PedalMode", index); }}><b>{mode.icon}</b><span><strong>{mode.name}</strong><small>{mode.detail}</small></span>{pedalMode === index && <Check size={14}/>}</button>)}</div></Card>}
        {capabilities.supportsBankSwitching && <Card className="expression-engage-card expression-bank-card"><div className="expression-section-title"><span><Link2 size={16}/></span><div><strong>Pedal A/B behaviour</strong><small>Select the live bank and the bank whose assignments you are editing.</small></div></div><ReflectionEditor path={path} object={object} include={["PedalAssignment", "PedalAssignmentEdit"]} labels={{ PedalAssignment: "Live bank", PedalAssignmentEdit: "Edit bank" }} columns="compact" refreshPage="editor"/></Card>}
        {capabilities.supportsAutoEngage && <Card className="expression-engage-card"><div className="expression-section-title"><span><Sparkles size={16}/></span><div><strong>Auto-Engage behaviour</strong><small>Control where movement engages the target and how long release waits.</small></div></div><ReflectionEditor path={path} object={object} include={["AutoEngageMode", "AutoEngageDelay"]} labels={{ AutoEngageMode: "Activation point", AutoEngageDelay: "Release delay" }} columns="compact" refreshPage="editor"/></Card>}
      </div>
    </div>
    <Card className="expression-assignments"><div className="expression-assignments__head"><div><span className="eyebrow">RANGE MAPPING</span><h3>{capabilities.assignmentLimit === 1 ? "Parameter assignment" : "Parameter assignments"}</h3><p>{capabilities.assignmentLimit === 1 ? "This mode supports one target with independent heel and toe limits." : "Each lane can control a different block parameter with its own heel and toe limits."}</p></div><Badge tone={assignedCount ? "green" : "neutral"}>{assignedCount}/{capabilities.assignmentLimit} ACTIVE</Badge></div><div className="expression-assignment-list">{visibleAssignments.map((assignment) => <section key={assignment.number} className={assignment.assigned ? "assigned" : ""} style={{ "--assignment-color": assignment.colour } as CSSProperties}><button className="expression-assignment-summary" onClick={() => setOpenAssignment(openAssignment === assignment.number ? null : assignment.number)}><span className="expression-assignment-number">{assignment.number}</span><span className="expression-assignment-name"><small>{assignment.assigned ? assignment.module || "CURRENT BLOCK" : "AVAILABLE LANE"}</small><strong>{assignment.assigned ? assignment.parameter || "Choose parameter" : "Unassigned"}</strong></span><span className="expression-range-preview"><i style={{ left: `${Math.min(assignment.min, assignment.max)}%`, right: `${100 - Math.max(assignment.min, assignment.max)}%` }}/><b style={{ left: `${assignment.min}%` }}>H</b><b style={{ left: `${assignment.max}%` }}>T</b></span><span className="expression-range-values"><b>{assignment.min}%</b><i>→</i><b>{assignment.max}%</b></span><ChevronDown className={openAssignment === assignment.number ? "open" : ""} size={15}/></button>{openAssignment === assignment.number && <div className="expression-assignment-editor"><div className="expression-assignment-editor__note"><Link2 size={14}/><span><strong>Lane {assignment.number}</strong><small>Select the device module and parameter, then constrain its heel and toe values.</small></span></div><ReflectionEditor path={path} object={object} include={[`Module${assignment.number}`, `Param${assignment.number}`, `Min${assignment.number}`, `Max${assignment.number}`]} columns="compact" refreshPage="editor"/></div>}</section>)}</div></Card>
    <Card className="expression-global expression-global--modern"><div className="expression-section-title"><span><SlidersHorizontal size={16}/></span><div><strong>Global expression behaviour</strong><small>Shared device preferences. These settings are not stored separately for each rig.</small></div></div><ReflectionEditor path="/Evil/Engine/Settings/ExpressionPedal" object={tree["/Evil/Engine/Settings/ExpressionPedal"]} columns="compact" refreshPage="editor"/></Card>
  </div>;
}

export function AssignmentsPage() {
  const store = useAppStore(); const [tab, setTab] = useState<"switches" | "scenes" | "expression">("switches");
  return <div className="page assignments-page"><PageTitle eyebrow="RIG CONTROLS" title="Hardware assignments" description="The same live assignment workspace used by the Rig Editor." actions={<Badge tone={store.liveSnapshot ? "green" : "neutral"}>{store.liveSnapshot ? "LIVE FROM DEVICE" : "OFFLINE"}</Badge>} /><Tabs value={tab} onValueChange={setTab} items={[{ value: "switches", label: "Footswitches" }, { value: "scenes", label: "Scenes" }, { value: "expression", label: "Expression" }]} className="page-tabs" />{tab === "switches" && <FootswitchAssignmentsPanel />}{tab === "scenes" && <SceneAssignmentsPanel />}{tab === "expression" && <ExpressionAssignmentsPanel />}</div>;
}
