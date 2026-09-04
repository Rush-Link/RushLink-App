import type { DeviceModel, LiveButton, LiveDeckFootprint, LiveDeckLayout, LiveLayout, LiveStageSpacing, LiveSwitchType, MidiCommand } from "./types";

export const LIVE_DECK_LAYOUTS: LiveDeckLayout[] = ["1x4", "2x3", "1x3", "2x2"];

export const LIVE_DECK_ACTIONS = {
  looper: ["record", "toggle", "insert", "peel", "mute", "reverse"],
  drums: ["toggle", "fill", "bridge", "outro", "mute", "accent"],
} as const;

export const LIVE_DECK_DEFAULTS: Record<"looper" | "drums", Record<LiveDeckLayout, string[]>> = {
  looper: {
    "1x4": ["record", "toggle", "peel", "reverse"],
    "2x3": ["record", "toggle", "insert", "peel", "mute", "reverse"],
    "1x3": ["record", "toggle", "peel"],
    "2x2": ["record", "toggle", "peel", "reverse"],
  },
  drums: {
    "1x4": ["toggle", "fill", "bridge", "mute"],
    "2x3": ["toggle", "fill", "bridge", "outro", "mute", "accent"],
    "1x3": ["toggle", "fill", "accent"],
    "2x2": ["toggle", "fill", "bridge", "mute"],
  },
};

export function liveDeckDimensions(layout: LiveDeckLayout) {
  const [rows, columns] = layout.split("x").map(Number);
  return { rows, columns, capacity: rows * columns };
}

export function liveDeckFootprintDimensions(size: LiveDeckFootprint) {
  const [rows, columns] = size.split("x").map(Number);
  return { rows, columns };
}

export function liveDeckFootprintChoices(layout: LiveDeckLayout): LiveDeckFootprint[] {
  const choices: LiveDeckFootprint[] = ["1x1"];
  if (liveDeckDimensions(layout).columns >= 2) choices.push("1x2");
  if (!choices.includes(layout)) choices.push(layout);
  return choices;
}

export function normalizeLiveDeckFootprint(layout: LiveDeckLayout, size?: LiveDeckFootprint): LiveDeckFootprint {
  const choices = liveDeckFootprintChoices(layout);
  return size && choices.includes(size) ? size : layout;
}

export function normalizeLiveDeckActions(kind: "looper" | "drums", layout: LiveDeckLayout, actions?: string[]) {
  const allowed = new Set<string>(LIVE_DECK_ACTIONS[kind]);
  const defaults = LIVE_DECK_DEFAULTS[kind][layout];
  const capacity = liveDeckDimensions(layout).capacity;
  return Array.from({ length: capacity }, (_, index) => {
    const current = actions?.[index];
    return current && allowed.has(current) ? current : defaults[index];
  });
}

export const DEVICE_FIRST_ROW_COLUMNS: Record<DeviceModel, number> = { "Prime Flex": 4, Core: 5, Prime: 8 };

export const DEFAULT_LIVE_STAGE_SPACING: LiveStageSpacing = {
  columnGap: 10,
  rowGap: 10,
  insetTop: 16,
  insetRight: 16,
  insetBottom: 16,
  insetLeft: 16,
};

export function normalizeLiveStageSpacing(spacing?: Partial<LiveStageSpacing>): LiveStageSpacing {
  const value = (candidate: number | undefined, fallback: number, maximum: number) => {
    const number = Number(candidate);
    return Math.max(0, Math.min(maximum, Math.round(Number.isFinite(number) ? number : fallback)));
  };
  return {
    columnGap: value(spacing?.columnGap, DEFAULT_LIVE_STAGE_SPACING.columnGap, 40),
    rowGap: value(spacing?.rowGap, DEFAULT_LIVE_STAGE_SPACING.rowGap, 40),
    insetTop: value(spacing?.insetTop, DEFAULT_LIVE_STAGE_SPACING.insetTop, 96),
    insetRight: value(spacing?.insetRight, DEFAULT_LIVE_STAGE_SPACING.insetRight, 96),
    insetBottom: value(spacing?.insetBottom, DEFAULT_LIVE_STAGE_SPACING.insetBottom, 96),
    insetLeft: value(spacing?.insetLeft, DEFAULT_LIVE_STAGE_SPACING.insetLeft, 96),
  };
}

export function normalizeLiveDimensions(rows: number, columns: number, firstRowColumns: number) {
  const safeRows = Math.max(1, Math.min(4, Math.round(rows)));
  const safeColumns = Math.max(1, Math.min(8, Math.round(columns)));
  const safeFirstRow = Math.max(1, Math.min(safeColumns, Math.round(firstRowColumns)));
  return { rows: safeRows, columns: safeColumns, firstRowColumns: safeFirstRow, size: safeFirstRow + (safeRows - 1) * safeColumns };
}

export function resizeLiveLayout(layout: LiveLayout, rows: number, columns: number, firstRowColumns: number): LiveLayout {
  const next = normalizeLiveDimensions(rows, columns, firstRowColumns);
  // Never make a saved control disappear merely because the user selected a
  // grid that is too small. The UI disables these choices, while this guard
  // also protects imported layouts and direct store calls.
  if (layout.buttons.filter(Boolean).length > next.size) return layout;
  const buttons = [...layout.buttons.slice(0, next.size), ...Array(Math.max(0, next.size - layout.buttons.length)).fill(null)];
  const overflow = layout.buttons.slice(next.size).filter((button) => button !== null);
  for (const button of overflow) {
    const available = buttons.findIndex((candidate) => candidate === null);
    if (available < 0) break;
    buttons[available] = button;
  }
  return { ...layout, rows: next.rows, columns: next.columns, firstRowColumns: next.firstRowColumns, buttons };
}

export function normalizeLiveMidiCommand(command: MidiCommand): MidiCommand {
  const byte = (value: number) => Math.max(0, Math.min(127, Math.round(Number.isFinite(value) ? value : 0)));
  return {
    ...command,
    channel: Math.max(1, Math.min(16, Math.round(Number.isFinite(command.channel) ? command.channel : 1))),
    number: byte(command.number),
    value: byte(command.value),
    ...(command.releaseValue === undefined ? {} : { releaseValue: byte(command.releaseValue) }),
  };
}

export function liveIndexToCell(layout: Pick<LiveLayout, "rows" | "columns" | "firstRowColumns">, index: number) {
  if (index < 0) return null;
  if (index < layout.firstRowColumns) return { row: 0, column: index };
  const offset = index - layout.firstRowColumns;
  const row = 1 + Math.floor(offset / layout.columns);
  if (row >= layout.rows) return null;
  return { row, column: offset % layout.columns };
}

export function liveCellToIndex(layout: Pick<LiveLayout, "rows" | "columns" | "firstRowColumns">, row: number, column: number) {
  if (row < 0 || row >= layout.rows || column < 0) return null;
  if (row === 0) return column < layout.firstRowColumns ? column : null;
  return column < layout.columns ? layout.firstRowColumns + (row - 1) * layout.columns + column : null;
}

export function liveFootprintIndexes(layout: Pick<LiveLayout, "rows" | "columns" | "firstRowColumns">, index: number, size: LiveDeckFootprint) {
  const origin = liveIndexToCell(layout, index);
  if (!origin) return null;
  const { rows, columns } = liveDeckFootprintDimensions(size);
  const indexes: number[] = [];
  for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
    for (let columnOffset = 0; columnOffset < columns; columnOffset++) {
      const cellIndex = liveCellToIndex(layout, origin.row + rowOffset, origin.column + columnOffset);
      if (cellIndex === null) return null;
      indexes.push(cellIndex);
    }
  }
  return indexes;
}

export function canPlaceLiveFootprint(layout: Pick<LiveLayout, "rows" | "columns" | "firstRowColumns">, buttons: Array<LiveButton | null>, index: number, size: LiveDeckFootprint) {
  const indexes = liveFootprintIndexes(layout, index, size);
  return Boolean(indexes && indexes.every((cellIndex) => cellIndex === index || buttons[cellIndex] === null));
}

export function adjacentLiveIndex(layout: Pick<LiveLayout, "rows" | "columns" | "firstRowColumns">, index: number, direction: "left" | "right" | "up" | "down") {
  const cell = liveIndexToCell(layout, index);
  if (!cell) return null;
  const row = cell.row + (direction === "up" ? -1 : direction === "down" ? 1 : 0);
  const requestedColumn = cell.column + (direction === "left" ? -1 : direction === "right" ? 1 : 0);
  const width = row === 0 ? layout.firstRowColumns : layout.columns;
  const column = direction === "up" || direction === "down" ? Math.min(requestedColumn, width - 1) : requestedColumn;
  return liveCellToIndex(layout, row, column);
}

export const LIVE_SWITCH_LABELS: Record<LiveSwitchType, string> = {
  trigger: "Trigger",
  toggle: "Latch / toggle",
  momentary: "Momentary",
  hold: "Hold",
  multi: "Tap + hold + double",
};

export function midiCommandText(command: MidiCommand) {
  const kind = command.type === "cc" ? "Control Change" : command.type === "pc" ? "Program Change" : "Note";
  const release = command.releaseValue === undefined ? "" : `, release ${command.releaseValue}`;
  return `${kind} ${command.number}, value ${command.value}${release}, channel ${command.channel}`;
}
