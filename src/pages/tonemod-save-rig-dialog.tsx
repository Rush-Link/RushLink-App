import { AlertTriangle, Check, Gauge, Guitar, ListMusic, Palette, Save } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { Button, Dialog, Input, Select } from "../components/ui";
import { colorForIndex, denormalizeValue } from "../domain/headrush-reflection";
import type { HeadRushPropertyMeta, HeadRushSubtree, LiveDeviceSnapshot } from "../domain/types";
import { deviceErrorMessage } from "../services/device-errors";
import { deviceApi } from "../services/device-api";
import {
  AuditionRigNameConflictError,
  sanitizeHeadRushRigName,
  useAppStore,
  type AuditionRigSaveOptions,
  type AuditionRigSaveResult,
} from "../stores/app-store";

const RIGS_PATH = "/Evil/API/Rigs";
const PATCH_RIG_PATH = "/Evil/Engine/Patch/Rig";
const MIN_TEMPO = 30;
const MAX_TEMPO = 240;

export const HEADRUSH_RIG_COLORS = [
  { value: 1, label: "Green" },
  { value: 2, label: "Dark green" },
  { value: 3, label: "Amber" },
  { value: 4, label: "Orange" },
  { value: 5, label: "Red" },
  { value: 6, label: "Pink" },
  { value: 7, label: "Violet" },
  { value: 8, label: "Blue" },
  { value: 9, label: "Cyan" },
] as const;

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const normalizedName = (value: string) => sanitizeHeadRushRigName(value).toLocaleLowerCase();
const moveRadioFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
  const movement = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const buttons = group ? [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)')] : [];
  if (!buttons.length || (!movement && event.key !== "Home" && event.key !== "End")) return;
  event.preventDefault();
  const current = Math.max(0, buttons.indexOf(event.currentTarget));
  const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + movement + buttons.length) % buttons.length;
  buttons[index].focus();
  buttons[index].click();
};

export function nextAvailableHeadRushRigName(preferred: string, existingNames: string[]): string {
  const fallback = sanitizeHeadRushRigName(preferred) || "ToneMod Rig";
  const occupied = new Set(existingNames.map(normalizedName).filter(Boolean));
  if (!occupied.has(normalizedName(fallback))) return fallback;

  for (let copy = 2; copy < 10_000; copy += 1) {
    const suffix = ` ${copy}`;
    const candidate = `${fallback.slice(0, Math.max(1, 200 - suffix.length)).trimEnd()}${suffix}`;
    if (!occupied.has(normalizedName(candidate))) return candidate;
  }
  return `${fallback.slice(0, 190).trimEnd()} Copy`;
}

function reflectedTempoBpm(tree: HeadRushSubtree | null, snapshot: LiveDeviceSnapshot | null): number {
  const snapshotTempo = finiteNumber(snapshot?.rig.tempo);
  if (snapshotTempo !== null && snapshotTempo >= MIN_TEMPO && snapshotTempo <= MAX_TEMPO) return snapshotTempo;

  const object = tree?.[PATCH_RIG_PATH];
  const rawTempo = finiteNumber(object?.value?.Tempo);
  const meta = object?.meta?.properties?.Tempo as HeadRushPropertyMeta | undefined;
  const tempo = rawTempo === null ? 120 : meta ? denormalizeValue(rawTempo, meta) : rawTempo;
  return Math.round(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo)) * 10) / 10;
}

function reflectedColor(tree: HeadRushSubtree | null): number {
  const value = finiteNumber(tree?.[RIGS_PATH]?.value?.loadedColor);
  return value !== null && value >= 1 && value <= 9 ? Math.round(value) : 1;
}

function reflectedTempoMode(tree: HeadRushSubtree | null): AuditionRigSaveOptions["tempoMode"] {
  return tree?.[PATCH_RIG_PATH]?.value?.TempoFromMaster === false ? "fixed" : "current";
}

function reflectedProgramChoices(tree: HeadRushSubtree | null): number[] {
  const choices = tree?.[RIGS_PATH]?.value?.availableProgMIDICC;
  if (!Array.isArray(choices)) return [];
  const loaded = finiteNumber(tree?.[RIGS_PATH]?.value?.loadedProgMIDICC);
  const programs = choices.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 127);
  if (loaded !== null && Number.isInteger(loaded) && loaded >= 0 && loaded <= 127) programs.push(loaded);
  return [...new Set(programs)].sort((a, b) => a - b);
}

function reflectedProgramChange(tree: HeadRushSubtree | null): number {
  const loaded = finiteNumber(tree?.[RIGS_PATH]?.value?.loadedProgMIDICC);
  return loaded !== null && Number.isInteger(loaded) && loaded >= -1 && loaded <= 127 ? loaded : -1;
}

export interface ToneModSaveRigDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (result: AuditionRigSaveResult) => void;
  toneTitle: string;
}

function auditionSaveUnavailable(state: ReturnType<typeof useAppStore.getState>): string | null {
  if (!deviceApi.isNative() || state.device?.status !== "ready") return "Connect a HeadRush device before saving this audition.";
  if (!state.auditioningToneId) return "Start an audition before saving its Test Rig.";
  if (state.testRigReturn?.audition?.tone.id !== state.auditioningToneId) return "Restart the audition so RushLink can identify the exact model to save.";
  if (state.auditionBusy) return "Wait for the current audition operation to finish before saving.";
  return null;
}

export function ToneModSaveRigDialog({ open, onClose, onSaved, toneTitle }: ToneModSaveRigDialogProps) {
  const store = useAppStore();
  const formId = `${useId()}-tonemod-save-rig`;
  const nameHelpId = `${formId}-name-help`;
  const [name, setName] = useState("");
  const [setlistId, setSetlistId] = useState("");
  const [color, setColor] = useState<number>(1);
  const [tempoMode, setTempoMode] = useState<AuditionRigSaveOptions["tempoMode"]>("current");
  const [tempoBpm, setTempoBpm] = useState("120");
  const [programChange, setProgramChange] = useState(-1);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [deviceDuplicateName, setDeviceDuplicateName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const programChangeSupported = Array.isArray(store.liveSubtree?.[RIGS_PATH]?.value?.availableProgMIDICC);
  const programChoices = useMemo(() => reflectedProgramChoices(store.liveSubtree), [store.liveSubtree]);
  const reflectedLoadedProgram = reflectedProgramChange(store.liveSubtree);
  const sanitizedName = sanitizeHeadRushRigName(name);
  const localDuplicate = sanitizedName
    ? store.rigs.find((rig) => normalizedName(rig.name) === normalizedName(sanitizedName)) ?? null
    : null;
  const duplicateName = localDuplicate?.name ?? deviceDuplicateName;
  const parsedTempo = Number(tempoBpm);
  const fixedTempoInvalid = tempoMode === "fixed" && (!Number.isFinite(parsedTempo) || parsedTempo < MIN_TEMPO || parsedTempo > MAX_TEMPO);
  const nameWasSanitized = Boolean(name && sanitizedName !== name);
  const unavailable = busy ? null : auditionSaveUnavailable(store);
  const canSubmit = Boolean(sanitizedName)
    && !busy
    && !unavailable
    && !fixedTempoInvalid
    && (!duplicateName || overwriteConfirmed)
    && typeof store.saveAuditionRig === "function";

  useEffect(() => {
    if (!open || saving.current) return;
    const tempo = reflectedTempoBpm(store.liveSubtree, store.liveSnapshot);
    setName(nextAvailableHeadRushRigName(toneTitle, store.rigs.map((rig) => rig.name)));
    setSetlistId("");
    setColor(reflectedColor(store.liveSubtree));
    setTempoMode(reflectedTempoMode(store.liveSubtree));
    setTempoBpm(String(tempo));
    setProgramChange(reflectedProgramChange(store.liveSubtree));
    setOverwriteConfirmed(false);
    setDeviceDuplicateName(null);
    setBusy(false);
    setError(null);
    // Defaults intentionally snapshot the device when the dialog opens. Live
    // polling must not overwrite values while the user is editing the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toneTitle]);

  const updateName = (next: string) => {
    setName(next);
    setOverwriteConfirmed(false);
    setDeviceDuplicateName(null);
    setError(null);
  };

  const close = () => {
    if (!saving.current) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || saving.current || auditionSaveUnavailable(useAppStore.getState())) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await store.saveAuditionRig({
        name: sanitizedName,
        setlistId: setlistId || undefined,
        color,
        tempoMode,
        tempoBpm: Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Number.isFinite(parsedTempo) ? parsedTempo : 120)),
        programChange,
        ...(duplicateName ? { overwrite: true } : {}),
      });
      onSaved?.(result);
      onClose();
    } catch (saveError) {
      if (saveError instanceof AuditionRigNameConflictError) {
        setDeviceDuplicateName(saveError.rigName);
        setOverwriteConfirmed(false);
        setError(null);
        return;
      }
      setError(deviceErrorMessage(saveError, "Saving the audition rig"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return <Dialog
    open={open}
    onClose={close}
    width="680px"
    title="Save audition to Rigs"
    description="Turn the live ToneMod chain into a HeadRush rig. The temporary audition session remains available after saving."
    footer={<>
      <span className="tp-save-rig-footer-note" aria-live="polite">
        {duplicateName ? <><AlertTriangle size={14}/> Existing rig name</> : setlistId ? <><ListMusic size={14}/> Rig and setlist</> : <><Guitar size={14}/> Device rig library</>}
      </span>
      <Button disabled={busy} onClick={close}>Cancel</Button>
      <Button
        form={formId}
        type="submit"
        variant={duplicateName ? "danger" : "primary"}
        loading={busy}
        disabled={!canSubmit}
      ><Save size={15}/> {duplicateName ? "Replace existing rig" : "Save to Rigs"}</Button>
    </>}
  >
    <form id={formId} className="tp-save-rig-dialog" aria-busy={busy} onSubmit={submit}>
      <div className="tp-save-rig-source">
        <span><Guitar size={19}/></span>
        <div><small>LIVE AUDITION CHAIN</small><strong>{toneTitle || "ToneMod audition"}</strong><p>The active model, Test Rig blocks and their current values will be stored together.</p></div>
        <Check size={16}/>
      </div>

      <section className="tp-save-rig-section" aria-labelledby={`${formId}-identity-heading`}>
        <header><span><Guitar size={15}/><strong id={`${formId}-identity-heading`}>Rig identity</strong></span><small>Required</small></header>
        <label className="tp-save-rig-field" htmlFor={`${formId}-name`}>
          <span>Rig name</span>
          <Input
            id={`${formId}-name`}
            aria-label="Rig name"
            autoFocus
            required
            maxLength={200}
            value={name}
            disabled={busy}
            aria-invalid={!sanitizedName || Boolean(duplicateName && !overwriteConfirmed)}
            aria-describedby={nameHelpId}
            onChange={(event) => updateName(event.target.value)}
          />
          <small id={nameHelpId}>{nameWasSanitized ? `HeadRush-safe name: “${sanitizedName || "empty"}”` : `${sanitizedName.length}/200 characters`}</small>
        </label>

        {duplicateName && <div className="tp-save-rig-duplicate" role="alert">
          <AlertTriangle size={18}/>
          <div><strong>“{duplicateName}” already exists</strong><p>Saving with this name may replace that rig on the HeadRush. Choose another name or confirm the replacement explicitly.</p>
            <label><input type="checkbox" disabled={busy} checked={overwriteConfirmed} onChange={(event) => setOverwriteConfirmed(event.target.checked)}/><span>I understand — replace the existing rig</span></label>
          </div>
        </div>}

        <label className="tp-save-rig-field" htmlFor={`${formId}-setlist`}>
          <span>Add to setlist <em>Optional</em></span>
          <Select id={`${formId}-setlist`} aria-label="Add to setlist" disabled={busy} value={setlistId} onChange={(event) => { setSetlistId(event.target.value); setError(null); }}>
            <option value="">None — save to Rigs only</option>
            {store.setlists.map((setlist) => <option key={setlist.id} value={setlist.id}>{setlist.name}</option>)}
          </Select>
          <small>The selected setlist keeps its existing order; this rig is added at the end.</small>
        </label>
      </section>

      <section className="tp-save-rig-section" aria-labelledby={`${formId}-appearance-heading`}>
        <header><span><Palette size={15}/><strong id={`${formId}-appearance-heading`}>HeadRush colour</strong></span><small>{HEADRUSH_RIG_COLORS.find((item) => item.value === color)?.label}</small></header>
        <div className="tp-save-rig-colors" role="radiogroup" aria-label="Rig colour">
          {HEADRUSH_RIG_COLORS.map((item) => <button
            key={item.value}
            type="button"
            role="radio"
            disabled={busy}
            aria-checked={color === item.value}
            aria-label={item.label}
            tabIndex={color === item.value ? 0 : -1}
            className={color === item.value ? "selected" : ""}
            style={{ "--rig-save-color": colorForIndex(item.value) } as CSSProperties}
            onKeyDown={moveRadioFocus}
            onClick={() => { setColor(item.value); setError(null); }}
          ><i/><span>{item.label}</span>{color === item.value && <Check size={12}/>}</button>)}
        </div>
      </section>

      <section className="tp-save-rig-section tp-save-rig-performance" aria-labelledby={`${formId}-performance-heading`}>
        <header><span><Gauge size={15}/><strong id={`${formId}-performance-heading`}>Performance settings</strong></span><small>Stored with rig</small></header>
        <div className="tp-save-rig-performance-grid">
          <fieldset className="tp-save-rig-tempo">
            <legend>Tempo source</legend>
            <div role="radiogroup" aria-label="Tempo source">
              <button type="button" role="radio" disabled={busy} aria-checked={tempoMode === "current"} tabIndex={tempoMode === "current" ? 0 : -1} className={tempoMode === "current" ? "selected" : ""} onKeyDown={moveRadioFocus} onClick={() => { setTempoMode("current"); setError(null); }}><span>Device tempo</span><small>Follow HeadRush master tempo</small></button>
              <button type="button" role="radio" disabled={busy} aria-checked={tempoMode === "fixed"} tabIndex={tempoMode === "fixed" ? 0 : -1} className={tempoMode === "fixed" ? "selected" : ""} onKeyDown={moveRadioFocus} onClick={() => { setTempoMode("fixed"); setError(null); }}><span>Fixed</span><small>Recall this BPM</small></button>
            </div>
          </fieldset>

          <label className="tp-save-rig-field tp-save-rig-bpm" htmlFor={`${formId}-tempo`}>
            <span>Rig tempo</span>
            <div><Input id={`${formId}-tempo`} aria-label="Rig tempo" type="number" inputMode="decimal" min={MIN_TEMPO} max={MAX_TEMPO} step="0.1" disabled={busy || tempoMode === "current"} value={tempoBpm} aria-invalid={fixedTempoInvalid} onChange={(event) => { setTempoBpm(event.target.value); setError(null); }}/><b>BPM</b></div>
            <small>{tempoMode === "current" ? "Follows the HeadRush master tempo when recalled." : `${MIN_TEMPO}–${MAX_TEMPO} BPM`}</small>
          </label>

          {programChangeSupported && <label className="tp-save-rig-field tp-save-rig-program" htmlFor={`${formId}-program`}>
            <span>MIDI Program Change</span>
            <Select id={`${formId}-program`} aria-label="MIDI Program Change" disabled={busy} value={programChange} onChange={(event) => { setProgramChange(Number(event.target.value)); setError(null); }}>
              <option value={-1}>Off — no assignment</option>
              {programChoices.map((program) => <option key={program} value={program}>Program {program + 1} · PC {program}{program === reflectedLoadedProgram ? " · Current" : ""}</option>)}
            </Select>
            <small>Only unassigned programs reported by this HeadRush are shown.</small>
          </label>}
        </div>
      </section>

      {fixedTempoInvalid && <div className="tp-save-rig-error" role="alert"><AlertTriangle size={16}/><span>Enter a fixed tempo from {MIN_TEMPO} to {MAX_TEMPO} BPM.</span></div>}
      {unavailable && <div className="tp-save-rig-error" role="alert"><AlertTriangle size={16}/><span>{unavailable}</span></div>}
      {error && <div className="tp-save-rig-error" role="alert"><AlertTriangle size={16}/><span>{error}</span></div>}
    </form>
  </Dialog>;
}
