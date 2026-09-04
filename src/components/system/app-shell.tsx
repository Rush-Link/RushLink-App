import { useEffect, useState, type ReactNode } from "react";
import { Activity, ChevronLeft, ChevronRight, Cloud, Command, Cpu, Gauge, HardDrive, LayoutDashboard, Library, ListMusic, Menu, RadioTower, RotateCcw, Settings, Sparkles, Workflow, Wrench, Wifi } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import { Button, IconButton } from "../ui";
import { ConnectionOrb, CpuIndicator } from "./controls";
import { preloadPage } from "../../page-loaders";
import { RushLinkMark } from "./rushlink-mark";

export const navigation = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "editor", label: "Rig Editor", icon: Workflow },
  { id: "rigs", label: "Rigs & Setlists", icon: ListMusic },
  { id: "live", label: "StageHand", icon: RadioTower, accent: true },
  { id: "tone-cloud", label: "TonePilot", icon: Cloud, accent: true },
  { id: "tools", label: "Performance Tools", icon: Wrench },
  { id: "library", label: "Library & Backup", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
];

export function AppShell({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const device = useAppStore((s) => s.device);
  const live = useAppStore((s) => s.liveSnapshot);
  const syncBusy = useAppStore((s) => s.syncBusy);
  const pending = useAppStore((s) => s.pendingWrites.length);
  const testRigReturn = useAppStore((s) => s.testRigReturn);
  const auditioningToneId = useAppStore((s) => s.auditioningToneId);
  const preferences = useAppStore((s) => s.preferences);
  const applyPending = useAppStore((s) => s.applyPending);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 760px)").matches));
  const current = navigation.find((item) => item.id === (page === "setlists" ? "rigs" : page)) ?? navigation[0];
  const deviceReady = Boolean(device && ["ready", "demo"].includes(device.status));
  const navigate = (next: string) => { setPage(next); setMobileNavigationOpen(false); };
  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavigationOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileNavigationOpen]);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 760px)");
    if (!query) return;
    const update = () => { setMobileViewport(query.matches); if (!query.matches) setMobileNavigationOpen(false); };
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileViewport || !mobileNavigationOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileNavigationOpen, mobileViewport]);
  const writeState = pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} pending` : syncBusy ? "Synchronising" : device ? "Live connection" : "Ready to connect";
  return <div className={cn("app", !deviceReady && "app--offline", collapsed && "app--collapsed", mobileNavigationOpen && "app--mobile-nav-open", `density-${preferences.density}`, preferences.reduceMotion && "reduce-motion", preferences.highContrast && "high-contrast")}>
    <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)} />
    <aside className="sidebar" aria-label="Primary navigation" aria-hidden={!deviceReady || mobileViewport && !mobileNavigationOpen || undefined} inert={!deviceReady || mobileViewport && !mobileNavigationOpen || undefined}>
      <div className="brand">
        <span className="brand__mark"><RushLinkMark title="RushLink"/></span>
        {!collapsed && <div className="brand__connection" aria-live="polite">
          <span className="brand__connection-name"><ConnectionOrb status={device?.status ?? "offline"}/><strong>{device?.name ?? "Connect HeadRush"}</strong></span>
          <span className="brand__connection-host">{device?.host ?? "No device selected"}</span>
        </div>}
      </div>
      <nav className="sidebar__nav">
        <span className="nav-section">{!collapsed && "WORKSPACE"}</span>
        {navigation.slice(0, 7).map((item) => <button key={item.id} className={cn((page === item.id || page === "setlists" && item.id === "rigs") && "active", item.accent && "accent")} onPointerEnter={() => preloadPage(item.id)} onFocus={() => preloadPage(item.id)} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}>
          <item.icon size={19} /><span>{item.label}</span>{item.id === "editor" && pending > 0 && <b>{pending}</b>}
        </button>)}
        <span className="nav-section">{!collapsed && "SYSTEM"}</span>
        {navigation.slice(7).map((item) => <button key={item.id} className={cn(page === item.id && "active")} onPointerEnter={() => preloadPage(item.id)} onFocus={() => preloadPage(item.id)} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}><item.icon size={19} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar__bottom">
        <button className="collapse-button collapse-button--desktop" aria-expanded={!collapsed} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleSidebar}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}<span>{collapsed ? "Expand" : "Collapse"}</span></button>
        <button className="collapse-button collapse-button--mobile" onClick={() => setMobileNavigationOpen(false)}><ChevronLeft size={16} /><span>Close navigation</span></button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar" inert={!deviceReady || undefined}>
        <IconButton label={mobileNavigationOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavigationOpen} className="mobile-menu" onClick={() => setMobileNavigationOpen((open) => !open)}><Menu size={19} /></IconButton>
        <div className="topbar__title"><current.icon size={18} /><span>{current.label}</span></div>
        <div className="topbar__center"><button className="command-trigger" onClick={() => navigate("rigs")}><Command size={15} /><span>Search the rig library</span><kbd>Ctrl K</kbd></button></div>
        <div className="topbar__status">
          <CpuIndicator value={live?.cpuPercent ?? 0} />
          <span className={cn("device-session", !device && "device-session--offline", pending > 0 && "device-session--pending")} aria-live="polite"><Wifi size={14} /><span><strong>{writeState}</strong><small>{live?.rig.name ?? device?.name ?? "Connect a HeadRush"}</small></span></span>
          {testRigReturn && page !== "tone-cloud" && <Button size="sm" variant="outline" onClick={() => setPage("tone-cloud")}><RotateCcw size={13}/> {auditioningToneId ? "Audition active" : "Return pending"}</Button>}
          {pending > 0 && <Button variant="primary" size="sm" onClick={() => void applyPending()}>{pending} pending · Apply</Button>}
          <ConnectionOrb status={device?.status ?? "offline"} />
        </div>
      </header>
      <div className="app-content"><div className="app-workspace" aria-hidden={!deviceReady || undefined} inert={!deviceReady || undefined}>{children}</div>{overlay}</div>
      <footer className="statusbar" inert={!deviceReady || undefined}>
        <span><ConnectionOrb status={device?.status ?? "offline"} /> {device ? `${device.name} · ${device.status === "demo" ? "Demo session" : "Connected"}` : "Connect a HeadRush"}</span>
        <span><Gauge size={13} /> {device?.latencyMs ?? "—"} ms</span>
        <span><Cpu size={13} /> Engine {live ? `${live.cpuPercent}%` : "—"}</span>
        <span><HardDrive size={13} /> Storage {live ? `${live.storage.usedPercent}%` : "—"}</span>
        <span className="statusbar__right"><Sparkles size={13} /> RushLink 0.1.0</span>
      </footer>
    </main>
  </div>;
}
