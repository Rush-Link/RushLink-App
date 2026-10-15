import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Activity, Check, ChevronDown, ChevronLeft, ChevronRight, Cloud, Command, Cpu, ExternalLink, Gauge, HardDrive, LayoutDashboard, Library, ListMusic, Menu, RadioTower, RotateCcw, Settings, Sparkles, Workflow, Wrench, Wifi } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import { Button, IconButton } from "../ui";
import { ConnectionOrb, CpuIndicator } from "./controls";
import { preloadPage } from "../../page-loaders";
import { RUSHLINK_BRAND, RushLinkBrand } from "./rushlink-mark";
import { ShellNavigationContext } from "./shell-navigation";
import { TABLET_VIEWPORT } from "../../hooks/use-tablet-layout";

const SUPPORT_URL = "https://ko-fi.com/mattc_";

export const navigation = [
  { id: "dashboard", label: "Overview", shortLabel: "Home", icon: LayoutDashboard },
  { id: "editor", label: "Rig Editor", shortLabel: "Editor", icon: Workflow },
  { id: "rigs", label: "Rigs & Setlists", shortLabel: "Rigs", icon: ListMusic },
  { id: "live", label: "StageHand", shortLabel: "StageHand", icon: RadioTower, accent: true },
  { id: "tone-cloud", label: "ToneMod", shortLabel: "ToneMod", icon: Cloud, accent: true },
  { id: "tools", label: "Performance Tools", shortLabel: "Tools", icon: Wrench },
  { id: "library", label: "Library & Backup", shortLabel: "Library", icon: Library },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: Settings },
  { id: "diagnostics", label: "Diagnostics", shortLabel: "Logs", icon: Activity },
];

export function AppShell({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const desktopCollapsed = useAppStore((s) => s.sidebarCollapsed);
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
  const [tabletMenuExpanded, setTabletMenuExpanded] = useState(false);
  const [supportError, setSupportError] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 760px)").matches) && !window.matchMedia?.(TABLET_VIEWPORT).matches);
  const [tabletViewport, setTabletViewport] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(TABLET_VIEWPORT)?.matches));
  const restoreNavigationFocus = useRef(false);
  const collapsed = mobileViewport ? false : tabletViewport ? !tabletMenuExpanded : desktopCollapsed;
  const toggleNavigation = useCallback(() => {
    if (mobileViewport) setMobileNavigationOpen((open) => !open);
    else if (tabletViewport) setTabletMenuExpanded((open) => !open);
    else toggleSidebar();
  }, [mobileViewport, tabletViewport, toggleSidebar]);
  const current = navigation.find((item) => item.id === (page === "setlists" ? "rigs" : page)) ?? navigation[0];
  const deviceReady = Boolean(device && ["ready", "demo"].includes(device.status));
  const navigate = (next: string) => { setPage(next); setMobileNavigationOpen(false); };
  const openSupport = (event: MouseEvent<HTMLAnchorElement>) => {
    setSupportError(false);
    if (!isTauri()) {
      setMobileNavigationOpen(false);
      return;
    }
    event.preventDefault();
    void openUrl(SUPPORT_URL)
      .then(() => setMobileNavigationOpen(false))
      .catch(() => setSupportError(true));
  };
  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavigationOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileNavigationOpen]);
  useEffect(() => {
    const mobile = window.matchMedia?.("(max-width: 760px)");
    const tablet = window.matchMedia?.(TABLET_VIEWPORT);
    if (!mobile || !tablet) return;
    const update = () => {
      const mobileMatches = mobile.matches && !tablet.matches;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && (
        tablet.matches && focused.closest(".topbar, .statusbar, .sidebar__bottom") ||
        !tablet.matches && focused.closest(".brand__menu, .sidebar__session-actions") ||
        !mobileMatches && focused.closest(".mobile-menu, .collapse-button--mobile, .sidebar-scrim") ||
        mobileMatches && focused.closest(".sidebar")
      )) restoreNavigationFocus.current = true;
      setMobileViewport(mobileMatches);
      setTabletViewport(tablet.matches);
      if (!mobileMatches) setMobileNavigationOpen(false);
      if (!tablet.matches) setTabletMenuExpanded(false);
    };
    update(); mobile.addEventListener("change", update); tablet.addEventListener("change", update);
    return () => { mobile.removeEventListener("change", update); tablet.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    if (!restoreNavigationFocus.current) return;
    restoreNavigationFocus.current = false;
    document.querySelector<HTMLButtonElement>(tabletViewport ? ".brand__menu" : mobileViewport ? ".mobile-menu" : ".collapse-button--desktop")?.focus();
  }, [mobileViewport, tabletViewport]);
  useEffect(() => {
    if (!mobileViewport || !mobileNavigationOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    sidebar?.querySelector<HTMLButtonElement>(".sidebar__nav button.active, .sidebar__nav button")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !sidebar) return;
      const targets = Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = targets[0]; const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", trapFocus);
      const trigger = document.querySelector<HTMLButtonElement>(".mobile-menu");
      if (trigger?.getClientRects().length) trigger.focus({ preventScroll: true });
    };
  }, [mobileNavigationOpen, mobileViewport]);
  const writeState = pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} pending` : syncBusy ? "Synchronising" : device ? "Live connection" : "Ready to connect";
  return <ShellNavigationContext.Provider value={{ collapsed: mobileViewport ? !mobileNavigationOpen : collapsed, toggle: toggleNavigation }}><div className={cn("app", !deviceReady && "app--offline", collapsed && "app--collapsed", tabletViewport && "app--tablet", mobileViewport && "app--phone", mobileNavigationOpen && "app--mobile-nav-open", `density-${preferences.density}`, preferences.reduceMotion && "reduce-motion", preferences.highContrast && "high-contrast")}>
    <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)} />
    <aside className="sidebar" aria-label="Primary navigation" aria-hidden={!deviceReady || mobileViewport && !mobileNavigationOpen || undefined} inert={!deviceReady || mobileViewport && !mobileNavigationOpen || undefined}>
      <div className="brand">
        {tabletViewport ? <button type="button" className="brand__menu" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} aria-controls="primary-navigation-menu" title={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={toggleNavigation}>
          <RushLinkBrand/>{collapsed ? <Menu className="brand__menu-glyph" size={15} aria-hidden="true"/> : <ChevronLeft className="brand__menu-glyph" size={15} aria-hidden="true"/>}
        </button> : <RushLinkBrand/>}
        {!collapsed && <div className="brand__connection" aria-live="polite">
          <span className="brand__connection-name"><ConnectionOrb status={device?.status ?? "offline"}/><strong>{device?.name ?? "Connect HeadRush"}</strong></span>
          <span className="brand__connection-host">{device?.host ?? "No device selected"}</span>
        </div>}
      </div>
      {(tabletViewport || mobileViewport) && (pending > 0 || testRigReturn) && <div className="sidebar__session-actions" aria-label="Current session">
        {pending > 0 && <Button className="sidebar__session-action" variant="primary" aria-label={`Apply ${pending} pending change${pending === 1 ? "" : "s"}`} title={`Apply ${pending} pending change${pending === 1 ? "" : "s"}`} onClick={() => void applyPending()}><Check size={18}/><span>{pending} pending · Apply</span><small>Apply</small><b aria-hidden="true">{pending}</b></Button>}
        {testRigReturn && <Button className="sidebar__session-action" aria-label={`${auditioningToneId ? "Audition active" : "Return pending"}: open ToneMod`} title={auditioningToneId ? "Audition active: open ToneMod" : "Return pending: open ToneMod"} onClick={() => navigate("tone-cloud")}><RotateCcw size={18}/><span>{auditioningToneId ? "Audition active" : "Return pending"}</span><small>Session</small></Button>}
      </div>}
      <nav id="primary-navigation-menu" className="sidebar__nav">
        <span className="nav-section">{!collapsed && "WORKSPACE"}</span>
        {navigation.slice(0, 7).map((item) => <button key={item.id} aria-label={item.label} className={cn((page === item.id || page === "setlists" && item.id === "rigs") && "active", item.accent && "accent")} onPointerEnter={() => preloadPage(item.id)} onFocus={() => preloadPage(item.id)} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}>
          <item.icon size={19} /><span>{tabletViewport && collapsed ? item.shortLabel : item.label}</span>{item.id === "editor" && pending > 0 && <b>{pending}</b>}
        </button>)}
        <span className="nav-section">{!collapsed && "SYSTEM"}</span>
        {navigation.slice(7).map((item) => <button key={item.id} aria-label={item.label} className={cn(page === item.id && "active")} onPointerEnter={() => preloadPage(item.id)} onFocus={() => preloadPage(item.id)} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}><item.icon size={19} /><span>{tabletViewport && collapsed ? item.shortLabel : item.label}</span></button>)}
        <a className="sidebar__support" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" aria-label="Support RushLink by Cygma Audio on Ko-fi (opens external site)" title="Support RushLink by Cygma Audio on Ko-fi (opens external site)" onClick={openSupport}>
          <svg className="sidebar__support-logo" width="19" height="19" viewBox="4 6 19 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8h11v7a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Zm11 2h1a3 3 0 0 1 0 6h-1M9 12c0-2 3-2 3 0 0-2 3-2 3 0 0 2-3 4-3 4s-3-2-3-4Z"/></svg>
          <span className="sidebar__support-label">{tabletViewport && collapsed ? "Support" : "Support RushLink"}</span>
          <ExternalLink className="sidebar__support-external" size={14} aria-hidden="true"/>
        </a>
        {supportError && <p className="sidebar__support-error" role="alert">Couldn’t open Ko-fi. Try again, or visit ko-fi.com/mattc_ in your browser.</p>}
      </nav>
      <div className="sidebar__bottom">
        <button className="collapse-button collapse-button--desktop" aria-expanded={!collapsed} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleSidebar}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}<span>{collapsed ? "Expand" : "Collapse"}</span></button>
        <button className="collapse-button collapse-button--mobile" onClick={() => setMobileNavigationOpen(false)}><ChevronLeft size={16} /><span>Close navigation</span></button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar" hidden={tabletViewport} inert={!deviceReady || tabletViewport || undefined}>
        <IconButton label={mobileNavigationOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavigationOpen} aria-controls="primary-navigation-menu" className="mobile-menu" onClick={() => setMobileNavigationOpen((open) => !open)}>{mobileViewport ? <><RushLinkBrand/><ChevronDown size={15}/></> : <Menu size={19}/>}</IconButton>
        <div className="topbar__title"><current.icon size={18} /><span>{current.label}</span></div>
        {mobileViewport && <div className="phone-session-actions">
          {testRigReturn && <IconButton label="Open audition session" onClick={() => navigate("tone-cloud")}><RotateCcw size={17}/></IconButton>}
          {pending > 0 && <Button aria-label={`Apply ${pending} pending change${pending === 1 ? "" : "s"}`} onClick={() => void applyPending()}><Check size={16}/>{pending}</Button>}
        </div>}
        <div className="topbar__center"><button className="command-trigger" onClick={() => navigate("rigs")}><Command size={15} /><span>Search the rig library</span><kbd>Ctrl K</kbd></button></div>
        <div className="topbar__status">
          <CpuIndicator value={live?.cpuPercent ?? 0} />
          <span className={cn("device-session", !device && "device-session--offline", pending > 0 && "device-session--pending")} aria-live="polite"><Wifi size={14} /><span><strong>{writeState}</strong><small>{live?.rig.name ?? device?.name ?? "Connect a HeadRush"}</small></span></span>
          {testRigReturn && page !== "tone-cloud" && <Button size="sm" variant="outline" onClick={() => setPage("tone-cloud")}><RotateCcw size={13}/> {auditioningToneId ? "Audition active" : "Return pending"}</Button>}
          {pending > 0 && <Button variant="primary" size="sm" onClick={() => void applyPending()}>{pending} pending · Apply</Button>}
          <ConnectionOrb status={device?.status ?? "offline"} />
        </div>
      </header>
      <div className="app-content"><div className="app-workspace" aria-hidden={!deviceReady || mobileViewport && mobileNavigationOpen || undefined} inert={!deviceReady || mobileViewport && mobileNavigationOpen || undefined}>{children}</div>{overlay}</div>
      <footer className="statusbar" hidden={tabletViewport || mobileViewport} inert={!deviceReady || tabletViewport || undefined}>
        <span><ConnectionOrb status={device?.status ?? "offline"} /> {device ? `${device.name} · ${device.status === "demo" ? "Demo session" : "Connected"}` : "Connect a HeadRush"}</span>
        <span><Gauge size={13} /> {device?.latencyMs ?? "—"} ms</span>
        <span><Cpu size={13} /> Engine {live ? `${live.cpuPercent}%` : "—"}</span>
        <span><HardDrive size={13} /> Storage {live ? `${live.storage.usedPercent}%` : "—"}</span>
        <span className="statusbar__right"><Sparkles size={13} /> {RUSHLINK_BRAND} · 0.1.3</span>
      </footer>
    </main>
  </div></ShellNavigationContext.Provider>;
}
