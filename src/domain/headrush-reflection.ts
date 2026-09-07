import type {
  HeadRushObject,
  HeadRushPropertyMeta,
  HeadRushSubtree,
  LiveDeviceSnapshot,
  Parameter,
  RigBlock,
} from "./types";
import { BLOCK_CATEGORY_COLORS, categoryForBlockName } from "./block-categories";

const COLORS = [
  "#566273", "#65d890", "#3c9b66", "#f0bd5e", "#f08a55", "#ed6579", "#ef78b8",
  "#a982ef", "#609cf5", "#6ee7f2", "#e8edf5", "#8b96a7", "#53d4cc", "#222936",
];

const valueOf = (tree: HeadRushSubtree, path: string): Record<string, unknown> => tree[path]?.value ?? {};
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown) => value === true;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const numbers = (value: unknown) => Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];

export function colorForIndex(index: number): string {
  return COLORS[Math.max(0, Math.min(COLORS.length - 1, index))] ?? COLORS[0];
}

function unitFromFormat(format: unknown): string | undefined {
  if (typeof format !== "string") return undefined;
  if (format.includes("%%")) return "%";
  const match = format.match(/%[-+0-9.]*[a-z]\s*(.*)$/i);
  return match?.[1]?.trim() || undefined;
}

export function denormalizeValue(raw: number, meta: HeadRushPropertyMeta): number {
  const minimum = meta.minimum ?? 0;
  const maximum = meta.maximum ?? 1;
  const algorithm = meta["x-options"]?.normalizeAlgo ?? 0;
  switch (algorithm) {
    case 1:
      return raw <= 0.5 ? minimum + 2 * raw * -minimum : maximum * (raw - 0.5) * 2;
    case 4: {
      const centered = 2 * raw - 1;
      return centered * centered * (centered < 0 ? -maximum : maximum);
    }
    case 5:
      return minimum + (maximum - minimum) * raw * raw;
    case 6:
      return minimum > 0 ? minimum * Math.exp(Math.log(maximum / minimum) * raw) : minimum + (maximum - minimum) * raw;
    case 2:
      return 20 * Math.log10(Math.max(raw, 1e-10));
    case 7:
      return 0.044282303954338874 * (Math.exp(4.515 * raw) - 1);
    case 8:
      return maximum + 20 * Math.log10(Math.max(raw, 1e-10));
    case 9: {
      const threshold = Math.pow(10, -14 * 0.05);
      return raw > 0.25 ? Math.pow(10, 0.05 * ((1 - raw) * (-14 / 0.75))) : raw * (threshold / 0.25);
    }
    case 10:
      return raw > 0.99 ? 145 : (0.45 + raw) / (1 - raw);
    default:
      return minimum + (maximum - minimum) * raw;
  }
}

export function normalizeValue(display: number, parameter: Parameter): number {
  if (!parameter.normalized) return display;
  const minimum = parameter.min ?? 0;
  const maximum = parameter.max ?? 1;
  const algorithm = parameter.normalizeAlgo ?? 0;
  const clamped = Math.min(maximum, Math.max(minimum, display));
  if (parameter.inverted && algorithm === 0) return (maximum - clamped) / (maximum - minimum);
  switch (algorithm) {
    case 1:
      return clamped <= 0 ? (clamped - minimum) / (2 * -minimum) : 0.5 + clamped / (2 * maximum);
    case 4: {
      const ratio = Math.sqrt(Math.abs(clamped) / maximum);
      return 0.5 + 0.5 * (clamped < 0 ? -ratio : ratio);
    }
    case 5:
      return Math.sqrt((clamped - minimum) / (maximum - minimum));
    case 6:
      return minimum > 0 ? Math.log(clamped / minimum) / Math.log(maximum / minimum) : (clamped - minimum) / (maximum - minimum);
    case 2:
      return Math.pow(10, 0.05 * display);
    case 7:
      return Math.log(display / 0.044282303954338874 + 1) / 4.515;
    case 8:
      return display <= -200 ? 0 : Math.pow(10, 0.05 * (display - maximum));
    case 9: {
      const threshold = Math.pow(10, -14 * 0.05);
      return display > threshold ? 1 - 20 * Math.log10(display) / (-14 / 0.75) : display / (threshold / 0.25);
    }
    case 10:
      return display > 144 ? 1 : (display - 0.45) / (1 + display);
    default:
      return (clamped - minimum) / (maximum - minimum);
  }
}

export function parameterDeviceValue(parameter: Parameter, value: Parameter["value"]): unknown {
  if (parameter.choices && typeof value === "string") {
    const index = parameter.choices.indexOf(value);
    return parameter.choiceValues?.[index] ?? index;
  }
  return typeof value === "number" ? normalizeValue(value, parameter) : value;
}

export function parametersForObject(object: HeadRushObject | undefined, include?: string[]): Parameter[] {
  const values = object?.value ?? {};
  const properties = object?.meta?.properties ?? {};
  const advertisedOrder = strings(values.order);
  const order = include ?? (advertisedOrder.length ? advertisedOrder : Object.keys(properties));
  const labels = strings(values.labels);
  const disabled = new Set(strings(values.disabled));
  return order.flatMap((property, index) => {
    const raw = values[property];
    const meta = properties[property];
    if (!meta || raw === undefined || disabled.has(property) || meta.readOnly) return [];
    const choices = meta["x-options"]?.strings;
    const advertisedIndex = advertisedOrder.indexOf(property);
    const labelIndex = advertisedOrder.length ? advertisedIndex : index;
    const label = (labelIndex >= 0 ? labels[labelIndex]?.trim() : "") || property.replace(/([a-z])([A-Z])/g, "$1 $2");
    const fileType = meta["x-options"]?.fileType;
    const startPath = meta["x-options"]?.startPath;
    if (typeof fileType === "number" && typeof startPath === "string" && typeof raw === "string") {
      return [{
        id: property, sourceProperty: property, label, value: raw, rawValue: raw, writable: true,
        deviceFile: { fileType, startPath },
      } satisfies Parameter];
    }
    // These are firmware-maintained labels paired with a reflected file property.
    // Writing them directly is ignored by the engine and made the UI look editable when it was not.
    if (/^(?:IRName|FileMissing)\d*$/.test(property)) return [];
    const reflectedChoices = strings(values[`${property}List`]);
    if (typeof raw === "string" && reflectedChoices.length) {
      return [{
        id: property, sourceProperty: property, label, value: raw, rawValue: raw,
        choices: reflectedChoices, choiceValues: reflectedChoices, writable: true,
      } satisfies Parameter];
    }
    if (choices && (typeof raw === "number" || typeof raw === "boolean")) {
      const choiceIndex = typeof raw === "boolean" ? Number(raw) : raw;
      return [{
        id: property, sourceProperty: property, label, value: choices[choiceIndex] ?? String(raw), rawValue: raw,
        choices, choiceValues: typeof raw === "boolean" ? [false, true] : choices.map((_, index) => index), writable: true,
      } satisfies Parameter];
    }
    if (typeof raw === "number" && meta.type === "number") {
      const display = denormalizeValue(raw, meta);
      const reflectedMinimum = meta.minimum ?? 0;
      const reflectedMaximum = meta.maximum ?? 1;
      return [{
        id: property, sourceProperty: property, label, value: display, rawValue: raw,
        min: Math.min(reflectedMinimum, reflectedMaximum), max: Math.max(reflectedMinimum, reflectedMaximum), step: meta["x-options"]?.grid,
        unit: unitFromFormat(meta["x-options"]?.format), writable: true, normalized: true,
        normalizeAlgo: meta["x-options"]?.normalizeAlgo ?? 0,
        inverted: reflectedMinimum > reflectedMaximum,
      } satisfies Parameter];
    }
    if (typeof raw === "number" && meta.type === "integer") {
      return [{
        id: property, sourceProperty: property, label, value: raw, rawValue: raw,
        min: meta.minimum ?? 0, max: meta.maximum ?? Math.max(127, raw), step: meta["x-options"]?.grid ?? 1,
        writable: true, normalized: false,
      } satisfies Parameter];
    }
    return [{ id: property, sourceProperty: property, label, value: raw as Parameter["value"], rawValue: raw as Parameter["value"], writable: true } satisfies Parameter];
  });
}

function modulePath(name: string): string {
  return `/Evil/Engine/Patch/${name.replaceAll(" ", "_")}`;
}

export const SLOT_EQ_PROPERTIES = ["SltEQOn", "SltEQF", "SltEQG", "SltEQQ", "SltEQHP", "SltEQLP", "SltMix", "SltPhase", "SltPhaseR"];

function buildBlocks(tree: HeadRushSubtree): RigBlock[] {
  const chain = valueOf(tree, "/Evil/Engine/Patch/Chain");
  const moduleTypes = strings(valueOf(tree, "/Evil/API/Blocks").ModuleTypes);
  return Array.from({ length: 14 }, (_, index) => {
    const slot = index + 1;
    const moduleTypeId = number(chain[`ModuleType${slot}`]);
    const name = moduleTypeId ? moduleTypes[moduleTypeId] ?? `Module ${moduleTypeId}` : "Empty Slot";
    const sourcePath = moduleTypeId ? modulePath(name) : undefined;
    const object = sourcePath ? tree[sourcePath] : undefined;
    const values = object?.value ?? {};
    const category = moduleTypeId ? categoryForBlockName(name, number(chain[`EffectType${slot}`])) : "utility";
    return {
      id: `slot-${slot}`,
      name,
      model: moduleTypeId ? text(values.PresetName, name) || name : "Available",
      presetName: text(values.PresetName),
      category,
      color: moduleTypeId ? BLOCK_CATEGORY_COLORS[category] : "#354150",
      enabled: moduleTypeId ? values.On !== false : false,
      slot: index,
      moduleTypeId,
      sourcePath,
      empty: moduleTypeId === 0,
      canDouble: bool(chain[`CanDouble${slot}`]),
      doubled: bool(values.Doubling),
      parameters: parametersForObject(object, strings(values.order).length ? [...new Set([...strings(values.order), ...SLOT_EQ_PROPERTIES])] : undefined).map((parameter) => ({ ...parameter, deviceObjectPath: sourcePath })),
    };
  });
}

export function parseHeadRushSubtree(tree: HeadRushSubtree): LiveDeviceSnapshot {
  const gui = valueOf(tree, "/Evil/Gui");
  const rigValue = valueOf(tree, "/Evil/Engine/Patch/Rig");
  const chain = valueOf(tree, "/Evil/Engine/Patch/Chain");
  const rigs = valueOf(tree, "/Evil/API/Rigs");
  const setlists = valueOf(tree, "/Evil/API/Setlists");
  const footswitch = valueOf(tree, "/Evil/Engine/FootSwitch");
  const drums = valueOf(tree, "/Evil/Engine/DrumsCtrl");
  const storage = valueOf(tree, "/Evil/Engine/Settings/StorageInfo");
  const cloud = valueOf(tree, "/Evil/Cloud/Master");
  const tone3000 = valueOf(tree, "/Evil/API/Tone3000");
  const rigNames = strings(rigs.AllRigNames);
  const rigIds = strings(rigs.AllRigIds);
  const rigColors = numbers(rigs.AllRigColors);
  const rigSrIds = strings(rigs.AllRigSrIds);
  const loadedRigId = text(rigs.loadedID);
  const loadedRigName = text(rigs.loadedName, text(rigValue.PresetName, "Current rig"));
  const tempoMeta = tree["/Evil/Engine/Patch/Rig"]?.meta?.properties?.Tempo;
  const tempo = tempoMeta ? denormalizeValue(number(rigValue.Tempo), tempoMeta) : number(rigValue.Tempo);
  const setlistNames = strings(setlists.SetlistNames);
  const setlistIds = strings(setlists.SetlistIds);
  const setlistCounts = numbers(setlists.SetlistCounts);
  const loadedSetlistId = text(setlists.loadedID);
  const blocks = buildBlocks(tree);
  const usedLabel = text(storage.UsedSpaceString, text(storage.UsedSpaceText, ""));
  const capacityLabel = text(storage.TotalSpaceString, text(storage.TotalSpaceText, ""));
  const storageStrings = Object.values(storage).filter((item): item is string => typeof item === "string");

  return {
    syncedAt: new Date().toISOString(),
    objectCount: Object.keys(tree).length,
    deviceName: text(gui.DeviceName, "HeadRush device"),
    firmware: text(gui.AppVersion, "Unknown"),
    rig: {
      id: loadedRigId || "current-rig",
      name: loadedRigName,
      author: "On device",
      color: colorForIndex(number(rigs.loadedColor, 3)),
      tags: ["Live"],
      tempo: Math.round(tempo * 10) / 10,
      favorite: false,
      modified: bool(rigs.dirty) ? "Unsaved changes" : "Device saved",
      blocks,
    },
    routing: {
      id: number(chain.Routing),
      label: ["Straight", "Middle Split 3-4-3", "Middle Split 5-3-3", "Middle Split 7-2-3", "Immediate Split"][number(chain.Routing)] ?? `Path ${number(chain.Routing)}`,
      stereo: bool(chain.RigIsStereo), tails: bool(chain.Tails), locked: bool(chain.Lock),
    },
    rigLibrary: rigNames.map((name, index) => ({ id: rigIds[index] ?? `rig-${index}`, srId: rigSrIds[index] ?? "", name, color: colorForIndex(rigColors[index] ?? 0), loaded: rigIds[index] === loadedRigId })),
    setlists: setlistNames.map((name, index) => ({ id: setlistIds[index] ?? `setlist-${index}`, name, count: setlistCounts[index] ?? 0, loaded: setlistIds[index] === loadedSetlistId })),
    loadedSetlistId,
    loadedSetlistName: text(setlists.loadedName, "No setlist"),
    footswitches: Array.from({ length: 6 }, (_, index) => {
      const slot = index + 1;
      const mode = number(footswitch[`ModeNew${slot}`]);
      return {
        number: slot,
        label: text(footswitch[`FootSwitchText${slot}`], `FS ${slot}`),
        module: text(footswitch[`Module${slot}`], "Unassigned"),
        operation: text(footswitch[`Operation${slot}`], ""),
        enabled: bool(footswitch[`FootSwitchOn${slot}`]),
        mode: mode === 0 ? "toggle" : mode === 1 ? "hold" : mode === 2 ? "scene" : "unknown",
        color: colorForIndex(number(footswitch[`FootSwitchColour${slot}`], 0)),
        sceneActive: bool(footswitch[`SceneActive${slot}`]),
      } as const;
    }),
    currentScene: number(footswitch.LastScene) + 1,
    drums: {
      playing: number(drums.isPlaying) === 1 || bool(drums.isPlaying),
      muted: number(drums.isMuted) === 1 || bool(drums.isMuted),
      kit: text(drums.Kit, text(drums.kitName, "Unknown")),
      style: text(drums.Style, text(drums.styleName, "Unknown")),
    },
    storage: {
      usedPercent: Math.round(number(storage.UsedSpace) * 1000) / 10,
      usedLabel: storageStrings.find((item) => /used/i.test(item)) ?? (usedLabel || "Unknown"),
      capacityLabel: storageStrings.find((item) => /(?:of|total|gb)/i.test(item)) ?? (capacityLabel || "Unknown"),
    },
    cpuPercent: (() => {
      const cpuObject = tree["/Evil/Engine/CPUMeter"];
      const raw = number(cpuObject?.value?.CPUTimeSmoothed);
      const meta = cpuObject?.meta?.properties?.CPUTimeSmoothed;
      return Math.round((meta ? denormalizeValue(raw, meta) : raw * 100) * 10) / 10;
    })(),
    cloud: { loggedIn: bool(cloud.isloggedIn), loading: bool(cloud.loginInProgress), demo: text(cloud.demoLoaded, text(cloud.demoLoading)) },
    tone3000: { loggedIn: bool(tone3000.isLoggedIn), searching: bool(tone3000.searchInProgress) },
    settings: {
      audio: valueOf(tree, "/Evil/Engine/Settings/Audio"),
      general: valueOf(tree, "/Evil/Engine/Settings/General"),
      midi: valueOf(tree, "/Evil/Engine/Settings/Midi"),
      expression: valueOf(tree, "/Evil/Engine/Settings/ExpressionPedal"),
      pedal1: valueOf(tree, "/Evil/Engine/Pedal1"),
      pedal2: valueOf(tree, "/Evil/Engine/Pedal2"),
    },
  };
}
