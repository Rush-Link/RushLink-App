import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, FileAudio, Folder, FolderOpen, HardDrive, RefreshCw, Search } from "lucide-react";
import type { Parameter } from "../../domain/types";
import { deviceApi } from "../../services/device-api";
import { deviceErrorMessage } from "../../services/device-errors";
import { Button, Dialog, Input } from "../ui";
import "../../styles/device-file-picker.css";

const joinPath = (parent: string, child: string) => `${parent.replace(/\/$/, "")}/${child.replace(/^\//, "")}`;
const leafName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
const parentName = (path: string) => path.split("/").filter(Boolean).slice(0, -1).at(-1) ?? "Device library";

export function DeviceFileControl({ parameter, onChange, onPreview, compact = false }: { parameter: Parameter; onChange: (value: string) => void; onPreview?: (value: string) => Promise<void> | void; compact?: boolean }) {
  const file = parameter.deviceFile;
  const current = String(parameter.value || "");
  const root = file?.startPath ?? "";
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(root);
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [original, setOriginal] = useState(current);
  const [selected, setSelected] = useState(current);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewQueue = useRef<Promise<void>>(Promise.resolve());
  const audition = onPreview ?? (parameter.deviceObjectPath ? async (value: string) => { await deviceApi.setProperties(parameter.deviceObjectPath!, { [parameter.sourceProperty ?? parameter.id]: value }); } : undefined);

  const load = async (nextPath: string) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const [nextFolders, nextFiles] = await Promise.all([
        deviceApi.listDeviceFiles(nextPath, "folders"),
        deviceApi.listDeviceFiles(nextPath, file.fileType),
      ]);
      setPath(nextPath); setFolders(nextFolders); setFiles(nextFiles);
    } catch (reason) {
      setError(deviceErrorMessage(reason)); setFolders([]); setFiles([]);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!open || !file) return;
    const parent = original.startsWith(`${root}/`) && original.includes("/") ? original.slice(0, original.lastIndexOf("/")) : root;
    setSelected(original); setQuery(""); void load(parent);
  // Opening the browser is the explicit refresh boundary; live polling must not repeatedly scan device storage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, root, file?.fileType, original]);

  const crumbs = useMemo(() => {
    const rootParts = root.split("/").filter(Boolean);
    const relative = path.split("/").filter(Boolean).slice(rootParts.length);
    return [{ label: rootParts.at(-1) ?? "Device", path: root }, ...relative.map((label, index) => ({ label, path: [...rootParts, ...relative.slice(0, index + 1)].join("/") }))];
  }, [path, root]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleFolders = folders.filter((name) => name.toLocaleLowerCase().includes(normalizedQuery));
  const visibleFiles = files.filter((name) => name.toLocaleLowerCase().includes(normalizedQuery));
  const goUp = () => {
    if (path === root) return;
    const parent = path.slice(0, path.lastIndexOf("/"));
    void load(parent.length >= root.length ? parent : root);
  };
  const preview = (value: string) => {
    setSelected(value); setPreviewBusy(true); setError(null);
    previewQueue.current = previewQueue.current.then(async () => { await audition?.(value); }).catch((reason) => { setError(deviceErrorMessage(reason)); }).finally(() => setPreviewBusy(false));
    return previewQueue.current;
  };
  const cancel = async () => {
    setPreviewBusy(true);
    await previewQueue.current;
    if (selected !== original) {
      try { await audition?.(original); } catch (reason) { setError(deviceErrorMessage(reason)); setPreviewBusy(false); return; }
    }
    setPreviewBusy(false); setSelected(original); setOpen(false);
  };
  const commit = async () => {
    await previewQueue.current;
    onChange(selected); setOpen(false);
  };
  const cycle = async (direction: -1 | 1) => {
    if (!file || cycleBusy) return;
    setCycleBusy(true);
    try {
      const parent = current.startsWith(`${root}/`) && current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : root;
      const siblings = await deviceApi.listDeviceFiles(parent, file.fileType);
      if (!siblings.length) return;
      const currentName = leafName(current);
      const currentIndex = siblings.findIndex((name) => name === currentName);
      const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : siblings.length - 1) : (currentIndex + direction + siblings.length) % siblings.length;
      const next = joinPath(parent, siblings[nextIndex]);
      if (next !== current) onChange(next);
    } catch (reason) { setError(deviceErrorMessage(reason)); }
    finally { setCycleBusy(false); }
  };

  if (!file) return null;
  return <>
    <div className={`device-file-control ${compact ? "device-file-control--compact" : ""} ${current ? "device-file-control--loaded" : "device-file-control--empty"}`} data-current-file={current || undefined}>
      <button type="button" className="device-file-control__step" disabled={cycleBusy} onClick={() => void cycle(-1)} aria-label={`Previous ${parameter.label}`}><ChevronLeft size={16} /></button>
      <button type="button" className="device-file-control__browse" aria-label={`${current ? "Change" : "Choose"} ${parameter.label}${current ? `, currently ${leafName(current)}` : ""}`} data-context-kind={current ? "device-file" : undefined} data-device-path={current || undefined} data-device-name={current ? leafName(current) : undefined} onClick={() => { setOriginal(current); setSelected(current); setOpen(true); }}>
        <span className="device-file-control__icon"><FileAudio size={compact ? 15 : 18} /></span>
        <span className="device-file-control__state"><small>{parameter.label} · {current ? "LOADED ON HEADRUSH" : "NOT SELECTED"}</small><strong title={current || undefined}>{current ? leafName(current) : "Choose a compatible device file"}</strong><em title={current || root}>{current ? current.slice(0, Math.max(0, current.lastIndexOf("/"))) || parentName(current) : root}</em></span>
        <span className="device-file-control__action"><FolderOpen size={14} /><b>{current ? "Change file" : "Browse files"}</b></span>
      </button>
      <button type="button" className="device-file-control__step" disabled={cycleBusy} onClick={() => void cycle(1)} aria-label={`Next ${parameter.label}`}><ChevronRight size={16} /></button>
    </div>
    <Dialog open={open} onClose={() => void cancel()} width="780px" title={`Choose ${parameter.label}`} description={`Browse ${root} on the connected HeadRush. Select a file to audition it immediately; confirm to keep it.`} footer={<><Button variant="ghost" disabled={previewBusy} onClick={() => void cancel()}>Cancel</Button><Button variant="primary" disabled={!selected || selected === original || previewBusy} onClick={() => void commit()}><Check size={14} /> Use selected file</Button></>}>
      <div className="device-asset-browser">
        <div className="device-asset-browser__toolbar">
          <Button size="sm" variant="ghost" disabled={path === root || busy} onClick={goUp}><ArrowLeft size={14} /> Up</Button>
          <nav aria-label="Device file location">{crumbs.map((crumb, index) => <span key={crumb.path}><button disabled={busy} onClick={() => void load(crumb.path)}>{crumb.label}</button>{index < crumbs.length - 1 && <ChevronRight size={11} />}</span>)}</nav>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load(path)}><RefreshCw size={13} /> Refresh</Button>
        </div>
        <label className="device-asset-browser__search"><Search size={14} /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this folder…" /></label>
        <div className="device-asset-browser__summary"><span><HardDrive size={13} /> HEADRUSH STORAGE</span><span>{visibleFolders.length} folders · {visibleFiles.length} compatible files</span></div>
        <div className="device-asset-browser__list" aria-busy={busy}>
          {visibleFolders.map((name) => { const value = joinPath(path, name); return <button className="folder" key={`folder-${name}`} data-context-kind="device-folder" data-device-path={value} data-device-name={name} onClick={() => void load(value)}><i><Folder size={17} /></i><span><strong>{name}</strong><small>Folder</small></span><ChevronRight size={14} /></button>; })}
          {visibleFiles.map((name) => { const value = joinPath(path, name); return <button disabled={previewBusy} className={selected === value ? "file selected" : "file"} key={`file-${name}`} data-context-kind="device-file" data-device-path={value} data-device-name={name} onClick={() => void preview(value)}><i><FileAudio size={17} /></i><span><strong>{name}</strong><small>{leafName(name).split(".").at(-1)?.toUpperCase() || "FILE"}</small></span>{selected === value && <Check size={15} />}</button>; })}
          {busy && <div className="device-asset-browser__empty"><RefreshCw className="spin" size={19} /><strong>Reading device folder…</strong></div>}
          {!busy && error && <div className="device-asset-browser__empty error"><HardDrive size={19} /><strong>Could not read this folder</strong><span>{error}</span></div>}
          {!busy && !error && !visibleFolders.length && !visibleFiles.length && <div className="device-asset-browser__empty"><Folder size={19} /><strong>{query ? "No matching files" : "This folder has no compatible files"}</strong><span>{query ? "Clear the filter or open another folder." : "Only files supported by this effect are shown."}</span></div>}
        </div>
        {selected && <div className="device-asset-browser__selection"><FileAudio size={14} /><span><small>{previewBusy ? "LOADING PREVIEW" : selected === original ? "CURRENT FILE" : "AUDITIONING"}</small><strong>{selected}</strong></span></div>}
      </div>
    </Dialog>
  </>;
}
