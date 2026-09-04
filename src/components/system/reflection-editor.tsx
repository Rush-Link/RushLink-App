import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { HeadRushObject, Parameter } from "../../domain/types";
import { parameterDeviceValue, parametersForObject } from "../../domain/headrush-reflection";
import { deviceApi } from "../../services/device-api";
import { deviceErrorDetail } from "../../services/device-errors";
import { useAppStore } from "../../stores/app-store";
import { Button } from "../ui";
import { ParameterControl } from "./controls";

interface ReflectionEditorProps {
  path: string;
  object?: HeadRushObject;
  include?: string[];
  columns?: "auto" | "compact";
  appearance?: "default" | "settings" | "drum-groove" | "drum-mixer" | "drum-feel";
  refreshPage?: string;
  resetMethod?: string;
  emptyText?: string;
  labels?: Record<string, string>;
}

export function ReflectionEditor({ path, object, include, columns = "auto", appearance = "default", refreshPage, resetMethod, emptyText = "No writable properties are advertised by this firmware.", labels }: ReflectionEditorProps) {
  const store = useAppStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Parameter["value"]>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const parameters = useMemo(() => parametersForObject(object, include).map((parameter) => ({ ...parameter, label: labels?.[parameter.id] ?? parameter.label, ...(overrides[parameter.id] === undefined ? {} : { value: overrides[parameter.id] }) })), [object, include, labels, overrides]);

  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
  }, []);

  const commit = (parameter: Parameter, next: Parameter["value"]) => {
    setOverrides((current) => ({ ...current, [parameter.id]: next }));
    const oldTimer = timers.current.get(parameter.id); if (oldTimer) clearTimeout(oldTimer);
    timers.current.set(parameter.id, setTimeout(async () => {
      setBusy(parameter.id);
      try {
        await deviceApi.setProperties(path, { [parameter.sourceProperty ?? parameter.id]: parameterDeviceValue(parameter, next) });
        await store.refreshPage(refreshPage, "manual");
        setOverrides((current) => { const copy = { ...current }; delete copy[parameter.id]; return copy; });
      } catch (error) {
        setOverrides((current) => { const copy = { ...current }; delete copy[parameter.id]; return copy; });
        store.addDiagnostic({ level: "warning", source: "Device editor", message: `Could not update ${parameter.label}`, detail: deviceErrorDetail(error) });
      } finally { setBusy(null); }
    }, typeof next === "number" ? 180 : 0));
  };

  if (!parameters.length) return <p className="reflection-editor-empty">{emptyText}</p>;
  return <div className={`reflection-editor reflection-editor--${columns}${appearance !== "default" ? ` reflection-editor--${appearance}` : ""}`}>
    {parameters.map((parameter) => <div key={parameter.id} data-parameter={parameter.id} className={busy === parameter.id ? "reflection-control busy" : "reflection-control"}><ParameterControl compact={columns === "compact"} choiceStyle={appearance === "settings" || appearance.startsWith("drum-") ? "adaptive" : "select"} parameter={parameter} onChange={(next) => commit(parameter, next)} onPreview={parameter.deviceFile ? async (next) => { await deviceApi.setProperties(path, { [parameter.sourceProperty ?? parameter.id]: next }); } : undefined} /></div>)}
    {resetMethod && <Button className="reflection-reset" onClick={async () => { setBusy("reset"); try { await deviceApi.callMethod(path, resetMethod); await store.refreshPage(refreshPage, "manual"); } finally { setBusy(null); } }}><RotateCcw size={15} /> Reset to device defaults</Button>}
  </div>;
}
