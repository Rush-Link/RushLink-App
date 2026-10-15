import type { NamPreference, Parameter, RigBlock, ToneModel } from "./types";

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");

/** DSP instance numbers are separate from architecture names such as A2. */
export function baseModuleName(name: string): string {
  return name.trim().replace(/\s+(?:[2-9]|\d{2,})$/, "");
}

export function parseNamModule(name: string): { name: string; baseName: string; instance: number } | null {
  const match = name.trim().match(/^(Neural Amp Modeler)(?:\s+(\d+))?$/i);
  if (!match) return null;
  return { name: name.trim(), baseName: match[1], instance: match[2] ? Number(match[2]) : 1 };
}

export const isNamModule = (name: string): boolean => parseNamModule(name) !== null;

export function namModules(moduleTypes: string[]) {
  return moduleTypes.flatMap((name, moduleTypeId) => {
    const module = moduleTypeId > 0 ? parseNamModule(name) : null;
    return module ? [{ ...module, moduleTypeId }] : [];
  }).sort((left, right) => left.instance - right.instance);
}

export const namModulePath = (name: string): string => `/Evil/Engine/Patch/${name.replaceAll(" ", "_")}`;

/** Selects only reflected DSP instances and never aliases two blocks to one object. */
export function allocateModuleType(moduleTypes: string[], candidates: string[], unavailable = new Set<number>(), preferredInstance?: number): number | null {
  for (const candidate of candidates) {
    const matches = moduleTypes.flatMap((name, id) => id > 0 && !unavailable.has(id)
      && normalize(baseModuleName(name)) === normalize(baseModuleName(candidate)) ? [{ name, id }] : []);
    if (preferredInstance !== undefined) {
      const match = matches.find(({ name }) => (parseNamModule(name)?.instance ?? Number(name.match(/\s+(\d+)$/)?.[1] ?? 1)) === preferredInstance);
      if (match) return match.id;
      continue;
    }
    const exact = matches.find(({ name }) => normalize(name) === normalize(candidate));
    if (exact) return exact.id;
    if (matches.length) return matches[0].id;
  }
  return null;
}

export function isA2Model(model: Pick<ToneModel, "architecture">): boolean {
  return /^(?:a2|nam2|2)(?:full|lite)?$/.test(normalize(model.architecture));
}

export function selectPreferredNamModel(models: ToneModel[], preference: NamPreference = "auto", otherModel = "", selectedModelId?: string | null): ToneModel | undefined {
  const selected = models.find((model) => model.id === selectedModelId);
  if (preference === "auto") return selected ?? models[0];
  const requested = normalize(otherModel);
  const preferred = models.filter((model) => preference === "other"
    ? requested ? [model.id, model.name, model.architecture].some((value) => normalize(value) === requested) : !isA2Model(model)
    : isA2Model(model));
  return preferred.find((model) => model.id === selectedModelId) ?? preferred[0] ?? selected ?? models[0];
}

export function namParameterValue(parameters: Parameter[], property: string): Parameter["value"] | undefined {
  const parameter = parameters.find((candidate) => (candidate.sourceProperty ?? candidate.id) === property);
  if (parameter?.choices && typeof parameter.value === "string") {
    const index = parameter.choices.indexOf(parameter.value);
    return parameter.choiceValues?.[index] ?? parameter.value;
  }
  return parameter?.value;
}

export function isNamBlock(block: Pick<RigBlock, "name" | "model" | "sourcePath">): boolean {
  return isNamModule(block.model) || isNamModule(block.name)
    || /\/Neural_Amp_Modeler(?:_\d+)?$/.test(block.sourcePath ?? "");
}

export interface NamCapacity {
  hostCount: number;
  maxA2FullFiles: number;
  maxA2LiteFiles: number;
}

/** Firmware advertises hosts; doubling provides two independent file lanes per host. */
export function namCapacity(moduleTypes: string[]): NamCapacity {
  const hostCount = namModules(moduleTypes).length;
  return { hostCount, maxA2FullFiles: Math.min(hostCount, 2), maxA2LiteFiles: hostCount > 1 ? hostCount * 2 : hostCount };
}

/** Counts selected lanes, including bypassed hosts whose files still consume DSP. */
export function validateNamCapacity(blocks: RigBlock[], moduleTypes: string[]) {
  const capacity = namCapacity(moduleTypes);
  const hosts = blocks.filter((block) => isNamBlock(block) || block.name === "Capture slot");
  let fullFiles = 0;
  let liteFiles = 0;
  for (const host of hosts) {
    const lanes = namParameterValue(host.parameters, "Doubling") === true ? 2 : 1;
    for (let lane = 1; lane <= lanes; lane++) {
      if (namParameterValue(host.parameters, `LightMode${lane === 1 ? "" : "2"}`) === true) liteFiles++;
      else fullFiles++;
    }
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (hosts.length > capacity.hostCount) errors.push(`The connected device exposes ${capacity.hostCount} NAM host${capacity.hostCount === 1 ? "" : "s"}; this chain needs ${hosts.length}.`);
  if (fullFiles + liteFiles > capacity.maxA2LiteFiles) errors.push(`The connected device supports at most ${capacity.maxA2LiteFiles} NAM file lanes.`);
  if (fullFiles > capacity.maxA2FullFiles || fullFiles + liteFiles > 2) warnings.push("HeadRush switches A2 captures to Lite when more than two NAM files are active. The reflected device controls report the final mode.");
  return { ...capacity, hostCountUsed: hosts.length, fullFiles, liteFiles, valid: errors.length === 0, errors, warnings };
}
