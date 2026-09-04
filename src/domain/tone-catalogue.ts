import type { CaptureType, CloudTone } from "./types";

export type ToneSort = "best-match" | "trending" | "newest" | "oldest" | "downloads-all-time" | "favorites" | "name";
export type DownloadFilter = "all" | "downloaded" | "not-downloaded";
export type ToneArchitectureFilter = "all" | "a1" | "a2" | "a2-lite" | "custom";

export interface ToneCatalogueFilters {
  query: string;
  source: "all" | CloudTone["source"];
  captureTypes: Array<Exclude<CaptureType, "auto">>;
  author: string;
  tag: string;
  make: string;
  architecture: ToneArchitectureFilter;
  gears: string[];
  sizes: string[];
  formats: string[];
  calibratedOnly: boolean;
  verifiedOnly: boolean;
  minimumDownloads: number;
  minimumFavorites: number;
  minimumModels: number;
  publishedWithinDays: number;
  licenses: string[];
  artworkOnly: boolean;
  downloadState: DownloadFilter;
  favoritesOnly: boolean;
  favoriteIds: string[];
  sort: ToneSort;
}

const captureTypeGearMap: Partial<Record<Exclude<CaptureType, "auto">, string[]>> = {
  amp: ["amp"],
  "amp+ir": ["amp-cab"],
  ir: ["cab"],
  effect: ["pedal", "outboard", "space"],
  unknown: ["experimental"],
};

/** Narrows Tone3000 at the provider before applying the richer local filters. */
export function tone3000GearsForCaptureTypes(captureTypes: Array<Exclude<CaptureType, "auto">>, selectedGears: string[] = []): string[] {
  if (!captureTypes.length) return selectedGears;
  const inferred = [...new Set(captureTypes.flatMap((type) => captureTypeGearMap[type] ?? []))];
  if (!inferred.length) return selectedGears;
  if (!selectedGears.length) return inferred;
  const intersection = selectedGears.filter((gear) => inferred.includes(gear));
  return intersection.length ? intersection : selectedGears;
}

const normalizeSearchText = (value: unknown) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const searchableText = (tone: CloudTone) => normalizeSearchText([
  tone.title,
  tone.author,
  tone.description,
  tone.gear,
  ...tone.tags,
  ...Object.values(tone.metadata ?? {}),
].filter(Boolean).join(" "));

const timestamp = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const metadataText = (tone: CloudTone, keys: string[]) => keys
  .flatMap((key) => Object.entries(tone.metadata ?? {}).filter(([name]) => name.toLocaleLowerCase().replaceAll(".", "_") === key).map(([, value]) => String(value)))
  .join(" ")
  .toLocaleLowerCase();
const isTruthyMetadata = (tone: CloudTone, keys: string[]) => /^(true|1|yes)$/i.test(metadataText(tone, keys).trim());
const hasPositiveMetadata = (tone: CloudTone, keys: string[]) => metadataText(tone, keys).split(/[^0-9.]+/).some((value) => Number(value) > 0);
const listValues = (value: string) => value.split(",").map((item) => item.trim().toLocaleLowerCase()).filter(Boolean);

function phraseScore(value: unknown, query: string, exact: number, startsWith: number, contains: number) {
  const normalized = normalizeSearchText(value);
  if (!normalized || !query) return 0;
  if (normalized === query) return exact;
  if (normalized.startsWith(`${query} `)) return startsWith;
  return normalized.includes(query) ? contains : 0;
}

/** Ranks identity matches above incidental mentions in notes or metadata. */
export function toneSearchRelevance(tone: CloudTone, rawQuery: string): number {
  const query = normalizeSearchText(rawQuery);
  if (!query) return 0;
  const identity = metadataText(tone, ["makes", "make", "manufacturer", "filters_makes", "model", "models", "amplifier", "amp"]);
  const tags = tone.tags.map(normalizeSearchText);
  const tokens = [...new Set(query.split(" ").filter(Boolean))];
  let score = 0;
  score += phraseScore(tone.title, query, 1_200, 1_000, 820);
  score += phraseScore(identity, query, 900, 760, 620);
  score += Math.max(0, ...tags.map((tag) => phraseScore(tag, query, 700, 590, 480)));
  score += phraseScore(tone.gear, query, 520, 440, 360);
  score += phraseScore(tone.author, query, 460, 380, 300);
  score += phraseScore(tone.description, query, 110, 90, 70);
  score += phraseScore(Object.values(tone.metadata ?? {}).join(" "), query, 65, 55, 40);

  const title = normalizeSearchText(tone.title);
  const identityText = normalizeSearchText(identity);
  const author = normalizeSearchText(tone.author);
  const gear = normalizeSearchText(tone.gear);
  for (const token of tokens) {
    if (title.split(" ").includes(token)) score += 150;
    if (identityText.split(" ").includes(token)) score += 120;
    if (tags.some((tag) => tag.split(" ").includes(token))) score += 100;
    if (gear.split(" ").includes(token)) score += 75;
    if (author.split(" ").includes(token)) score += 60;
  }
  return score;
}

const compareIdentity = (left: CloudTone, right: CloudTone) =>
  right.downloads - left.downloads
  || right.rating - left.rating
  || timestamp(right.createdAt) - timestamp(left.createdAt)
  || left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
  || left.id.localeCompare(right.id);

const compareTrending = (left: CloudTone, right: CloudTone) =>
  right.rating - left.rating
  || right.downloads - left.downloads
  || timestamp(right.createdAt) - timestamp(left.createdAt)
  || left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
  || left.id.localeCompare(right.id);

function matchesArchitecture(tone: CloudTone, architecture: ToneArchitectureFilter) {
  if (architecture === "all" || tone.source !== "Tone3000") return true;
  const architectureText = metadataText(tone, ["architecture", "architectures"]);
  const hasArchitectureMetadata = Boolean(architectureText) || Boolean(metadataText(tone, ["a1_models_count", "a1_model_count", "a2_models_count", "a2_model_count", "custom_models_count", "custom_model_count"]));
  if (!hasArchitectureMetadata) return true; // The provider request already selected it; older cached records may omit the counters.
  if (architecture === "a1") return hasPositiveMetadata(tone, ["a1_models_count", "a1_model_count"]) || architectureText.includes("a1");
  if (architecture === "custom") return hasPositiveMetadata(tone, ["custom_models_count", "custom_model_count"]) || architectureText.includes("custom");
  // A2 Full and A2 Lite are runtime modes of the same A2 model file. Both
  // therefore match the provider's A2 catalogue architecture.
  return hasPositiveMetadata(tone, ["a2_models_count", "a2_model_count"]) || metadataText(tone, ["architecture", "architectures"]).includes("a2");
}

export function filterAndSortTones(tones: CloudTone[], filters: ToneCatalogueFilters): CloudTone[] {
  const query = normalizeSearchText(filters.query);
  const queryTokens = [...new Set(query.split(" ").filter(Boolean))];
  const author = filters.author.trim().toLocaleLowerCase();
  const tags = listValues(filters.tag);
  const makes = listValues(filters.make);
  const favorites = new Set(filters.favoriteIds);
  const filtered = tones.filter((tone) => {
    if (filters.source !== "all" && tone.source !== filters.source) return false;
    if (filters.captureTypes.length && !filters.captureTypes.includes(tone.detectedType)) return false;
    if (query && !queryTokens.every((token) => searchableText(tone).includes(token))) return false;
    if (author && !listValues(author).some((creator) => tone.author.toLocaleLowerCase().includes(creator))) return false;
    if (tags.length && !tags.some((tag) => tone.tags.some((value) => value.toLocaleLowerCase() === tag))) return false;
    if (makes.length && !makes.some((make) => metadataText(tone, ["makes", "make", "manufacturer", "filters_makes"]).includes(make))) return false;
    if (!matchesArchitecture(tone, filters.architecture)) return false;
    const gearText = [tone.gear, metadataText(tone, ["gear", "gears", "gear_type"])].filter(Boolean).join(" ").toLocaleLowerCase();
    if (filters.gears.length && tone.source === "Tone3000" && !filters.gears.some((gear) => gearText.includes(gear.toLocaleLowerCase()))) return false;
    const sizesText = metadataText(tone, ["sizes", "size"]);
    if (filters.sizes.length && tone.source === "Tone3000" && !filters.sizes.some((size) => sizesText.includes(size.toLocaleLowerCase()))) return false;
    const formatText = metadataText(tone, ["format", "formats"]);
    if (filters.formats.length && tone.source === "Tone3000" && !filters.formats.some((format) => formatText.includes(format.toLocaleLowerCase()))) return false;
    const calibrationText = metadataText(tone, ["calibrated", "is_calibrated"]);
    if (filters.calibratedOnly && tone.source === "Tone3000" && calibrationText && !isTruthyMetadata(tone, ["calibrated", "is_calibrated"])) return false;
    if (filters.verifiedOnly && tone.source === "Tone3000" && !isTruthyMetadata(tone, ["verified", "is_verified", "user_verified", "user_is_verified"])) return false;
    if (tone.downloads < filters.minimumDownloads || tone.rating < filters.minimumFavorites) return false;
    if ((tone.modelCount ?? 0) < filters.minimumModels) return false;
    if (filters.publishedWithinDays > 0 && timestamp(tone.createdAt) < Date.now() - filters.publishedWithinDays * 86_400_000) return false;
    if (filters.licenses.length) {
      const toneLicenses = metadataText(tone, ["license"]).split(/[, ]+/);
      if (!filters.licenses.some((license) => toneLicenses.includes(license.toLocaleLowerCase()) || (license === "cco" && toneLicenses.includes("cc0")))) return false;
    }
    if (filters.artworkOnly && !tone.imageUrl) return false;
    if (filters.downloadState === "downloaded" && tone.downloaded !== true) return false;
    if (filters.downloadState === "not-downloaded" && tone.downloaded === true) return false;
    if (filters.favoritesOnly && !favorites.has(tone.id)) return false;
    return true;
  });
  if (filters.sort === "downloads-all-time") return filtered.sort((left, right) => right.downloads - left.downloads || compareIdentity(left, right));
  if (filters.sort === "favorites") return filtered.sort((left, right) => right.rating - left.rating || compareIdentity(left, right));
  if (filters.sort === "newest") return filtered.sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt) || compareIdentity(left, right));
  if (filters.sort === "oldest") return filtered.sort((left, right) => timestamp(left.createdAt) - timestamp(right.createdAt) || compareIdentity(left, right));
  if (filters.sort === "name") return filtered.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
  if (filters.sort === "trending" || !query) return filtered.sort(compareTrending);
  return filtered.sort((left, right) => toneSearchRelevance(right, query) - toneSearchRelevance(left, query) || compareIdentity(left, right));
}

export function popularToneTags(tones: CloudTone[], limit = 16): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const tone of tones) for (const tag of tone.tags) {
    const key = tag.trim().toLocaleLowerCase();
    if (!key) continue;
    const current = counts.get(key);
    counts.set(key, { tag: current?.tag ?? tag.trim(), count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)).slice(0, limit);
}
