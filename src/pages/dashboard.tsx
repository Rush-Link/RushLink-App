import { AlertTriangle, ArrowRight, Cloud, Cpu, Guitar, HardDrive, ListMusic, RadioTower, RefreshCw, SlidersHorizontal, Timer } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { Badge, Button, Card, Progress } from "../components/ui";
import { ConnectionOrb } from "../components/system/controls";
import { cn } from "../lib/utils";
import { PhonePager } from "../components/system/phone-pager";

export function DashboardPage() {
  const store = useAppStore();
  const live = store.liveSnapshot;
  const rig = live?.rig ?? store.rigs[0];
  const synced = live ? new Date(live.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not synced";
  return <div className="page page-dashboard dashboard-live">
    <div className="overview-heading">
      <div><span className="eyebrow">LIVE DEVICE OVERVIEW</span><h1>{rig?.name ?? "Connect your HeadRush"}</h1><p>{live ? `${live.deviceName} · firmware ${live.firmware} · updated ${synced}` : "Connect to read the current unit state."}</p></div>
      <div className="overview-heading__actions"><Badge tone={store.device ? "green" : "neutral"}><ConnectionOrb status={store.device?.status ?? "offline"} /> {store.syncBusy ? "SYNCING" : store.device ? "LIVE" : "OFFLINE"}</Badge><Button loading={store.syncBusy || store.connectionBusy} onClick={() => store.device ? void store.refreshFull("manual") : void store.connect(store.preferences.address)}><RefreshCw size={15} /> Refresh now</Button></div>
    </div>
    {store.connectionError && <div className="connection-recovery" role="alert"><AlertTriangle size={18}/><span><strong>RushLink could not reach the pedal</strong><small>{store.connectionError}</small></span><Button size="sm" onClick={() => void store.connect(store.preferences.address)}>Try again</Button></div>}

    <PhonePager label="Overview" labels={["Current rig", "Device status", "Shortcuts"]}>
    <Card className="active-rig-card">
      <div className="active-rig-card__head"><div><Badge tone="violet">CURRENT RIG</Badge><h2>{rig?.name ?? "No active rig"}</h2><p>{live ? `${live.routing.label} path · ${live.routing.stereo ? "stereo" : "mono"} · tails ${live.routing.tails ? "on" : "off"}` : "Live signal path appears after connection."}</p></div><Button variant="primary" onClick={() => store.setPage("editor")}><SlidersHorizontal size={15} /> Open editor</Button></div>
      <div className="overview-chain">{Array.from({ length: 14 }, (_, index) => {
        const block = rig?.blocks[index];
        return <button key={index} className={cn("overview-slot", block?.empty && "empty", block && !block.enabled && "bypassed")} style={{ "--slot-color": block?.color ?? "#354150" } as React.CSSProperties} onClick={() => { if (block && !block.empty) store.selectBlock(block.id); store.setPage("editor"); }}><span>{index + 1}</span><strong>{block?.name ?? "Empty Slot"}</strong><small>{block?.empty ? "AVAILABLE" : block?.enabled ? "ON" : "BYPASSED"}</small></button>;
      })}</div>
    </Card>

    <section className="live-metrics">
      <Card><Timer size={18} /><div><span>TEMPO</span><strong>{rig?.tempo ? Math.round(rig.tempo) : "—"} <small>BPM</small></strong><p>Current rig tempo</p></div></Card>
      <Card><Cpu size={18} /><div><span>ENGINE</span><strong>{live?.cpuPercent ?? "—"}<small>%</small></strong><Progress value={live?.cpuPercent ?? 0} tone={(live?.cpuPercent ?? 0) > 80 ? "amber" : "green"} /></div></Card>
      <Card><HardDrive size={18} /><div><span>STORAGE</span><strong>{live?.storage.usedPercent ?? "—"}<small>% used</small></strong><p>{live?.storage.usedLabel || live?.storage.capacityLabel || "Awaiting device"}</p></div></Card>
      <Card><ListMusic size={18} /><div><span>SETLIST</span><strong>{live?.loadedSetlistName ?? "—"}</strong><p>{live?.setlists.find((item) => item.loaded)?.count ?? 0} rigs</p></div></Card>
    </section>

    <div className="overview-lower">
      <Card className="overview-switches"><div className="section-heading"><div><span className="eyebrow">PHYSICAL CONTROLS</span><h2>Flex Prime footswitches</h2></div><Button size="sm" onClick={() => store.setPage("assignments")}>Assignments <ArrowRight size={14} /></Button></div><div>{live?.footswitches.map((footswitch) => <span key={footswitch.number} style={{ "--fs-color": footswitch.color } as React.CSSProperties} className={cn(footswitch.enabled && "active")}><i>FS {footswitch.number}</i><strong>{footswitch.label}</strong><small>{footswitch.mode}{footswitch.sceneActive ? " · active scene" : ""}</small></span>) ?? <p>Connect to inspect current assignments.</p>}</div></Card>
      <Card className="overview-actions"><button onClick={() => store.setPage("live")}><RadioTower size={19} /><div><strong>StageHand</strong><span>Open performance controls</span></div><ArrowRight size={14} /></button><button onClick={() => store.setPage("tone-cloud")}><Cloud size={19} /><div><strong>ToneMod</strong><span>{live?.tone3000.loggedIn && live?.cloud.loggedIn ? "Both services connected" : "Browse cloud tones"}</span></div><ArrowRight size={14} /></button><button onClick={() => store.setPage("rigs")}><Guitar size={19} /><div><strong>{live?.rigLibrary.length ?? store.rigs.length} rigs</strong><span>Browse device library</span></div><ArrowRight size={14} /></button></Card>
    </div>
    </PhonePager>
  </div>;
}
