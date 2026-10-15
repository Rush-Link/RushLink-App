import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Library, PlugZap, RadioTower, Save, ShieldCheck } from "lucide-react";
import { AppShell } from "./components/system/app-shell";
import { DeviceConnectionGate } from "./components/system/device-connection-gate";
import { RushLinkContextMenu } from "./components/system/rushlink-context-menu";
import { RUSHLINK_BRAND, RushLinkBrand, RushLinkMark } from "./components/system/rushlink-mark";
import { Button, Dialog } from "./components/ui";
import { useAppStore } from "./stores/app-store";
import { deviceApi } from "./services/device-api";
import { createAsyncRefreshScheduler } from "./services/device-sync-scheduler";
import { deviceErrorDetail } from "./services/device-errors";
import { loadAssignmentsPage, loadDashboardPage, loadEditorPage, loadLibraryPage, loadPerformancePage, loadRigsPages, loadStageHandPage, loadSystemPages, loadToneModPage } from "./page-loaders";
import { primaryConnectionAddress } from "./domain/connection-address";
import { useAppTheme } from "./hooks/use-app-theme";

const DashboardPage = lazy(() => loadDashboardPage().then((module) => ({ default: module.DashboardPage })));
const EditorPage = lazy(() => loadEditorPage().then((module) => ({ default: module.EditorPage })));
const AssignmentsPage = lazy(() => loadAssignmentsPage().then((module) => ({ default: module.AssignmentsPage })));
const LibraryBackupPage = lazy(() => loadLibraryPage().then((module) => ({ default: module.LibraryBackupPage })));
const RigsPage = lazy(() => loadRigsPages().then((module) => ({ default: module.RigsPage })));
const SetlistsPage = lazy(() => loadRigsPages().then((module) => ({ default: module.SetlistsPage })));
const LivePlayPage = lazy(() => loadStageHandPage().then((module) => ({ default: module.LivePlayPage })));
const DiagnosticsPage = lazy(() => loadSystemPages().then((module) => ({ default: module.DiagnosticsPage })));
const SettingsPage = lazy(() => loadSystemPages().then((module) => ({ default: module.SettingsPage })));
const ToneLabPage = lazy(() => loadToneModPage().then((module) => ({ default: module.ToneLabPage })));
const PerformanceToolsPage = lazy(() => loadPerformancePage().then((module) => ({ default: module.PerformanceToolsPage })));

const pages: Record<string, React.ComponentType> = {
  dashboard: DashboardPage, editor: EditorPage, rigs: RigsPage, setlists: SetlistsPage,
  live: LivePlayPage, "tone-cloud": ToneLabPage, assignments: AssignmentsPage,
  tools: PerformanceToolsPage,
  library: LibraryBackupPage, settings: SettingsPage, diagnostics: DiagnosticsPage,
};

function PageLoading() {
  return <div className="page-loading" role="status" aria-live="polite"><span className="brand__mark"><RushLinkMark/></span><div><strong>Opening workspace</strong><small>Preparing the latest device view…</small></div></div>;
}

export default function App() {
  useAppTheme();
  const page = useAppStore((s) => s.page); const preferences = useAppStore((s) => s.preferences); const device = useAppStore((s) => s.device); const testRigReturn = useAppStore((s) => s.testRigReturn); const resolve = useAppStore((s) => s.resolveFirstWrite); const [writePrompt, setWritePrompt] = useState(false); const [onboardingStep, setOnboardingStep] = useState<"welcome" | "safety">("welcome"); const autoConnectAttempted = useRef(false); const lastRealtimeEventAt = useRef(0);
  const Page = pages[page] ?? DashboardPage;
  const deviceReady = Boolean(device && ["ready", "demo"].includes(device.status));
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("page");
    if (requested && pages[requested] && requested !== useAppStore.getState().page) useAppStore.getState().setPage(requested);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); useAppStore.getState().setPage("rigs"); }
    }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!testRigReturn) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [testRigReturn]);
  useEffect(() => {
    if (deviceReady && !preferences.firstWriteResolved) {
      if (preferences.writeMode === "ask") useAppStore.getState().setPreference("writeMode", "immediate");
      const timer = window.setTimeout(() => setWritePrompt(true), 700); return () => clearTimeout(timer);
    }
  }, [deviceReady, page, preferences.writeMode, preferences.firstWriteResolved]);
  useEffect(() => {
    if (!deviceApi.isNative()) return;
    let disposed = false;
    let unlisten: () => void = () => undefined;
    const refreshScheduler = createAsyncRefreshScheduler(
      () => useAppStore.getState().refreshPage(undefined, "websocket"),
      {
        debounceMs: 100,
        minIntervalMs: 600,
        onError: (error) => useAppStore.getState().addDiagnostic({
          level: "warning",
          source: "Live updates",
          message: "Could not apply a realtime device update",
          detail: deviceErrorDetail(error),
        }),
      },
    );
    void deviceApi.onDeviceEvent(() => {
      if (disposed) return;
      const liveState = useAppStore.getState();
      if (liveState.page === "tools" && liveState.performanceTunerActive) return;
      lastRealtimeEventAt.current = Date.now();
      refreshScheduler.trigger();
    }, (error) => {
      const state = useAppStore.getState();
      state.addDiagnostic({ level: "warning", source: "Live updates", message: "Realtime updates paused; HTTP polling is still active", detail: deviceErrorDetail(error) });
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; })
      .catch((error) => { if (!disposed) useAppStore.getState().addDiagnostic({ level: "warning", source: "Live updates", message: "Could not start realtime updates; HTTP polling is active", detail: deviceErrorDetail(error) }); });
    return () => { disposed = true; refreshScheduler.cancel(); unlisten(); };
  }, []);
  useEffect(() => {
    if (!deviceApi.isNative() || !preferences.autoDiscovery || device || autoConnectAttempted.current) return;
    if (useAppStore.getState().connectionBusy) return;
    autoConnectAttempted.current = true;
    void useAppStore.getState().connect(primaryConnectionAddress(preferences.address, preferences.modelAddress));
  }, [device, preferences.address, preferences.modelAddress, preferences.autoDiscovery]);
  useEffect(() => {
    if (!deviceApi.isNative() || !device) return;
    const fast = ["dashboard", "editor", "live", "assignments", "tools"].includes(page);
    const poll = window.setInterval(() => {
      const state = useAppStore.getState();
      const realtimeIsHealthy = Date.now() - lastRealtimeEventAt.current < 5_000;
      if (document.visibilityState === "visible" && !realtimeIsHealthy && !(page === "tools" && state.performanceTunerActive)) void state.refreshPage(page, "poll");
    }, fast ? 2_500 : 6_000);
    const reconcile = window.setInterval(() => {
      const state = useAppStore.getState();
      if (document.visibilityState === "visible" && !(page === "tools" && state.performanceTunerActive)) void state.refreshFull("poll");
    }, 120_000);
    void useAppStore.getState().refreshPage(page, "manual");
    return () => { window.clearInterval(poll); window.clearInterval(reconcile); };
  }, [device, page]);
  const finishOnboarding = (mode: "immediate" | "staged") => { resolve(mode); setWritePrompt(false); setOnboardingStep("welcome"); };
  return <AppShell overlay={!deviceReady ? <DeviceConnectionGate/> : undefined}><Suspense fallback={<PageLoading/>}><Page /></Suspense><Dialog open={writePrompt} onClose={() => finishOnboarding("immediate")} title={onboardingStep === "welcome" ? `Welcome to ${RUSHLINK_BRAND}` : "Choose how changes reach the pedal"} description={onboardingStep === "welcome" ? "A quick safety setup before you edit or perform." : "You can change this at any time in Settings."} footer={onboardingStep === "welcome" ? <Button variant="primary" onClick={() => setOnboardingStep("safety")}>Continue <ArrowRight size={15}/></Button> : undefined}>
    {onboardingStep === "welcome" ? <div className="onboarding-welcome"><RushLinkBrand className="onboarding-brand" artwork="full"/><div className="onboarding-progress" aria-label="Onboarding step 1 of 2"><i className="active"/><i/></div><span className="onboarding-hero"><ShieldCheck size={25}/></span><h3>Connected editing with a safe way back</h3><p>RushLink mirrors your current rig, keeps a local change history and clearly marks temporary audition or preview sessions.</p><div className="onboarding-capabilities"><span><RadioTower size={17}/><strong>{device ? `${device.name} ready` : "Device discovery ready"}</strong><small>{device ? "Connection detected" : "RushLink will look on your local network"}</small></span><span><Library size={17}/><strong>Restore points stay explicit</strong><small>Create one from Library &amp; Backup before a major session.</small></span></div></div> : <><div className="onboarding-progress" aria-label="Onboarding step 2 of 2"><i className="active"/><i className="active"/></div><div className="write-choice"><button onClick={() => finishOnboarding("immediate")}><span><PlugZap size={20} /></span><div><strong>Apply immediately</strong><p>Recommended for normal editing. The pedal follows each completed control change.</p></div><Check size={16} /></button><button onClick={() => finishOnboarding("staged")}><span><Save size={20} /></span><div><strong>Review before applying</strong><p>Keep changes in RushLink until you press Apply.</p></div></button></div><div className="dialog-note"><AlertTriangle size={15} /> Deletion, replacement and bulk restore operations still require confirmation.</div></>}
  </Dialog><RushLinkContextMenu/></AppShell>;
}
