import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, CircleOff, Copy,
  FileCheck2, GripVertical, Info, ListMusic, LoaderCircle, LockKeyhole, Pencil, Plus, Radio, RefreshCw, RotateCcw,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, Trash2, Waves,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Dialog, IconButton, Input } from "../components/ui";
import { ParameterControl } from "../components/system/controls";
import {
  canPlaceTestRigBlock, reservedTestRigSlotForBlock, TEST_RIG_MAX_SLOTS, TEST_RIG_SLOT_ROLES,
  testRigSlotAllowsBlock, testRigSlotRole, validateTestRig,
} from "../domain/tone-analysis";
import { BLOCK_CATEGORY_COLORS, BLOCK_CATEGORY_GROUPS, BLOCK_CATEGORY_LABELS, blockBelongsToCategoryGroup, categoryForBlockName, type BlockCategoryGroupId } from "../domain/block-categories";
import { parametersForObject, SLOT_EQ_PROPERTIES } from "../domain/headrush-reflection";
import { testRigModulePath } from "../domain/tone-audition-chain";
import { cn } from "../lib/utils";
import { useAppStore } from "../stores/app-store";
import { deviceApi } from "../services/device-api";
import type { HeadRushSubtree, Parameter, RigBlock } from "../domain/types";
import { useSlotPointerDrag } from "../hooks/use-slot-pointer-drag";
import { SlotDragPreview } from "../components/system/slot-drag-preview";
import { WorkspacePanelToggle } from "../components/system/workspace-panel-toggle";
import { useWorkspacePanel } from "../hooks/use-workspace-panel";

const TEST_RIG_DEMO_MODULES = ["Amp", "ReValver Amp", "Cab", "IR", "Amp Clone", "Pedal Clone", "Neural Amp Modeler", "Gray Comp", "DynIII Comp", "Graphic EQ", "Ten Freq EQ", "Para EQ", "AIR Reverb", "Spring Reverb", "AIR Delay", "Tape Echo", "BBD Delay", "Reverse Delay", "Noise Filter", "Gate", "Stereo Doubler", "Green JRC-OD", "White Boost", "Tri Fuzz", "D1 Dist", "AIR Filter", "Chorus", "Multi Chorus", "Flanger", "Vibe Phaser", "Vibrato", "Rotary", "Tremolo", "Shine Wah", "Black Wah", "Wham", "Smart Harm", "Octaves", "Drop Tune", "Shimmer", "Pitch Delay", "Sustain", "Hold", "Pressor", "G EQ", "FX-Loop"];

const isNamFileParameter = (parameter: Parameter) => Boolean(parameter.deviceFile)
  || /^(?:LoadedClone|FileMissing)\d*$/i.test(parameter.sourceProperty || parameter.id);
const editableParametersFor = (block: RigBlock | null) => block?.name === "Capture slot"
  ? block.parameters.filter((parameter) => !isNamFileParameter(parameter))
  : block?.parameters ?? [];

export function TestRigParameterEditor({ parameters, onChange, onPreview }: { parameters: Parameter[]; onChange: (parameterId: string, value: Parameter["value"]) => void; onPreview?: (parameter: Parameter, value: Parameter["value"]) => Promise<void> | void }) {
  // Some dual-cab models advertise identical labels for both channels. Keep
  // reflected IDs/values intact, but make the visible controls distinguishable.
  const labels = parameters.map((parameter) => parameter.label
    .replace(/^CabType$/i, "Cabinet").replace(/^MicType$/i, "Microphone")
    .replace(/([a-z])([A-Z])/g, "$1 $2"));
  const keys = parameters.map((parameter, index) => `${parameter.deviceFile ? "file" : parameter.id.startsWith("Slt") ? "advanced" : "core"}:${labels[index]}`);
  parameters = parameters.map((parameter, index) => ({
    ...parameter,
    label: keys.filter((key) => key === keys[index]).length > 1
      ? `${labels[index]} ${keys.slice(0, index + 1).filter((key) => key === keys[index]).length}`
      : labels[index],
  }));
  const files = parameters.filter((parameter) => parameter.deviceFile);
  const advanced = parameters.filter((parameter) => !parameter.deviceFile && parameter.id.startsWith("Slt"));
  const core = parameters.filter((parameter) => !parameter.deviceFile && !parameter.id.startsWith("Slt"));
  const controls = (items: Parameter[], kind: "files" | "core" | "advanced") => <div className={`tp-parameter-grid tp-parameter-grid--${kind}`}>{items.map((parameter) => <ParameterControl compact key={parameter.id} parameter={parameter} onChange={(value) => onChange(parameter.id, value)} onPreview={parameter.deviceFile && onPreview ? (value) => onPreview(parameter, value) : undefined}/>)}</div>;
  return <div className="tp-parameter-stack">
    {files.length > 0 && <section className="tp-parameter-section tp-parameter-section--files"><header><FileCheck2 size={17}/><span><strong>Loaded device file</strong><small>The active NAM, IR, clone or capture used by this block</small></span><Badge tone={files.some((parameter) => String(parameter.value || "").trim()) ? "green" : "amber"}>{files.some((parameter) => String(parameter.value || "").trim()) ? "LOADED" : "REQUIRED"}</Badge></header>{controls(files, "files")}</section>}
    {core.length > 0 && <section className="tp-parameter-section tp-parameter-section--core"><header><SlidersHorizontal size={17}/><span><strong>Core controls</strong><small>Primary sound-shaping values saved with this test plan</small></span><Badge tone="cyan">{core.length}</Badge></header>{controls(core, "core")}</section>}
    {advanced.length > 0 && <details className="tp-parameter-section tp-parameter-section--advanced"><summary><Waves size={16}/><span><strong>Block EQ & routing</strong><small>Open only when the reference chain needs detailed shaping</small></span><Badge>{advanced.length}</Badge><ChevronDown className="tp-parameter-chevron" size={16}/></summary>{controls(advanced, "advanced")}</details>}
  </div>;
}

export function TestRigEditorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useAppStore();
  const rig = store.testRigs.find((item) => item.id === store.selectedTestRigId) ?? null;
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "favorites" | BlockCategoryGroupId>("all");
  const [catalogueBusy, setCatalogueBusy] = useState<string | null>(null);
  const [controlsBusy, setControlsBusy] = useState(false);
  const slotDrag = useSlotPointerDrag<string>((blockId, slot) => store.moveTestRigBlock(blockId, slot), (blockId, slot) => {
    const block = rig?.blocks.find((item) => item.id === blockId);
    return Boolean(rig && block && canPlaceTestRigBlock(rig.blocks, block, slot));
  });
  const selectedBlock = rig?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const draggedBlock = rig?.blocks.find((block) => block.id === slotDrag.dragSource) ?? null;
  const reflectedTypes = (store.liveSubtree?.["/Evil/API/Blocks"]?.value?.ModuleTypes ?? []) as unknown[];
  const moduleTypes = reflectedTypes.length ? reflectedTypes : TEST_RIG_DEMO_MODULES;
  const choices = useMemo(() => moduleTypes.flatMap((entry, index) => {
    const name = String(entry);
    const moduleTypeId = reflectedTypes.length ? index : index + 1;
    if (!name || name === "Empty Slot" || name.endsWith(" 2")) return [];
    const blockCategory = categoryForBlockName(name);
    return [{ name, moduleTypeId, category: blockCategory, color: BLOCK_CATEGORY_COLORS[blockCategory] }];
  }), [moduleTypes, reflectedTypes.length]);
  const compatibleChoices = useMemo(() => choices.filter((choice) => targetSlot === null || testRigSlotAllowsBlock(targetSlot, { ...choice, model: choice.name })), [choices, targetSlot]);
  const visibleCategoryGroups = useMemo(() => BLOCK_CATEGORY_GROUPS.filter((group) => compatibleChoices.some((choice) => blockBelongsToCategoryGroup(choice.name, group.id))), [compatibleChoices]);
  const filteredChoices = useMemo(() => compatibleChoices.filter((choice) => {
    const categoryMatch = category === "all" || category === "favorites"
      ? category !== "favorites" || store.favoriteBlockNames.includes(choice.name)
      : blockBelongsToCategoryGroup(choice.name, category);
    return categoryMatch && `${choice.name} ${BLOCK_CATEGORY_LABELS[choice.category]}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((left, right) => Number(store.favoriteBlockNames.includes(right.name)) - Number(store.favoriteBlockNames.includes(left.name)) || left.name.localeCompare(right.name)).slice(0, 160), [category, compatibleChoices, query, store.favoriteBlockNames]);

  useEffect(() => {
    if (!open || !rig) return;
    const initial = rig.blocks.find((block) => block.name === "Capture slot") ?? [...rig.blocks].sort((a, b) => a.slot - b.slot)[0];
    setSelectedBlockId(initial?.id ?? "");
    setTargetSlot(initial?.slot ?? 0);
  }, [open, rig?.id]);

  useEffect(() => { setCategory("all"); }, [targetSlot]);

  const reflectedParameters = async (name: string, captureHost = false) => {
    const path = testRigModulePath(name);
    let tree = store.liveSubtree;
    if (deviceApi.isNative()) {
      try { tree = { ...(tree ?? {}), ...(await deviceApi.subtree(path) as HeadRushSubtree) }; }
      catch { /* The block remains usable even if this firmware exposes no parameter schema. */ }
    }
    const object = tree?.[path];
    const advertised = Array.isArray(object?.value?.order) ? object.value.order.filter((value): value is string => typeof value === "string") : [];
    const reflectedOrder = advertised.length ? advertised : Object.keys(object?.meta?.properties ?? {});
    const include = captureHost ? [...new Set([...reflectedOrder, ...SLOT_EQ_PROPERTIES])] : undefined;
    return parametersForObject(object, include)
      .filter((parameter) => !captureHost || !isNamFileParameter(parameter))
      .map((parameter) => ({ ...parameter, deviceObjectPath: path }));
  };

  const chooseBlock = async (choice: typeof choices[number]) => {
    if (targetSlot === null || !rig) return;
    if (!testRigSlotAllowsBlock(targetSlot, { ...choice, model: choice.name })) return;
    const occupant = rig.blocks.find((block) => block.slot === targetSlot);
    if (occupant && (occupant.name === "Capture slot" || ["input", "output"].includes(occupant.category))) return;
    setCatalogueBusy(choice.name);
    try {
      const blockId = `test-${choice.moduleTypeId}-${Date.now()}`;
      const block: RigBlock = {
        id: blockId, name: choice.name, model: choice.name, category: choice.category, color: choice.color,
        enabled: true, slot: targetSlot, moduleTypeId: choice.moduleTypeId, sourcePath: testRigModulePath(choice.name),
        parameters: await reflectedParameters(choice.name),
      };
      store.addTestRigBlock(block, targetSlot);
      setSelectedBlockId(blockId);
    } finally { setCatalogueBusy(null); }
  };

  const refreshControls = async () => {
    if (!selectedBlock || ["input", "output"].includes(selectedBlock.category)) return;
    setControlsBusy(true);
    try {
      const parameters = await reflectedParameters(selectedBlock.model, selectedBlock.name === "Capture slot");
      store.updateTestRigBlock(selectedBlock.id, { parameters, sourcePath: testRigModulePath(selectedBlock.model) });
    } finally { setControlsBusy(false); }
  };

  const live = Boolean(store.auditioningToneId && deviceApi.isNative());
  const previewTestRigFile = live && selectedBlock ? async (parameter: Parameter, value: Parameter["value"]) => {
    const response = await deviceApi.setProperties(testRigModulePath(selectedBlock.model), { [parameter.sourceProperty ?? parameter.id]: value });
    if (response.status < 200 || response.status >= 300) throw new Error(`Flex Prime rejected ${parameter.label} with status ${response.status}.`);
  } : undefined;
  const protectedBlock = selectedBlock && (selectedBlock.name === "Capture slot" || ["input", "output"].includes(selectedBlock.category));
  const boundaryBlock = selectedBlock && ["input", "output"].includes(selectedBlock.category);
  const editableParameters = editableParametersFor(selectedBlock);
  const validation = rig ? validateTestRig(rig.blocks) : null;

  return <Dialog open={open} onClose={onClose} title={rig ? `Edit ${rig.name}` : "Edit Test Rig"} description="Build the complete temporary signal path. Changes save to RushLink automatically and update an active Flex Prime audition after a short debounce." width="1240px" footer={<><span className={cn("tp-editor-sync", live && "live", store.testRigSyncError && "error")}><Radio size={13}/>{store.testRigSyncBusy ? "Applying to Flex Prime…" : store.testRigSyncError ? store.testRigSyncError : live ? "Live apply is on" : "Saved locally · audition to apply"}</span><Button variant="primary" onClick={onClose}><Check size={15}/> Done</Button></>}>
    {!rig ? <div className="tp-full-editor-empty"><AlertTriangle/><strong>No Test Rig selected</strong></div> : <div className="tp-full-editor">
      <section className="tp-full-editor__identity">
        <label><span>Rig name</span><Input defaultValue={rig.name} onBlur={(event) => store.updateTestRigDetails({ name: event.target.value })}/></label>
        <label><span>Description</span><Input defaultValue={rig.description} onBlur={(event) => store.updateTestRigDetails({ description: event.target.value })}/></label>
        <div className={cn("tp-editor-validity", !validation?.valid && "invalid")}>{validation?.valid ? <Check size={15}/> : <AlertTriangle size={15}/>}<span><strong>{validation?.valid ? "Ready to audition" : "Plan needs attention"}</strong><small>{validation?.valid ? `${rig.blocks.length}/${TEST_RIG_MAX_SLOTS} slots used` : validation?.errors[0]}</small></span></div>
      </section>

      <section className="tp-full-editor__chain" aria-label="Test Rig signal chain">
        <header><span><GripVertical size={16}/><strong>14-slot temporary chain</strong><small>Three fixed host positions keep every audition consistent.</small></span><Badge tone={live ? "green" : "cyan"}>{live ? "LIVE DEVICE" : "LOCAL PLAN"}</Badge></header>
        <div className="tp-slot-role-strip" aria-label="Fixed Test Rig slot roles">{TEST_RIG_SLOT_ROLES.map((role) => <span key={role.id}><small>SLOT {role.slot + 1}</small><strong>{role.shortLabel}</strong><b>{role.description}</b></span>)}</div>
        <div className="tp-editor-slots">{Array.from({ length: TEST_RIG_MAX_SLOTS }, (_, slot) => {
          const block = rig.blocks.find((item) => item.slot === slot);
          const role = testRigSlotRole(slot);
          if (!block) return <button key={slot} data-chain-slot={slot} data-context-kind="test-rig-slot" data-slot={slot} className={cn("tp-editor-slot empty", role && "reserved", targetSlot === slot && "target", slotDrag.dragTarget === slot && "drop-target")} onClick={() => { if (slotDrag.consumeClick()) return; setTargetSlot(slot); setSelectedBlockId(""); }}><small>{String(slot + 1).padStart(2, "0")}</small><Plus size={16}/><span>{role?.label ?? "Add block"}</span>{role && <b>{role.shortLabel} ONLY</b>}</button>;
          const locked = block.name === "Capture slot" || ["input", "output"].includes(block.category);
          const positionLocked = locked || reservedTestRigSlotForBlock(block) !== null;
          return <button key={block.id} data-chain-slot={slot} data-context-kind="test-rig-block" data-block-id={block.id} data-slot={slot} data-locked={positionLocked ? "true" : "false"} className={cn("tp-editor-slot", role && "reserved", selectedBlockId === block.id && "selected", !block.enabled && "bypassed", positionLocked && "locked", slotDrag.dragSource === block.id && "drag-source", slotDrag.dragTarget === slot && "drop-target")} style={{ "--block-color": block.color } as React.CSSProperties} onPointerDown={(event) => slotDrag.onPointerDown(event, block.id, positionLocked)} onClick={() => { if (slotDrag.consumeClick()) return; setSelectedBlockId(block.id); setTargetSlot(slot); }}><small>{String(slot + 1).padStart(2, "0")}</small><i/>{positionLocked ? <LockKeyhole size={14}/> : <GripVertical size={14}/>}<strong>{block.name}</strong><span>{block.model}</span><b>{block.name === "Capture slot" ? "NAM HOST" : role ? role.shortLabel : block.enabled ? "ON" : "OFF"}</b></button>;
        })}</div>
      </section>

      <div className="tp-full-editor__workspace">
        <section className="tp-editor-inspector">
          <header><span><SlidersHorizontal size={17}/><span><strong>{selectedBlock ? selectedBlock.name : `Empty slot ${(targetSlot ?? 0) + 1}`}</strong><small>{selectedBlock ? `${BLOCK_CATEGORY_LABELS[selectedBlock.category]} · slot ${selectedBlock.slot + 1}` : "Choose a device block from the catalogue"}</small></span></span></header>
          {selectedBlock ? <>
            <div className="tp-editor-block-actions">
              <Button size="sm" disabled={!canPlaceTestRigBlock(rig.blocks, selectedBlock, selectedBlock.slot - 1)} onClick={() => store.moveTestRigBlock(selectedBlock.id, selectedBlock.slot - 1)}><ArrowLeft size={14}/> Move</Button>
              <Button size="sm" disabled={!canPlaceTestRigBlock(rig.blocks, selectedBlock, selectedBlock.slot + 1)} onClick={() => store.moveTestRigBlock(selectedBlock.id, selectedBlock.slot + 1)}>Move <ArrowRight size={14}/></Button>
              <Button size="sm" disabled={Boolean(protectedBlock) || reservedTestRigSlotForBlock(selectedBlock) !== null || rig.blocks.length >= TEST_RIG_MAX_SLOTS} onClick={() => store.duplicateTestRigBlock(selectedBlock.id)}><Copy size={14}/> Duplicate</Button>
              <Button size="sm" disabled={Boolean(protectedBlock)} onClick={() => store.toggleTestRigBlock(selectedBlock.id)}>{selectedBlock.enabled ? <CircleOff size={14}/> : <Check size={14}/>} {selectedBlock.enabled ? "Bypass" : "Enable"}</Button>
              <IconButton label={`Remove ${selectedBlock.name}`} disabled={Boolean(protectedBlock)} onClick={() => { store.removeTestRigBlock(selectedBlock.id); setSelectedBlockId(""); }}><Trash2 size={15}/></IconButton>
            </div>
            {boundaryBlock ? <div className="tp-editor-protected"><LockKeyhole size={18}/><span><strong>Signal boundary</strong><small>Input and output are visual references and cannot be removed or replaced.</small></span></div> : <>
              {selectedBlock.name === "Capture slot" && <div className="tp-editor-protected tp-editor-protected--nam"><LockKeyhole size={18}/><span><strong>NAM host position and file are protected</strong><small>ToneMod supplies the auditioned NAM file. Every sound-shaping control below remains editable.</small></span></div>}
              <div className="tp-editor-parameter-head"><span><strong>{selectedBlock.name === "Capture slot" ? "NAM host controls" : "Block controls"}</strong><small>{editableParameters.length ? `${editableParameters.length} editable controls` : "No saved parameter schema"}</small></span><Button size="sm" loading={controlsBusy} onClick={() => void refreshControls()}><RefreshCw size={13}/> Read from device</Button></div>
              {editableParameters.length ? <TestRigParameterEditor parameters={editableParameters} onChange={(parameterId, value) => store.updateTestRigParameter(selectedBlock.id, parameterId, value)} onPreview={previewTestRigFile}/> : <div className="tp-editor-no-parameters"><SlidersHorizontal size={19}/><span><strong>Controls are not cached yet</strong><small>Read the reflected control schema from Flex Prime, or audition this plan first.</small></span></div>}
            </>}
          </> : <div className="tp-editor-protected"><Plus size={18}/><span><strong>Slot {(targetSlot ?? 0) + 1} is ready</strong><small>Select an effect on the right. It will be inserted here without saving a rig to the pedal.</small></span></div>}
        </section>

        <section className="tp-editor-catalogue">
          <header><span><Sparkles size={17}/><span><strong>Compatible blocks</strong><small>{targetSlot === null ? "Select a chain slot" : testRigSlotRole(targetSlot)?.description ?? `${filteredChoices.length} compatible effect types`}</small></span></span>{targetSlot !== null && <Badge tone="cyan">{selectedBlock && !protectedBlock ? "REPLACE" : "ADD"} SLOT {targetSlot + 1}</Badge>}</header>
          <div className="tp-editor-search"><Search size={15}/><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search blocks…"/></div>
          <nav className="tp-editor-categories" aria-label="Block categories"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>All</button><button className={category === "favorites" ? "active" : ""} onClick={() => setCategory("favorites")}><Star size={12}/> Favourites</button>{visibleCategoryGroups.map((group) => <button key={group.id} className={category === group.id ? "active" : ""} style={{ "--category-color": BLOCK_CATEGORY_COLORS[group.categories[0]] } as React.CSSProperties} onClick={() => setCategory(group.id)}>{group.label}</button>)}</nav>
          <div className="tp-editor-results">{filteredChoices.map((choice) => {
            const favourite = store.favoriteBlockNames.includes(choice.name);
            return <div key={`${choice.moduleTypeId}-${choice.name}`} style={{ "--block-color": choice.color } as React.CSSProperties}><button disabled={targetSlot === null || Boolean(protectedBlock) || Boolean(catalogueBusy)} onClick={() => void chooseBlock(choice)}><i/>{catalogueBusy === choice.name ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>}<span><small>{BLOCK_CATEGORY_LABELS[choice.category]}</small><strong>{choice.name}</strong></span></button><IconButton className={favourite ? "favorite" : ""} label={`${favourite ? "Remove" : "Add"} ${choice.name} ${favourite ? "from" : "to"} favourites`} onClick={() => store.toggleFavoriteBlock(choice.name)}><Star size={13} fill={favourite ? "currentColor" : "none"}/></IconButton></div>;
          })}</div>
          {!filteredChoices.length && <div className="tp-editor-catalogue-empty"><Search size={20}/><strong>No matching blocks</strong><span>Try a broader search or choose another category.</span></div>}
        </section>
      </div>
    </div>}
    <SlotDragPreview position={slotDrag.pointerPosition} targetSlot={slotDrag.dragTarget} label={draggedBlock?.name} detail={draggedBlock ? `Test Rig · slot ${draggedBlock.slot + 1}` : undefined} color={draggedBlock?.color}/>
  </Dialog>;
}

export function ToneModTestRigStudio({ onBrowse }: { onBrowse: () => void }) {
  const store = useAppStore();
  const referenceRun = useWorkspacePanel("test-rig-run", "test-rig-reference-run");
  const rig = store.testRigs.find((item) => item.id === store.selectedTestRigId) ?? store.testRigs[0] ?? null;
  const testSet = store.testRigSets.find((item) => item.id === store.selectedTestRigSetId) ?? store.testRigSets[0] ?? null;
  const ordered = useMemo(() => testSet
    ? testSet.rigIds.map((id) => store.testRigs.find((item) => item.id === id)).filter(Boolean) as typeof store.testRigs
    : [], [testSet, store.testRigs]);
  const available = testSet ? store.testRigs.filter((item) => !testSet.rigIds.includes(item.id)) : [];
  const validation = rig ? validateTestRig(rig.blocks) : null;
  const captureSlot = validation?.captureSlot === null || validation?.captureSlot === undefined ? null : validation.captureSlot + 1;
  const sortedBlocks = useMemo(() => rig ? [...rig.blocks].sort((left, right) => left.slot - right.slot) : [], [rig]);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const slotDrag = useSlotPointerDrag<string>((blockId, slot) => store.moveTestRigBlock(blockId, slot), (blockId, slot) => {
    const block = rig?.blocks.find((item) => item.id === blockId);
    return Boolean(rig && block && canPlaceTestRigBlock(rig.blocks, block, slot));
  });
  const [setDialog, setSetDialog] = useState<"new" | "rename" | null>(null);
  const [setName, setSetName] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const selectedBlock = rig?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedBlockParameters = editableParametersFor(selectedBlock);
  const draggedBlock = rig?.blocks.find((block) => block.id === slotDrag.dragSource) ?? null;
  const previewTestRigFile = store.auditioningToneId && deviceApi.isNative() && selectedBlock ? async (parameter: Parameter, value: Parameter["value"]) => {
    const response = await deviceApi.setProperties(testRigModulePath(selectedBlock.model), { [parameter.sourceProperty ?? parameter.id]: value });
    if (response.status < 200 || response.status >= 300) throw new Error(`Flex Prime rejected ${parameter.label} with status ${response.status}.`);
  } : undefined;

  useEffect(() => {
    if (!rig) { setSelectedBlockId(""); return; }
    setSelectedBlockId(rig.blocks.find((block) => block.name === "Capture slot")?.id ?? rig.blocks[0]?.id ?? "");
  }, [rig?.id]);

  if (!rig || !testSet) {
    return <Card className="tp-studio-empty">
      <AlertTriangle size={24}/><div><h2>Test Rig Studio needs local workspace data</h2><p>The saved test-rig configuration is empty or invalid. Your device library has not been changed.</p></div>
      {!testSet && <Button onClick={() => store.createTestRigSet("Reference Run")}><Plus size={14}/> Create test set</Button>}
    </Card>;
  }

  return <div className="tp-studio">
    <div className="tp-studio-hero">
      <div><span className="eyebrow">REPEATABLE DEVICE AUDITIONING</span><h2>Test Rig Studio</h2><p>Build temporary chains and ordered test runs, then hear the selected profile with the same surrounding FX on Flex Prime.</p></div>
      <div className="tp-studio-actions"><Button variant="primary" onClick={onBrowse}><Sparkles size={15}/> Browse profiles</Button></div>
    </div>

    <Card className="tp-safety-strip">
      <ShieldCheck size={22}/><div><strong>Temporary chain · device library remains untouched</strong><span>RushLink anchors the provider-loaded capture, applies the selected surrounding FX through reflected block controls, and restores the original rig when testing ends.</span></div>
      {store.testRigReturn ? <div className="tp-return-target"><small>{store.testRigReturn.snapshotId ? "SNAPSHOT RETURN" : "RETURN TARGET"}</small><b>{store.testRigReturn.name}</b><Button size="sm" variant="primary" loading={store.auditionBusy} onClick={() => void store.finishToneTestSession().catch(() => undefined)}><RotateCcw size={13}/> Finish & return</Button></div> : <Badge tone="green"><LockKeyhole size={11}/> NO LIBRARY WRITES</Badge>}
    </Card>

    {store.auditionError && <div className="tp-audition-alert error" role="alert"><AlertTriangle size={18}/><span><strong>ToneMod needs attention</strong><small>{store.auditionError}</small></span></div>}

    <div className="tp-reference-run-toolbar">
      <span><ListMusic size={16}/><strong>{testSet.name}</strong><small>{ordered.length} {ordered.length === 1 ? "plan" : "plans"}</small></span>
      <WorkspacePanelToggle open={referenceRun.open} onToggle={referenceRun.toggle} controls="test-rig-reference-run" label="Reference run"/>
    </div>
    <div className={cn("tp-studio-grid", !referenceRun.open && "tp-studio-grid--run-hidden")}>
      <Card id="test-rig-reference-run" className="tp-test-setlist" role="region" aria-label="Reference run" hidden={!referenceRun.open}>
        <div className="tp-panel-heading"><span><ListMusic size={17}/><span><strong>{testSet.name}</strong><small>Local test run · {ordered.length} plans</small></span></span><span className="tp-test-set-tools"><IconButton label="Rename test set" onClick={() => { setSetName(testSet.name); setSetDialog("rename"); }}><Pencil size={13}/></IconButton><IconButton disabled={store.testRigSets.length <= 1} label="Delete test set" onClick={() => store.deleteTestRigSet()}><Trash2 size={13}/></IconButton><IconButton label="New test set" onClick={() => { setSetName(""); setSetDialog("new"); }}><Plus size={14}/></IconButton></span></div>
        <div className="tp-test-set-tabs">{store.testRigSets.map((item) => <button key={item.id} className={item.id === testSet.id ? "active" : ""} onClick={() => store.selectTestRigSet(item.id)}>{item.name}<small>{item.rigIds.length}</small></button>)}</div>
        <div className="tp-test-set-items">{ordered.map((item, index) => {
          const itemValidation = validateTestRig(item.blocks);
          return <div key={item.id} className={cn("tp-test-set-row", item.id === rig.id && "active", !itemValidation.valid && "invalid")}>
            <button className="tp-set-select" onClick={() => store.selectTestRig(item.id)}><span className="tp-set-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.name}</strong>{!itemValidation.valid && <small>{itemValidation.errors[0]}</small>}</span></button>
            <span className="tp-set-actions"><IconButton disabled={index === 0} label="Move up" onClick={() => store.moveTestRigInSetlist(index, index - 1)}><ArrowUp size={13}/></IconButton><IconButton disabled={index === ordered.length - 1} label="Move down" onClick={() => store.moveTestRigInSetlist(index, index + 1)}><ArrowDown size={13}/></IconButton><IconButton label="Remove from test run" onClick={() => store.removeTestRigFromSetlist(item.id)}><Trash2 size={13}/></IconButton></span>
          </div>;
        })}</div>
        {available.length > 0 && <div className="tp-add-template"><span>Add plan</span>{available.map((item) => <Button key={item.id} size="sm" onClick={() => store.addTestRigToSetlist(item.id)}><Plus size={13}/> {item.name}</Button>)}</div>}
        {!ordered.length && <div className="tp-set-empty"><CircleOff size={21}/><strong>Your test run is empty</strong><span>Add a reference plan to create a repeatable comparison order.</span><div>{store.testRigs.map((item) => <Button key={item.id} size="sm" onClick={() => store.addTestRigToSetlist(item.id)}><Plus size={13}/> {item.name}</Button>)}</div></div>}
      </Card>

      <div className="tp-rig-config">
        <Card className={cn("tp-slot-guide", !validation?.valid && "invalid")}>
          <div className="tp-slot-guide__icon">{validation?.valid ? <Check size={20}/> : <AlertTriangle size={20}/>}</div><div><small>TEST RIG STATUS</small><strong>{validation?.valid ? `Capture marker in plan slot ${captureSlot}` : "Test Rig needs attention"}</strong><span>{validation?.valid ? "Audition will apply these surrounding blocks to the temporary device chain." : validation?.errors[0]}</span></div><Badge tone={validation?.valid ? "cyan" : "red"}>{validation?.valid ? `${rig.blocks.length}/${TEST_RIG_MAX_SLOTS} USED` : "INVALID"}</Badge>
        </Card>
        <div className="tp-plan-disclosure"><Info size={15}/><span><strong>{store.auditioningToneId ? "Live apply is active." : "Saved in RushLink until auditioning."}</strong> {store.auditioningToneId ? "Chain and parameter edits are debounced, verified and applied to the temporary Flex Prime rig." : "Audition temporarily loads the complete chain and its supported parameters without overwriting a device rig."}</span></div>

        <Card className="tp-chain-editor">
          <div className="tp-panel-heading"><span><SlidersHorizontal size={17}/><span><strong>{rig.name}</strong><small>{rig.description}</small></span></span><span className="tp-chain-heading-actions"><Badge>{rig.blocks.filter((block) => block.enabled).length} planned active</Badge><Button size="sm" onClick={() => setEditorOpen(true)}><Pencil size={13}/> Full editor</Button></span></div>
          <div className="tp-slot-role-strip tp-slot-role-strip--compact" aria-label="Fixed Test Rig slot roles">{TEST_RIG_SLOT_ROLES.map((role) => <span key={role.id}><small>{role.slot + 1}</small><strong>{role.shortLabel}</strong></span>)}</div>
          <div className="tp-config-chain tp-config-chain--slots">{Array.from({ length: TEST_RIG_MAX_SLOTS }, (_, slot) => {
            const block = sortedBlocks.find((item) => item.slot === slot);
            const role = testRigSlotRole(slot);
            if (!block) return <span key={slot} data-chain-slot={slot} data-context-kind="test-rig-slot" data-slot={slot} className={cn("tp-config-slot-empty", role && "reserved", slotDrag.dragTarget === slot && "drop-target")}><small>{slot + 1}</small><i/>{role && <b>{role.shortLabel}</b>}</span>;
            const protectedBlock = block.name === "Capture slot" || ["input", "output"].includes(block.category);
            const positionLocked = protectedBlock || reservedTestRigSlotForBlock(block) !== null;
            return <button key={block.id} data-chain-slot={slot} data-context-kind="test-rig-block" data-block-id={block.id} data-slot={slot} data-locked={positionLocked ? "true" : "false"} className={cn("tp-config-block", role && "reserved", selectedBlock?.id === block.id && "selected", !block.enabled && "bypassed", positionLocked && "position-locked", protectedBlock && "capture", slotDrag.dragSource === block.id && "drag-source", slotDrag.dragTarget === slot && "drop-target")} style={{ "--block-color": block.color } as React.CSSProperties} onPointerDown={(event) => slotDrag.onPointerDown(event, block.id, positionLocked)} onClick={() => { if (!slotDrag.consumeClick()) setSelectedBlockId(block.id); }}>
              <i/><span><small>SLOT {slot + 1}</small><strong>{block.name}</strong><small>{block.model}</small></span><em className="tp-config-drag-state">{positionLocked ? <LockKeyhole size={12}/> : <GripVertical size={13}/>}</em><b data-no-chain-drag onClick={(event) => { event.stopPropagation(); if (!protectedBlock) store.toggleTestRigBlock(block.id); }}>{protectedBlock ? <LockKeyhole size={13}/> : block.enabled ? "ON" : "OFF"}</b>
            </button>;
          })}</div>
          {selectedBlock && <div className="tp-block-settings"><div><span><strong>{selectedBlock.name}</strong><small>{selectedBlock.name === "Capture slot" ? "Fixed NAM host · profile file is managed by audition" : `Slot ${selectedBlock.slot + 1} · ${selectedBlock.enabled ? "planned active" : "planned bypassed"}`}</small></span>{selectedBlock.name !== "Capture slot" && <Button size="sm" onClick={() => store.toggleTestRigBlock(selectedBlock.id)}>{selectedBlock.enabled ? <CircleOff size={13}/> : <Check size={13}/>} {selectedBlock.enabled ? "Bypass in plan" : "Enable in plan"}</Button>}</div>{selectedBlockParameters.length ? <TestRigParameterEditor parameters={selectedBlockParameters} onChange={(parameterId, value) => store.updateTestRigParameter(selectedBlock.id, parameterId, value)} onPreview={previewTestRigFile}/> : <p>No editable parameters are available for this block yet.</p>}</div>}
        </Card>
      </div>
    </div>

    <Dialog open={setDialog !== null} onClose={() => setSetDialog(null)} title={setDialog === "new" ? "New local test set" : "Rename test set"} description="Test sets exist only inside ToneMod and never appear in or overwrite the device library." width="460px" footer={<><Button variant="ghost" onClick={() => setSetDialog(null)}>Cancel</Button><Button variant="primary" disabled={!setName.trim()} onClick={() => { if (setDialog === "new") store.createTestRigSet(setName); else store.renameTestRigSet(setName); setSetDialog(null); }}><Check size={14}/> {setDialog === "new" ? "Create test set" : "Save name"}</Button></>}><label className="tp-set-name"><span>Test set name</span><Input autoFocus value={setName} onChange={(event) => setSetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && setName.trim()) { if (setDialog === "new") store.createTestRigSet(setName); else store.renameTestRigSet(setName); setSetDialog(null); } }}/></label></Dialog>
    <SlotDragPreview position={slotDrag.pointerPosition} targetSlot={slotDrag.dragTarget} label={draggedBlock?.name} detail={draggedBlock ? `Test Rig · slot ${draggedBlock.slot + 1}` : undefined} color={draggedBlock?.color}/>
    <TestRigEditorDialog open={editorOpen} onClose={() => setEditorOpen(false)}/>
  </div>;
}
