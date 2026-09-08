import { AlertTriangle, Download, FolderOpen, Guitar, Volume2 } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Dialog, Input, Select } from "../components/ui";
import { CAPTURE_SLOT_NAME, toneProviderReadiness } from "../domain/tone-analysis";
import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi, TONE3000_DEVICE_FOLDER, tone3000ModelFilename, tone3000ModelName } from "../services/device-api";
import { deviceErrorDetail, deviceErrorMessage } from "../services/device-errors";
import { prepareNamFolderSave, type PreparedNamFolderSave } from "../services/tone3000-save";
import { chooseNamTransferRoot, completeNamTransfer, NAM_USER_FOLDER } from "../services/nam-transfer";
import { useAppStore } from "../stores/app-store";
import { TonePilotNamFolderPicker } from "./tonepilot-nam-folder-picker";

interface TonePilotSaveNamDialogProps {
  tone: CloudTone;
  model: ToneModel;
  onClose: () => void;
  onSaved: (result: { name: string; path: string; requiresSync?: boolean }) => void;
  onSaveRig: () => void;
}

export function TonePilotSaveNamDialog({ tone, model, onClose, onSaved, onSaveRig }: TonePilotSaveNamDialogProps) {
  const store = useAppStore();
  const formId = `${useId()}-save-nam`;
  const [mode, setMode] = useState<"model" | "rig">("model");
  const [name, setName] = useState(() => tone3000ModelName(model));
  const [folder, setFolder] = useState(NAM_USER_FOLDER);
  const [transfer, setTransfer] = useState<PreparedNamFolderSave | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const native = deviceApi.isNative();
  const readiness = toneProviderReadiness({ native, device: store.device, capabilities: store.capabilities, subtree: store.liveSubtree, source: tone.source, remoteId: tone.remoteId });
  const unavailable = !native ? "Connect a HeadRush in the desktop app to save this model." : transfer ? null : readiness.reason?.replace("before auditioning", "before saving");
  const activeAudition = store.testRigReturn?.audition;
  const canSaveRig = store.auditioningToneId === tone.id && activeAudition?.tone.id === tone.id && activeAudition.model?.id === model.id;
  const testRig = store.testRigs.find((rig) => rig.id === store.selectedTestRigId);
  const output = testRig?.blocks.find((block) => block.name === CAPTURE_SLOT_NAME)?.parameters.find((parameter) => (parameter.sourceProperty || parameter.id).toLocaleLowerCase() === "output");
  const outputLabel = typeof output?.value === "number" ? `${output.value > 0 ? "+" : ""}${output.value} ${output.unit || "dB"}` : "the current NAM output level";
  const saveName = name.trim() ? tone3000ModelName(model, name) : "";
  const filename = saveName ? tone3000ModelFilename(model, saveName) : "";
  const canSubmit = native && (transfer ? Boolean(saveName) : readiness.ready && !store.auditionBusy && (mode === "rig" ? canSaveRig : Boolean(saveName)));

  const close = () => { if (!saving.current) onClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || saving.current) return;
    if (mode === "rig") { onSaveRig(); return; }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      let result: { name: string; path: string; requiresSync?: boolean };
      if (transfer) {
        const namRoot = await chooseNamTransferRoot();
        if (!namRoot) return;
        const copied = await completeNamTransfer(namRoot, transfer.sourcePath, `${folder}/${filename}`);
        result = { ...copied, requiresSync: true };
      } else {
        const prepared = await prepareNamFolderSave(tone, model, saveName, folder);
        if (prepared.requiresTransfer) { setTransfer(prepared); return; }
        result = prepared;
      }
      useAppStore.setState((state) => ({ tones: state.tones.map((item) => item.id === tone.id ? { ...item, downloaded: true } : item) }));
      store.addDiagnostic({ level: "success", source: "TonePilot", message: `Saved ${result.name} to the device`, detail: result.path });
      onSaved(result);
      onClose();
    } catch (saveError) {
      setError(deviceErrorMessage(saveError));
      store.addDiagnostic({ level: "warning", source: "TonePilot", message: "NAM save failed", detail: deviceErrorDetail(saveError) });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return <Dialog open onClose={close} title="Save NAM to device" width="600px"
    description="Choose how to keep this model on your HeadRush."
    footer={<><Button disabled={busy} onClick={close}>{transfer ? "Close" : "Cancel"}</Button><Button form={formId} type="submit" variant="primary" loading={busy} disabled={!canSubmit}>{transfer ? <><FolderOpen size={15}/> Choose HeadRush NAM folder</> : mode === "model" ? <><Download size={15}/> Save NAM</> : <><Guitar size={15}/> Continue to rig options</>}</Button></>}>
    <form id={formId} className="tp-save-rig-dialog tp-save-nam-dialog" onSubmit={submit}>
      <div className="tp-save-rig-source"><span><Download size={19}/></span><div><small>SELECTED NAM MODEL</small><strong>{model.name}</strong><p>{tone.title} · {model.architecture}</p></div></div>
      <section className="tp-save-rig-section">
        <label className="tp-save-rig-field" htmlFor={`${formId}-mode`}><span>Save as</span>
          <Select id={`${formId}-mode`} aria-label="Save as" aria-describedby={`${formId}-mode-help`} value={mode} disabled={busy || Boolean(transfer)} onChange={(event) => { setMode(event.target.value as "model" | "rig"); setError(null); }}>
            <option value="model">NAM model — choose device folder</option>
            <option value="rig" disabled={!canSaveRig}>Audition rig — Rigs and optional setlist</option>
          </Select>
          <small id={`${formId}-mode-help`}>{canSaveRig ? "Save the model on its own, or keep the audition chain and its levels together in a rig." : "Audition this exact model first to save it with your Test Rig and output level."}</small>
        </label>
        {mode === "model" ? <>
          <label className="tp-save-rig-field" htmlFor={`${formId}-name`}><span>Model name</span>
            <Input id={`${formId}-name`} aria-label="Model name" autoFocus required maxLength={200} disabled={busy} value={name} aria-invalid={!saveName} aria-describedby={`${formId}-name-help`} onChange={(event) => { setName(event.target.value); setError(null); }}/>
            <small id={`${formId}-name-help`}>The .nam extension is added automatically. Use a new name to keep a separate copy.</small>
          </label>
          <TonePilotNamFolderPicker value={folder} onChange={(path) => { setFolder(path); setError(null); }} disabled={busy || Boolean(transfer) || !native || !readiness.ready}/>
          <div className="tp-save-nam-destination"><FolderOpen size={17}/><div><strong>Save location</strong><output aria-label="Save location">{folder}/{filename || "…"}</output><p>{folder === TONE3000_DEVICE_FOLDER ? "This folder supports saving directly over Wi-Fi." : "Saving to this folder needs USB Transfer after the download. You will select the NAM folder on the mounted HeadRush drive."}</p></div></div>
        </> : <div className="tp-save-nam-destination"><Guitar size={17}/><div><strong>Rigs</strong><p>Choose a rig name, setlist, colour and tempo in the next step. The active model and current Test Rig settings will be saved together.</p></div></div>}
      </section>
      {transfer && <section className="tp-save-rig-section tp-save-nam-usb" aria-label="Finish NAM save with USB Transfer"><strong>Ready for USB Transfer</strong><p>The NAM has downloaded to {transfer.sourcePath}. To copy it into your chosen folder:</p><ol><li>On HeadRush, open Menu → USB Transfer.</li><li>Connect its USB port to this computer.</li><li>Choose the <b>Neural Amp Modeler</b> folder on the mounted HeadRush drive below.</li></ol><p>The original download is kept. After copying, eject the drive and tap <b>Sync</b> on HeadRush.</p></section>}
      <div className="tp-save-nam-destination tp-save-nam-volume"><Volume2 size={17}/><div><strong>{mode === "model" ? "Model volume" : "Saved rig volume"}</strong><p>{mode === "model" ? "HeadRush does not offer a default volume setting for a downloaded NAM file. To recall an output level, save an audition rig." : `The rig will recall ${outputLabel}. Adjust NAM output in the audition workspace before saving to change it.`}</p></div></div>
      {!canSaveRig && mode === "rig" && <div className="tp-save-rig-error" role="alert"><AlertTriangle size={16}/><span>This model is no longer the active audition. Audition it again before saving a rig.</span></div>}
      {unavailable && <div className="tp-save-rig-error" role="alert"><AlertTriangle size={16}/><span>{unavailable}</span></div>}
      {error && <div className="tp-save-rig-error" role="alert"><AlertTriangle size={16}/><span>{error}</span></div>}
      {busy && <p className="tp-save-nam-progress" role="status">{transfer ? "Copying the NAM to your selected folder…" : "Downloading and checking the NAM file on HeadRush…"}</p>}
    </form>
  </Dialog>;
}
