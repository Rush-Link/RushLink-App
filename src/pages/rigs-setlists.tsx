import { useMemo, useState, type CSSProperties } from "react";
import {
  Check, ChevronRight, Clock3, Copy, Download, Gauge, GripVertical, Guitar,
  Heart, LayoutGrid, List, ListMusic, LoaderCircle, Pencil, Play, Plus, RefreshCw,
  Save, Search, SlidersHorizontal, Sparkles, Trash2,
} from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, IconButton, Input, Select, Tabs } from "../components/ui";
import { availableFavoriteRigIds } from "../domain/rig-favorites";
import type { Rig } from "../domain/types";
import { cn } from "../lib/utils";
import { useAppStore } from "../stores/app-store";
import { PageTitle } from "../components/system/page-title";
import "../styles/device-library.css";
import "../styles/setlist-device-data.css";

type RigView = "grid" | "list";
type RigFilter = "all" | "favorites" | "loaded";
type RigSort = "device" | "name" | "tempo";
type RigDialog = "new" | "rename" | "duplicate" | null;
type SetlistDialog = "new" | "rename" | "add" | null;
type RigAction = { rigId: string; type: "play" | "edit" } | null;

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LibraryNavigation({ value }: { value: "rigs" | "setlists" }) {
  const store = useAppStore();
  const options = [
    { id: "rigs" as const, label: "Rig library", description: "Find, load and manage tones", icon: Guitar, count: store.rigs.length },
    { id: "setlists" as const, label: "Setlists", description: "Build your performance order", icon: ListMusic, count: store.setlists.length },
  ];
  return <nav className="library-section-switcher" aria-label="Rigs and setlists">
    {options.map((option) => <button key={option.id} className={value === option.id ? "active" : ""} aria-current={value === option.id ? "page" : undefined} onClick={() => store.setPage(option.id)}>
      <span className="library-section-switcher__icon"><option.icon size={19} /></span>
      <span><strong>{option.label}</strong><small>{option.description}</small></span>
      <Badge tone={value === option.id ? "cyan" : "neutral"}>{option.count}</Badge>
      <ChevronRight size={15} />
    </button>)}
  </nav>;
}

function LibrarySummary({ icon, label, value, detail, tone = "#6ee7f2" }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail?: string; tone?: string }) {
  return <div className="library-summary-card" style={{ "--summary-color": tone } as CSSProperties}>
    <span className="library-summary-card__icon">{icon}</span><span><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</span>
  </div>;
}

function RigSignalStrip({ rig }: { rig: Rig }) {
  const blocks = rig.blocks.filter((block) => !block.empty);
  return <div className="rig-signal-strip" aria-label={blocks.length ? `${blocks.length} occupied blocks` : "Block details load when this rig is opened"}>
    {Array.from({ length: 14 }, (_, index) => {
      const block = rig.blocks[index];
      return <i key={index} className={block && !block.empty ? "occupied" : ""} style={block && !block.empty ? { "--slot-color": block.color } as CSSProperties : undefined} />;
    })}
  </div>;
}

function RigLibraryEmpty({ filter, query, favoriteCount, onShowAll, onClearSearch, onRefresh }: { filter: RigFilter; query: string; favoriteCount: number; onShowAll: () => void; onClearSearch: () => void; onRefresh: () => void }) {
  const needle = query.trim();
  const noFavorites = filter === "favorites" && favoriteCount === 0;
  const favoriteSearchMiss = filter === "favorites" && favoriteCount > 0 && Boolean(needle);
  const currentMissing = filter === "loaded";
  const searchMiss = Boolean(needle);
  const Icon = noFavorites || favoriteSearchMiss ? Heart : currentMissing ? Play : searchMiss ? Search : Guitar;
  const eyebrow = noFavorites || favoriteSearchMiss ? "FAVOURITES" : currentMissing ? "CURRENT RIG" : searchMiss ? "SEARCH RESULTS" : "DEVICE LIBRARY";
  const title = noFavorites ? "Save the rigs you reach for" : favoriteSearchMiss ? "No favourites match this search" : currentMissing ? "No current rig reported" : searchMiss ? `No rigs match “${needle}”` : "No rigs reported by the device";
  const description = noFavorites ? "Use the heart on any rig to build a focused collection for rehearsals, sessions and live sets." : favoriteSearchMiss ? "Your favourites are still here. Clear the search to see the complete collection." : currentMissing ? "The pedal has not reported its loaded rig yet. You can continue browsing the complete library." : searchMiss ? "Try a shorter name, an author, or one of the rig’s tags." : "Refresh the device library after the connection is ready.";
  const action = noFavorites || currentMissing ? { label: "Browse all rigs", icon: <Guitar size={15}/>, run: onShowAll } : searchMiss ? { label: "Clear search", icon: <Search size={15}/>, run: onClearSearch } : { label: "Refresh library", icon: <RefreshCw size={15}/>, run: onRefresh };
  return <Card className={cn("rig-library-empty", noFavorites && "rig-library-empty--favorites")} role="status" aria-live="polite">
    <span className="rig-library-empty__visual"><i/><Icon size={28}/></span>
    <div className="rig-library-empty__copy"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p><Button variant="primary" onClick={action.run}>{action.icon}{action.label}</Button></div>
    <aside><Heart size={17}/><span><strong>Quick access without device changes</strong><small>Favourite markers belong to RushLink and do not modify the saved rig on your pedal.</small></span></aside>
  </Card>;
}

export function RigsPage() {
  const store = useAppStore();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RigView>("grid");
  const [filter, setFilter] = useState<RigFilter>("all");
  const [sort, setSort] = useState<RigSort>("device");
  const [dialog, setDialog] = useState<RigDialog>(null);
  const [name, setName] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [rigAction, setRigAction] = useState<RigAction>(null);
  const loadedRigId = store.liveSnapshot?.rig.id;
  const availableFavoriteIds = useMemo(
    () => availableFavoriteRigIds(store.rigs, store.favoriteRigIds),
    [store.rigs, store.favoriteRigIds],
  );
  const favorites = useMemo(() => new Set(availableFavoriteIds), [availableFavoriteIds]);
  const selected = store.rigs.find((rig) => rig.id === store.selectedRigId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const items = store.rigs.filter((rig) => {
      if (filter === "favorites" && !favorites.has(rig.id)) return false;
      if (filter === "loaded" && rig.id !== loadedRigId) return false;
      return !needle || `${rig.name} ${rig.author} ${rig.tags.join(" ")}`.toLocaleLowerCase().includes(needle);
    });
    if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "tempo") items.sort((a, b) => (b.tempo || -1) - (a.tempo || -1));
    return items;
  }, [favorites, filter, loadedRigId, query, sort, store.rigs]);

  const srIdFor = (rigId: string) => store.liveSnapshot?.rigLibrary.find((rig) => rig.id === rigId)?.srId;
  const playRig = async (rig: Rig) => {
    store.selectRig(rig.id);
    if (rig.id === loadedRigId) return;
    setRigAction({ rigId: rig.id, type: "play" });
    try {
      await store.loadRig(rig.id, srIdFor(rig.id));
    } finally {
      setRigAction(null);
    }
  };
  const editRig = async (rig: Rig) => {
    store.selectRig(rig.id);
    setRigAction({ rigId: rig.id, type: "edit" });
    try {
      if (rig.id !== loadedRigId) await store.loadRig(rig.id, srIdFor(rig.id));
      store.setPage("editor");
    } finally {
      setRigAction(null);
    }
  };
  const openDialog = (next: Exclude<RigDialog, null>, rig?: Rig) => {
    if (rig) store.selectRig(rig.id);
    setName(next === "new" ? "New Rig" : next === "duplicate" ? `${rig?.name ?? selected?.name ?? "Rig"} Copy` : rig?.name ?? selected?.name ?? "");
    setDialog(next);
  };
  const executeDialog = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    setDialogBusy(true);
    try {
      if (dialog === "new") await store.createRig(nextName);
      if (dialog === "rename" && selected) await store.renameRig(selected.id, nextName);
      if (dialog === "duplicate" && selected) {
        if (selected.id !== loadedRigId) await store.loadRig(selected.id, srIdFor(selected.id));
        await store.duplicateRig(nextName);
      }
      setDialog(null);
      setName("");
    } finally { setDialogBusy(false); }
  };

  return <div className="page device-library-page">
    <PageTitle eyebrow="DEVICE LIBRARY" title="Rigs & Setlists" description="A fast, organised view of every tone and performance list on your unit." actions={<>
      <Button onClick={() => void store.refreshPage("rigs", "manual")}><RefreshCw size={15} className={store.syncBusy ? "spin" : ""} /> Refresh</Button>
      <Button onClick={() => downloadJson("rushlink-rig-library.json", store.rigs)}><Download size={15} /> Export</Button>
      <Button variant="primary" onClick={() => openDialog("new")}><Plus size={15} /> New rig</Button>
    </>} />
    <LibraryNavigation value="rigs" />
    <section className="library-summary-grid" aria-label="Library summary">
      <LibrarySummary icon={<Guitar size={18} />} label="RIGS ON DEVICE" value={store.rigs.length} detail={`${filtered.length} visible`} />
      <LibrarySummary icon={<Heart size={18} />} label="FAVOURITES" value={availableFavoriteIds.length} detail="Saved in RushLink" tone="#f0bd5e" />
      <LibrarySummary icon={<ListMusic size={18} />} label="SETLISTS" value={store.setlists.length} detail={`${store.setlists.reduce((total, list) => total + list.items.length, 0)} placements`} tone="#a982ef" />
      <LibrarySummary icon={<Sparkles size={18} />} label="CURRENT RIG" value={store.liveSnapshot?.rig.name ?? selected?.name ?? "None"} tone="#59d4b2" />
    </section>
    <Card className="library-control-bar">
      <div className="search-input library-search"><Search size={16} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by rig, author or tag…" /></div>
      <div className="library-filter-pills" aria-label="Filter rigs">
        {(["all", "favorites", "loaded"] as RigFilter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All rigs" : item === "favorites" ? "Favourites" : "Current"}</button>)}
      </div>
      <label className="library-sort"><span>SORT</span><Select value={sort} onChange={(event) => setSort(event.target.value as RigSort)}><option value="device">Device order</option><option value="name">Name A–Z</option><option value="tempo">Tempo high–low</option></Select></label>
      <Tabs value={view} onValueChange={setView} items={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
    </Card>
    <div className="library-results-heading"><span><strong>{filtered.length} {filtered.length === 1 ? "rig" : "rigs"}</strong><small>{query ? `Matching “${query}”` : "Ready on this device"}</small></span><Badge tone={store.liveSnapshot ? "green" : "neutral"}>{store.liveSnapshot ? "LIVE DEVICE" : "DEMO LIBRARY"}</Badge></div>
    {filtered.length ? <section className={cn("rig-library-grid", view === "list" && "rig-library-grid--list")}>
      {filtered.map((rig) => {
        const isLoaded = rig.id === loadedRigId;
        const isFavorite = favorites.has(rig.id);
        const blockCount = rig.blocks.filter((block) => !block.empty).length;
        const isPlaying = rigAction?.rigId === rig.id && rigAction.type === "play";
        const isOpeningEditor = rigAction?.rigId === rig.id && rigAction.type === "edit";
        return <Card key={rig.id} interactive data-context-kind="rig" data-rig-id={rig.id} className={cn("rig-library-card", store.selectedRigId === rig.id && "selected", isLoaded && "loaded")} style={{ "--rig-color": rig.color } as CSSProperties} onClick={() => store.selectRig(rig.id)} onDoubleClick={() => void editRig(rig)}>
          <div className="rig-library-card__visual"><span className="rig-library-card__halo" /><Guitar size={26} />{isLoaded && <Badge tone="green">CURRENT</Badge>}<IconButton className={cn("rig-favorite", isFavorite && "active")} label={isFavorite ? `Remove ${rig.name} from favourites` : `Add ${rig.name} to favourites`} onClick={(event) => { event.stopPropagation(); store.toggleFavoriteRig(rig.id); }}><Heart size={15} fill={isFavorite ? "currentColor" : "none"} /></IconButton></div>
          <div className="rig-library-card__content"><div className="rig-library-card__title"><span><h2>{rig.name}</h2><p>{rig.author || "On device"}</p></span>{isLoaded && <i title="Loaded on device" />}</div><RigSignalStrip rig={rig} /><div className="rig-library-card__tags">{rig.tags.slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}{rig.tags.length > 3 && <Badge>+{rig.tags.length - 3}</Badge>}</div><div className="rig-library-card__facts"><span><b>{blockCount || "—"}</b><small>BLOCKS</small></span><span><b>{rig.tempo || "—"}</b><small>BPM</small></span><span><b>{rig.modified || "On device"}</b><small>UPDATED</small></span></div></div>
          <div className="rig-library-card__actions">
            <div className="rig-library-card__primary-actions">
              <Button size="sm" variant="ghost" className={cn("rig-play-action", isLoaded && "active")} aria-pressed={isLoaded} disabled={rigAction !== null} aria-label={isLoaded ? `${rig.name} is playing on the device` : `Load and play ${rig.name} without opening the editor`} onClick={(event) => { event.stopPropagation(); void playRig(rig); }}>{isPlaying ? <LoaderCircle size={15} className="spin" /> : <Play size={15} fill={isLoaded ? "currentColor" : "none"} />}<span>{isLoaded ? "Playing" : "Play"}</span></Button>
              <Button size="sm" variant="ghost" className="rig-edit-action" disabled={rigAction !== null} aria-label={`Edit ${rig.name} in the rig editor`} onClick={(event) => { event.stopPropagation(); void editRig(rig); }}>{isOpeningEditor ? <LoaderCircle size={15} className="spin" /> : <SlidersHorizontal size={15} />}<span>Edit</span></Button>
            </div>
            <IconButton label={`Duplicate ${rig.name}`} onClick={(event) => { event.stopPropagation(); openDialog("duplicate", rig); }}><Copy size={14} /></IconButton><IconButton label={`Rename ${rig.name}`} onClick={(event) => { event.stopPropagation(); openDialog("rename", rig); }}><Pencil size={14} /></IconButton><IconButton className="rig-delete" label={`Delete ${rig.name}`} onClick={(event) => { event.stopPropagation(); if (window.confirm(`Delete “${rig.name}” from the device?`)) void store.deleteRig(rig.id); }}><Trash2 size={14} /></IconButton>
          </div>
        </Card>;
      })}
    </section> : <RigLibraryEmpty filter={filter} query={query} favoriteCount={favorites.size} onShowAll={() => { setQuery(""); setFilter("all"); }} onClearSearch={() => setQuery("")} onRefresh={() => void store.refreshPage("rigs", "manual")}/>} 
    <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog === "new" ? "Create a new rig" : dialog === "rename" ? "Rename rig" : "Duplicate rig"} description={dialog === "duplicate" ? "RushLink will load the selected rig if needed, then save it as a new copy." : "This change is written directly to the connected device."} footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" loading={dialogBusy} disabled={!name.trim()} onClick={() => void executeDialog()}><Check size={15} /> {dialog === "new" ? "Create rig" : dialog === "rename" ? "Rename" : "Create copy"}</Button></>}><label className="form-field"><span>Rig name</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void executeDialog()} /></label></Dialog>
  </div>;
}

export function SetlistsPage() {
  const store = useAppStore();
  const [query, setQuery] = useState("");
  const [rigQuery, setRigQuery] = useState("");
  const [dragged, setDragged] = useState<number | null>(null);
  const [dialog, setDialog] = useState<SetlistDialog>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const selected = store.setlists.find((item) => item.id === store.selectedSetlistId) ?? store.setlists[0] ?? null;
  const visibleSetlists = store.setlists.filter((list) => list.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const addableRigs = store.rigs.filter((rig) => `${rig.name} ${rig.author} ${rig.tags.join(" ")}`.toLocaleLowerCase().includes(rigQuery.trim().toLocaleLowerCase()));
  const selectedRigs = selected?.items.map((item) => store.rigs.find((rig) => rig.id === item.rigId)).filter((rig): rig is Rig => Boolean(rig)) ?? [];
  const tempos = selectedRigs.map((rig) => rig.tempo).filter(Boolean);
  const markDirty = (id = selected?.id) => id && setDirtyIds((current) => new Set(current).add(id));
  const clearDirty = (id: string) => setDirtyIds((current) => { const next = new Set(current); next.delete(id); return next; });
  const srIdFor = (rigId: string) => store.liveSnapshot?.rigLibrary.find((rig) => rig.id === rigId)?.srId;
  const save = async () => { if (!selected) return; setBusy(true); try { await store.saveSelectedSetlist(); clearDirty(selected.id); } finally { setBusy(false); } };
  const openRig = async (rigId: string) => { await store.loadRig(rigId, srIdFor(rigId)); store.setPage("editor"); };
  const executeNameDialog = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (dialog === "new") await store.createSetlist(name.trim());
      if (dialog === "rename" && selected) await store.renameSetlist(selected.id, name.trim());
      setDialog(null); setName("");
    } finally { setBusy(false); }
  };

  return <div className="page device-library-page setlist-library-page">
    <PageTitle eyebrow="PERFORMANCE LIBRARY" title="Rigs & Setlists" description="Arrange the exact rig order you need on stage, then write it back to the unit." actions={<>
      <Button onClick={() => void store.refreshPage("setlists", "manual")}><RefreshCw size={15} className={store.syncBusy ? "spin" : ""} /> Refresh</Button>
      <Button disabled={!selected || !dirtyIds.has(selected.id)} loading={busy} onClick={() => void save()}><Save size={15} /> Save changes</Button>
      <Button variant="primary" onClick={() => { setName("New Setlist"); setDialog("new"); }}><Plus size={15} /> New setlist</Button>
    </>} />
    <LibraryNavigation value="setlists" />
    <div className="setlist-studio">
      <Card className="setlist-browser-panel">
        <div className="setlist-browser-panel__head"><span><small>DEVICE SETLISTS</small><strong>{store.setlists.length}</strong></span><IconButton label="Create setlist" onClick={() => { setName("New Setlist"); setDialog("new"); }}><Plus size={16} /></IconButton></div>
        <div className="search-input setlist-search"><Search size={14} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a setlist…" /></div>
        <div className="setlist-browser-list">{visibleSetlists.map((setlist) => <button key={setlist.id} data-context-kind="setlist" data-setlist-id={setlist.id} className={cn(store.selectedSetlistId === setlist.id && "active")} onClick={() => store.selectSetlist(setlist.id)}><span className="setlist-browser-list__icon"><ListMusic size={17} /></span><span><strong>{setlist.name}</strong><small>{setlist.items.length} {setlist.items.length === 1 ? "rig" : "rigs"}</small></span>{dirtyIds.has(setlist.id) && <i title="Unsaved changes" />}<ChevronRight size={14} /></button>)}</div>
        {!visibleSetlists.length && <p className="setlist-browser-empty">No setlists match “{query}”.</p>}
        <div className="setlist-browser-panel__footer"><span><Sparkles size={14} /><small>Loaded on device</small><strong>{store.liveSnapshot?.loadedSetlistName || "No active setlist"}</strong></span></div>
      </Card>
      {selected ? <Card className="setlist-run-sheet">
        <header className="setlist-run-sheet__header"><div><span className="eyebrow">PERFORMANCE ORDER</span><div className="setlist-run-sheet__title"><h2>{selected.name}</h2>{dirtyIds.has(selected.id) ? <Badge tone="amber">UNSAVED</Badge> : <Badge tone="green">SAVED</Badge>}</div><p>Drag rigs into order. Changes stay local until you save this setlist.</p></div><div className="setlist-run-sheet__actions"><Button size="sm" onClick={() => { setName(selected.name); setDialog("rename"); }}><Pencil size={14} /> Rename</Button><IconButton className="rig-delete" label={`Delete ${selected.name}`} onClick={() => { if (window.confirm(`Delete “${selected.name}” from the device?`)) void store.deleteSetlist(selected.id); }}><Trash2 size={15} /></IconButton></div></header>
        <section className="setlist-overview-grid"><span><ListMusic size={16} /><small>RIGS</small><strong>{selected.items.length}</strong></span><span><Gauge size={16} /><small>TEMPO RANGE</small><strong>{tempos.length ? `${Math.min(...tempos)}–${Math.max(...tempos)}` : "—"}<em>{tempos.length ? " BPM" : ""}</em></strong></span><span><Guitar size={16} /><small>CURRENT RIG</small><strong title={store.liveSnapshot?.rig.name}>{store.liveSnapshot?.rig.name || "Not reported"}</strong></span><span><Clock3 size={16} /><small>CURRENT POSITION</small><strong>{Math.max(0, selected.items.findIndex((item) => item.rigId === store.liveSnapshot?.rig.id) + 1) || "—"}</strong></span></section>
        <div className="setlist-run-columns"><span>#</span><span>RIG</span><span>TEMPO</span><span>PERFORMANCE NOTE</span><span>ACTIONS</span></div>
        <div className="setlist-run-list">{selected.items.map((item, index) => {
          const rig = store.rigs.find((entry) => entry.id === item.rigId);
          const current = item.rigId === store.liveSnapshot?.rig.id;
          return <div key={item.id} draggable data-context-kind="rig" data-rig-id={item.rigId} className={cn("setlist-run-row", dragged === index && "dragging", current && "current")} onDragStart={() => setDragged(index)} onDragEnd={() => setDragged(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragged !== null && dragged !== index) { store.moveSetlistItem(dragged, index); markDirty(); } setDragged(null); }}>
            <span className="setlist-run-row__position"><GripVertical size={14} /><b>{String(index + 1).padStart(2, "0")}</b></span>
            <span className="setlist-run-row__rig"><i style={{ "--rig-color": rig?.color ?? "#718096" } as CSSProperties}><Guitar size={15} /></i><span><strong>{item.title || rig?.name || "Unknown rig"}</strong><small>{rig?.author || "On device"}{current ? " · CURRENTLY LOADED" : ""}</small></span></span>
            <span className="setlist-run-row__tempo"><b>{rig?.tempo || "—"}</b><small>{rig?.tempo ? "BPM" : "NO TEMPO"}</small></span>
            <p title={item.notes}>{item.notes || "No performance note"}</p>
            <span className="setlist-run-row__actions"><IconButton label={`Load ${item.title}`} onClick={() => item.rigId && void openRig(item.rigId)}><Play size={14} /></IconButton><IconButton label={`Remove ${item.title}`} onClick={() => { store.removeSetlistItem(item.id); markDirty(); }}><Trash2 size={14} /></IconButton></span>
          </div>;
        })}</div>
        {!selected.items.length && <EmptyState icon={<ListMusic size={24} />} title="This setlist is empty" description="Add rigs in the order you want to play them." />}
        <button className="setlist-add-rigs" onClick={() => { setRigQuery(""); setDialog("add"); }}><span><Plus size={18} /></span><strong>Add rigs</strong><small>Browse the complete device library</small></button>
        <footer className="setlist-save-bar"><span>{dirtyIds.has(selected.id) ? <><i /><strong>Unsaved setlist changes</strong><small>Review the order, then write it to the device.</small></> : <><Check size={16} /><strong>Setlist is up to date</strong><small>{selected.items.length} rigs saved in this order.</small></>}</span><Button variant="primary" disabled={!dirtyIds.has(selected.id)} loading={busy} onClick={() => void save()}><Save size={14} /> Save to device</Button></footer>
      </Card> : <Card className="setlist-run-sheet setlist-run-sheet--empty"><EmptyState icon={<ListMusic size={28} />} title="Create your first setlist" description="Build a performance-ready sequence from the rigs already on your device." action={<Button variant="primary" onClick={() => { setName("New Setlist"); setDialog("new"); }}><Plus size={15} /> New setlist</Button>} /></Card>}
    </div>
    <Dialog open={dialog === "new" || dialog === "rename"} onClose={() => setDialog(null)} title={dialog === "rename" ? "Rename setlist" : "Create setlist"} description="The setlist name is written directly to the connected device." footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void executeNameDialog()}><Check size={15} /> {dialog === "rename" ? "Rename" : "Create setlist"}</Button></>}><label className="form-field"><span>Setlist name</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void executeNameDialog()} /></label></Dialog>
    <Dialog open={dialog === "add"} onClose={() => setDialog(null)} width="720px" title="Add rigs to setlist" description={`Choose from ${store.rigs.length} rigs. You can add the same rig more than once.`} footer={<><span className="dialog-selection-note">Changes remain local until the setlist is saved.</span><Button variant="primary" onClick={() => setDialog(null)}>Done</Button></>}><div className="search-input add-rig-search"><Search size={15} /><Input autoFocus value={rigQuery} onChange={(event) => setRigQuery(event.target.value)} placeholder="Search rigs…" /></div><div className="setlist-rig-picker">{addableRigs.map((rig) => { const uses = selected?.items.filter((item) => item.rigId === rig.id).length ?? 0; return <button key={rig.id} onClick={() => { store.addRigToSetlist(rig.id); markDirty(); }}><i style={{ "--rig-color": rig.color } as CSSProperties}><Guitar size={16} /></i><span><strong>{rig.name}</strong><small>{rig.author} · {rig.tempo || "—"} BPM</small></span>{uses > 0 && <Badge tone="violet">IN SET ×{uses}</Badge>}<Plus size={15} /></button>; })}</div>{!addableRigs.length && <EmptyState icon={<Search size={22} />} title="No matching rigs" description="Try a different name, author or tag." />}</Dialog>
  </div>;
}
