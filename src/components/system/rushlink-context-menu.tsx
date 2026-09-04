import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Activity, ChevronRight, CirclePower, Clipboard, ClipboardPaste, Cloud,
  Copy, ExternalLink, Guitar, Heart, HeartOff, History, ListMusic, Menu,
  MousePointerClick, PanelLeft, Play, RadioTower, Redo2, RefreshCw, Scissors,
  Search, Settings, SlidersHorizontal, Trash2, Undo2, Wifi, Zap,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { deviceErrorDetail } from "../../services/device-errors";

type StoreState = ReturnType<typeof useAppStore.getState>;

export interface RushLinkMenuItem {
  id: string;
  label: string;
  detail?: string;
  icon: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  dividerBefore?: boolean;
  action: () => unknown | Promise<unknown>;
}

interface MenuModel {
  title: string;
  subtitle: string;
  accent?: string;
  compactHeader?: boolean;
  items: RushLinkMenuItem[];
}

interface OpenMenu extends MenuModel {
  x: number;
  y: number;
}

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Overview", editor: "Rig Editor", rigs: "Rigs & Setlists", setlists: "Rigs & Setlists",
  live: "StageHand", "tone-cloud": "TonePilot", tools: "Performance Tools", library: "Library & Backup",
  settings: "Settings", diagnostics: "Diagnostics",
};

const clipboardWrite = async (value: string) => {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
};

function command(action: string) {
  if (typeof document.execCommand === "function") document.execCommand(action);
}

function editableMenu(target: HTMLInputElement | HTMLTextAreaElement | HTMLElement): MenuModel {
  const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
  const readOnly = Boolean(input?.readOnly || input?.disabled || target.getAttribute("contenteditable") === "false");
  const selection = input
    ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
    : window.getSelection()?.toString() ?? "";
  const fieldName = target.getAttribute("aria-label") || target.getAttribute("placeholder") || "Editable field";
  const focus = () => target.focus();
  const paste = async () => {
    focus();
    if (!navigator.clipboard?.readText) { command("paste"); return; }
    const value = await navigator.clipboard.readText();
    if (!input) { command("insertText"); return; }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(value, start, end, "end");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: value }));
  };
  return {
    title: fieldName,
    subtitle: readOnly ? "Read-only text" : "Text editing",
    items: [
      { id: "undo", label: "Undo", icon: Undo2, disabled: readOnly, action: () => { focus(); command("undo"); } },
      { id: "redo", label: "Redo", icon: Redo2, disabled: readOnly, action: () => { focus(); command("redo"); } },
      { id: "cut", label: "Cut", icon: Scissors, disabled: readOnly || !selection, dividerBefore: true, action: () => { focus(); command("cut"); } },
      { id: "copy", label: "Copy", icon: Copy, disabled: !selection, action: () => { focus(); command("copy"); } },
      { id: "paste", label: "Paste", icon: ClipboardPaste, disabled: readOnly, action: paste },
      { id: "select-all", label: "Select all", icon: MousePointerClick, dividerBefore: true, action: () => { focus(); input?.select(); if (!input) command("selectAll"); } },
    ],
  };
}

function globalItems(state: StoreState, compact = false): RushLinkMenuItem[] {
  const items: RushLinkMenuItem[] = [
    {
      id: "refresh", label: `Refresh ${PAGE_LABELS[state.page] ?? "workspace"}`, detail: state.device ? "Read latest device state" : "Available after connection",
      icon: RefreshCw, disabled: !state.device || state.syncBusy, action: () => state.refreshPage(state.page, "manual"),
    },
  ];
  if (!compact) {
    items.push(
      { id: "rigs", label: "Open Rigs & Setlists", icon: Search, action: () => state.setPage("rigs") },
      { id: "editor", label: "Open current rig", icon: Guitar, disabled: !state.device, action: () => state.setPage("editor") },
      { id: "snapshot", label: "Create restore point", icon: History, disabled: !state.device, action: () => state.createSnapshot("RushLink context menu") },
    );
  }
  items.push(
    { id: "sidebar", label: state.sidebarCollapsed ? "Expand navigation" : "Collapse navigation", icon: PanelLeft, dividerBefore: true, action: () => state.toggleSidebar() },
    { id: "settings", label: "RushLink Settings", icon: Settings, action: () => state.setPage("settings") },
    { id: "diagnostics", label: "Connection diagnostics", icon: Activity, action: () => state.setPage("diagnostics") },
  );
  return items;
}

function dataElement(target: HTMLElement) {
  return target.closest<HTMLElement>("[data-context-kind]");
}

async function triggerStageControl(state: StoreState, button: NonNullable<StoreState["liveLayout"]["buttons"][number]>) {
  const executed = await state.triggerLiveButton(button.id, "release");
  if (!executed) throw new Error(`${button.label} could not be applied.`);
}

export function buildRushLinkMenu(target: HTMLElement, state: StoreState): MenuModel {
  const editable = target.closest<HTMLElement>("input, textarea, [contenteditable='true']");
  if (editable) return editableMenu(editable as HTMLInputElement | HTMLTextAreaElement | HTMLElement);

  const contextual = dataElement(target);
  const kind = contextual?.dataset.contextKind;
  if (kind === "rig") {
    const rigId = contextual?.dataset.rigId ?? "";
    const rig = state.rigs.find((item) => item.id === rigId);
    const favorite = state.favoriteRigIds.includes(rigId);
    const srId = state.liveSnapshot?.rigLibrary.find((item) => item.id === rigId)?.srId;
    return {
      title: rig?.name ?? "Device rig", subtitle: rig?.author || "HeadRush rig", accent: rig?.color,
      items: [
        { id: "rig-play", label: "Play on HeadRush", detail: "Load without opening the editor", icon: Play, disabled: !rig || !state.device, action: () => state.loadRig(rigId, srId) },
        { id: "rig-edit", label: "Load and edit", icon: SlidersHorizontal, disabled: !rig || !state.device, action: async () => { await state.loadRig(rigId, srId); useAppStore.getState().setPage("editor"); } },
        { id: "rig-favorite", label: favorite ? "Remove from favourites" : "Add to favourites", icon: favorite ? HeartOff : Heart, dividerBefore: true, disabled: !rig, action: () => state.toggleFavoriteRig(rigId) },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ],
    };
  }

  if (kind === "tone") {
    const toneId = contextual?.dataset.toneId ?? "";
    const tone = state.tones.find((item) => item.id === toneId);
    const favorite = state.favoriteToneIds.includes(toneId);
    return {
      title: tone?.title ?? "TonePilot result", subtitle: tone ? `${tone.source} · ${tone.author}` : "Cloud tone",
      accent: tone?.imageColor,
      items: [
        { id: "tone-configure", label: "Open in audition workspace", icon: SlidersHorizontal, disabled: !tone, action: () => { state.selectTone(toneId); state.setPage("tone-cloud"); } },
        { id: "tone-favorite", label: favorite ? "Remove from favourites" : "Add to favourites", icon: favorite ? HeartOff : Heart, disabled: !tone, action: () => state.toggleFavoriteTone(toneId) },
        { id: "tonepilot", label: "Open TonePilot", icon: Cloud, dividerBefore: true, action: () => state.setPage("tone-cloud") },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ],
    };
  }

  if (kind === "rig-block") {
    const blockId = contextual?.dataset.blockId ?? "";
    const block = (state.liveSnapshot?.rig ?? state.rigs.find((rig) => rig.id === state.selectedRigId))?.blocks.find((item) => item.id === blockId);
    const empty = contextual?.dataset.empty === "true";
    const slot = Number(contextual?.dataset.slot ?? 0) + 1;
    return {
      title: empty ? `Empty slot ${slot}` : block?.name ?? `Signal slot ${slot}`,
      subtitle: empty ? "Rig signal chain" : `${block?.model ?? "Effect"} · slot ${slot}`,
      accent: block?.color,
      items: empty ? [
        { id: "block-add", label: "Choose a block", icon: Zap, action: () => contextual?.querySelector<HTMLElement>("button")?.click() },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ] : [
        { id: "block-edit", label: "Edit block", icon: SlidersHorizontal, disabled: !block, action: () => { state.selectBlock(blockId); state.setPage("editor"); } },
        { id: "block-toggle", label: block?.enabled ? "Bypass block" : "Enable block", icon: CirclePower, disabled: !block, action: () => state.toggleBlock(blockId) },
        { id: "block-remove", label: "Remove block", icon: Trash2, danger: true, dividerBefore: true, disabled: !block, action: async () => { if (window.confirm(`Remove “${block?.name}” from this rig?`)) await state.removeBlock(blockId); } },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ],
    };
  }

  if (kind === "test-rig-block" || kind === "test-rig-slot") {
    const blockId = contextual?.dataset.blockId ?? "";
    const rig = state.testRigs.find((item) => item.id === state.selectedTestRigId) ?? state.testRigs[0];
    const block = rig?.blocks.find((item) => item.id === blockId);
    const slot = Number(contextual?.dataset.slot ?? 0) + 1;
    const locked = contextual?.dataset.locked === "true";
    return {
      title: block?.name ?? `Empty Test Rig slot ${slot}`,
      subtitle: block ? `${block.model} · Test Rig slot ${slot}` : "Test Rig Studio",
      accent: block?.color,
      items: block ? [
        { id: "test-block-select", label: "Edit in Test Rig Studio", icon: SlidersHorizontal, action: () => contextual?.click() },
        { id: "test-block-toggle", label: block.enabled ? "Bypass in plan" : "Enable in plan", icon: CirclePower, disabled: locked, action: () => state.toggleTestRigBlock(blockId) },
        { id: "test-block-copy", label: "Duplicate block", icon: Copy, disabled: locked, action: () => state.duplicateTestRigBlock(blockId) },
        { id: "test-block-remove", label: "Remove from plan", icon: Trash2, danger: true, disabled: locked, action: () => state.removeTestRigBlock(blockId) },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ] : [
        { id: "test-block-add", label: "Add a compatible block", icon: Zap, action: () => contextual?.click() },
        { id: "tonepilot", label: "Open TonePilot", icon: Cloud, dividerBefore: true, action: () => state.setPage("tone-cloud") },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ],
    };
  }

  if (kind === "stage-control" || kind === "stage-slot") {
    const index = Number(contextual?.dataset.liveIndex ?? -1);
    const button = Number.isInteger(index) ? state.liveLayout.buttons[index] : null;
    return {
      title: button?.label ?? `Empty StageHand slot ${index + 1}`,
      subtitle: button ? `${button.subtitle || "Stage control"} · ${button.midi.type.toUpperCase()} ${button.midi.number}` : "StageHand layout",
      accent: button?.accentColor,
      items: button ? [
        { id: "stage-trigger", label: "Trigger control", detail: "Same action as a stage tap", icon: RadioTower, disabled: Boolean(contextual?.getAttribute("aria-disabled") === "true"), action: () => triggerStageControl(state, button) },
        { id: "stage-copy-midi", label: "Copy MIDI mapping", detail: `Channel ${button.midi.channel} · value ${button.midi.value}`, icon: Clipboard, action: () => clipboardWrite(`${button.midi.type.toUpperCase()} ${button.midi.number} · CH ${button.midi.channel} · VALUE ${button.midi.value}`) },
        { id: "stage-remove", label: "Remove from stage", icon: Trash2, danger: true, dividerBefore: true, action: () => { if (window.confirm(`Remove “${button.label}” from this stage?`)) state.removeLiveButton(button.id); } },
        { id: "stagehand", label: "Open StageHand", icon: RadioTower, dividerBefore: true, action: () => state.setPage("live") },
        ...globalItems(state, true).map((item, itemIndex) => ({ ...item, dividerBefore: itemIndex === 0 || item.dividerBefore })),
      ] : [
        { id: "stage-add", label: "Add a StageHand control", icon: Zap, action: () => contextual?.click() },
        { id: "stagehand", label: "Open StageHand", icon: RadioTower, dividerBefore: true, action: () => state.setPage("live") },
        ...globalItems(state, true).map((item, itemIndex) => ({ ...item, dividerBefore: itemIndex === 0 || item.dividerBefore })),
      ],
    };
  }

  if (kind === "setlist") {
    const setlistId = contextual?.dataset.setlistId ?? "";
    const setlist = state.setlists.find((item) => item.id === setlistId);
    return {
      title: setlist?.name ?? "Setlist", subtitle: `${setlist?.items.length ?? 0} rig placements`,
      items: [
        { id: "setlist-open", label: "Open setlist", icon: ListMusic, disabled: !setlist, action: () => { state.selectSetlist(setlistId); state.setPage("setlists"); } },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ],
    };
  }

  if (kind === "device-file" || kind === "device-folder") {
    const path = contextual?.dataset.devicePath ?? "";
    const isFolder = kind === "device-folder";
    return {
      title: contextual?.dataset.deviceName || path.split("/").filter(Boolean).at(-1) || (isFolder ? "Device folder" : "Device file"),
      subtitle: isFolder ? "HeadRush storage folder" : "HeadRush device asset",
      items: [
        { id: "file-use", label: isFolder ? "Open folder" : "Audition this file", icon: isFolder ? ChevronRight : Play, action: () => contextual?.click() },
        { id: "file-copy", label: "Copy device path", icon: Copy, disabled: !path, action: () => clipboardWrite(path) },
        ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
      ],
    };
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link) return {
    title: link.textContent?.trim() || "RushLink link", subtitle: link.href,
    items: [
      { id: "link-open", label: "Open link", icon: ExternalLink, action: () => link.click() },
      { id: "link-copy", label: "Copy link address", icon: Copy, action: () => clipboardWrite(link.href) },
      ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
    ],
  };

  const navigation = target.closest<HTMLElement>(".sidebar__nav button");
  if (navigation) return {
    title: navigation.textContent?.trim() || navigation.title || "RushLink workspace", subtitle: "Application navigation",
    items: [
      { id: "navigate", label: "Open workspace", icon: MousePointerClick, action: () => navigation.click() },
      ...globalItems(state, true).map((item, index) => ({ ...item, dividerBefore: index === 0 || item.dividerBefore })),
    ],
  };

  return {
    title: "RushLink", subtitle: state.device ? `${state.device.name} · ${PAGE_LABELS[state.page] ?? "Workspace"}` : "Device companion workspace",
    compactHeader: true,
    items: state.device ? globalItems(state) : [
      { id: "connect", label: "Connect a HeadRush", detail: "Open connection settings", icon: Wifi, action: () => state.setPage("settings") },
      { id: "settings", label: "RushLink Settings", icon: Settings, action: () => state.setPage("settings") },
      { id: "sidebar", label: state.sidebarCollapsed ? "Expand navigation" : "Collapse navigation", icon: Menu, dividerBefore: true, action: () => state.toggleSidebar() },
    ],
  };
}

export function RushLinkContextMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target instanceof HTMLElement ? event.target : document.body;
      const model = buildRushLinkMenu(target, useAppStore.getState());
      const width = 304;
      const estimatedHeight = Math.min(520, 92 + model.items.length * 49);
      setMenu({ ...model, x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - estimatedHeight - 8)) });
      window.requestAnimationFrame(() => menuRef.current?.focus());
    };
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const closeAlways = () => setMenu(null);
    document.addEventListener("contextmenu", open, true);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", closeAlways);
    window.addEventListener("resize", closeAlways);
    document.addEventListener("scroll", closeAlways, true);
    return () => {
      document.removeEventListener("contextmenu", open, true);
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", closeAlways);
      window.removeEventListener("resize", closeAlways);
      document.removeEventListener("scroll", closeAlways, true);
    };
  }, []);

  if (!menu) return null;
  const execute = (item: RushLinkMenuItem) => {
    if (item.disabled) return;
    setMenu(null);
    void Promise.resolve(item.action()).catch((reason) => useAppStore.getState().addDiagnostic({ level: "error", source: "Context menu", message: `${item.label} failed`, detail: deviceErrorDetail(reason) }));
  };
  const keyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setMenu(null); return; }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? (current + 1 + buttons.length) % buttons.length : (current - 1 + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }
  };

  return createPortal(<div ref={menuRef} className={`rush-context-menu${menu.compactHeader ? " rush-context-menu--compact-head" : ""}`} role="menu" aria-label={`${menu.title} actions`} tabIndex={-1} style={{ left: menu.x, top: menu.y, "--context-accent": menu.accent || "var(--cyan)" } as React.CSSProperties} onKeyDown={keyboard}>
    <header><span className="rush-context-menu__mark"><Zap size={15}/></span><span><strong>{menu.title}</strong><small>{menu.subtitle}</small></span></header>
    <div className="rush-context-menu__items">
      {menu.items.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="menuitem" disabled={item.disabled} className={`${item.dividerBefore ? "divider" : ""}${item.danger ? " danger" : ""}`} onClick={() => execute(item)}>
        <span className="rush-context-menu__icon"><Icon size={16}/></span><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
      </button>; })}
    </div>
    <footer><span><MousePointerClick size={12}/> RUSHLINK ACTIONS</span><kbd>ESC</kbd></footer>
  </div>, document.body);
}
