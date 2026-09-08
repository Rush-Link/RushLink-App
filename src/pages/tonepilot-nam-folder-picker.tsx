import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "../components/ui";
import { deviceApi, normalizeDeviceFilePath } from "../services/device-api";
import { deviceErrorMessage } from "../services/device-errors";
import "../styles/device-file-picker.css";
import "../styles/tonepilot-nam-folder-picker.css";

const NAM_ROOT = "Neural Amp Modeler";

function boundedFolder(value: string): string | null {
  const normalized = normalizeDeviceFilePath(value);
  const rootKey = NAM_ROOT.toLocaleLowerCase();
  const key = normalized.toLocaleLowerCase();
  if (key === rootKey) return NAM_ROOT;
  return key.startsWith(`${rootKey}/`) ? `${NAM_ROOT}${normalized.slice(NAM_ROOT.length)}` : null;
}

function childFolders(path: string, entries: string[]): Array<{ name: string; path: string }> {
  const prefix = `${path}/`;
  const unique = new Map<string, { name: string; path: string }>();
  for (const entry of entries) {
    // FileAccess normally returns names; tolerate an absolute device-relative
    // child path while rejecting parents, siblings and paths outside NAM.
    const clean = entry.replaceAll("\\", "/").trim();
    const next = boundedFolder(clean.toLocaleLowerCase().startsWith(`${NAM_ROOT.toLocaleLowerCase()}/`) ? clean : `${prefix}${clean}`);
    if (!next || !next.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) continue;
    const name = next.slice(prefix.length);
    if (!name || name.includes("/")) continue;
    unique.set(next.toLocaleLowerCase(), { name, path: next });
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export interface TonePilotNamFolderPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function TonePilotNamFolderPicker({ value, onChange, disabled = false }: TonePilotNamFolderPickerProps) {
  const browserId = `${useId()}-nam-folders`;
  const selectedPath = boundedFolder(value) ?? NAM_ROOT;
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(selectedPath);
  const [folders, setFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current += 1; }, []);

  const load = async (next: string) => {
    const folder = boundedFolder(next);
    if (!folder || disabled) return;
    const currentRequest = ++requestId.current;
    setPath(folder);
    setBusy(true);
    setError(null);
    setVerifiedPath(null);
    setFolders([]);
    try {
      const entries = await deviceApi.listDeviceFiles(folder, "folders");
      if (currentRequest !== requestId.current) return;
      setFolders(childFolders(folder, entries));
      setVerifiedPath(folder);
    } catch (reason) {
      if (currentRequest === requestId.current) setError(deviceErrorMessage(reason, "Reading NAM folders"));
    } finally {
      if (currentRequest === requestId.current) setBusy(false);
    }
  };

  const close = () => {
    requestId.current += 1;
    setBusy(false);
    setOpen(false);
  };
  const crumbs = [NAM_ROOT, ...path.slice(NAM_ROOT.length).split("/").filter(Boolean)];
  const unavailable = disabled || busy;

  return <div className="tp-nam-folder-picker">
    <div className="tp-nam-folder-picker__current">
      <FolderOpen size={18}/>
      <span><small>Destination folder</small><output aria-label="NAM destination folder">{selectedPath}</output></span>
      <Button size="sm" disabled={disabled} aria-expanded={open} aria-controls={browserId} onClick={() => {
        if (open) close();
        else { setOpen(true); void load(selectedPath); }
      }}>{open ? "Close browser" : "Choose folder"}</Button>
    </div>
    {open && <section id={browserId} className="device-asset-browser" aria-label="Choose NAM destination folder">
      <div className="device-asset-browser__toolbar">
        <Button size="sm" variant="ghost" aria-label="Up to parent NAM folder" disabled={unavailable || path === NAM_ROOT} onClick={() => void load(path.slice(0, path.lastIndexOf("/")))}><ArrowLeft size={14}/> Up</Button>
        <nav aria-label="NAM folder location">{crumbs.map((label, index) => {
          const crumbPath = crumbs.slice(0, index + 1).join("/");
          return <span key={crumbPath}><button type="button" disabled={unavailable} aria-current={path === crumbPath ? "location" : undefined} onClick={() => void load(crumbPath)}>{label}</button>{index < crumbs.length - 1 && <ChevronRight size={11}/>}</span>;
        })}</nav>
        <Button size="sm" variant="ghost" aria-label="Refresh NAM folders" disabled={unavailable} onClick={() => void load(path)}><RefreshCw size={14}/></Button>
      </div>
      <div className="device-asset-browser__list" aria-busy={busy}>
        {folders.map((folder) => <button type="button" className="folder" key={folder.path} disabled={unavailable} aria-label={`Open NAM folder ${folder.name}`} onClick={() => void load(folder.path)}><i><Folder size={17}/></i><span><strong>{folder.name}</strong><small>Folder</small></span><ChevronRight size={14}/></button>)}
        {busy && <div className="device-asset-browser__empty" role="status"><RefreshCw className="spin" size={19}/><strong>Reading folders…</strong></div>}
        {!busy && error && <div className="device-asset-browser__empty error" role="alert"><strong>Could not read this folder</strong><span>{error}</span><Button size="sm" disabled={disabled} onClick={() => void load(path)}><RefreshCw size={13}/> Retry folder listing</Button></div>}
        {!busy && !error && !folders.length && <div className="device-asset-browser__empty"><Folder size={19}/><strong>No subfolders</strong><span>You can use this folder as the save destination.</span></div>}
      </div>
      <div className="tp-nam-folder-picker__footer"><span title={path}>{path}</span><Button size="sm" variant="ghost" disabled={disabled} onClick={close}>Cancel</Button><Button size="sm" variant="primary" disabled={unavailable || verifiedPath !== path || Boolean(error)} onClick={() => { onChange(path); close(); }}><Check size={14}/> Use this folder</Button></div>
    </section>}
  </div>;
}
