import { describe, expect, it } from "vitest";
import type { CloudTone } from "./types";
import { filterAndSortTones, popularToneTags, tone3000GearsForCaptureTypes, type ToneCatalogueFilters } from "./tone-catalogue";

const tone = (id: string, patch: Partial<CloudTone> = {}): CloudTone => ({
  id, title: id, author: "Maker", description: "", captureType: "amp", detectedType: "amp", tags: [],
  rating: 0, downloads: 0, source: "Tone3000", imageColor: "#fff", ...patch,
});
const filters: ToneCatalogueFilters = { query: "", source: "all", captureTypes: [], author: "", tag: "", make: "", architecture: "all", gears: [], sizes: [], formats: [], calibratedOnly: false, verifiedOnly: false, minimumDownloads: 0, minimumFavorites: 0, minimumModels: 0, publishedWithinDays: 0, licenses: [], artworkOnly: false, downloadState: "all", favoritesOnly: false, favoriteIds: [], sort: "best-match" };

describe("TonePilot catalogue filtering", () => {
  it("searches provider metadata and combines advanced filters", () => {
    const tones = [tone("one", { metadata: { amplifier: "JCM 800" }, downloads: 500, rating: 20 }), tone("two", { title: "Clean combo", downloads: 20 })];
    expect(filterAndSortTones(tones, { ...filters, query: "jcm", minimumDownloads: 100 }).map((item) => item.id)).toEqual(["one"]);
  });

  it("sorts without mutating the store array", () => {
    const tones = [tone("low", { downloads: 1 }), tone("high", { downloads: 100 })];
    expect(filterAndSortTones(tones, { ...filters, sort: "downloads-all-time" }).map((item) => item.id)).toEqual(["high", "low"]);
    expect(tones.map((item) => item.id)).toEqual(["low", "high"]);
  });

  it("ranks a title match above a popular unrelated result that only mentions the query", () => {
    const tones = [
      tone("mesa", { title: "Mesa Dual Rectifier", description: "Compared with Fortin tones", downloads: 50_000, rating: 800 }),
      tone("tag", { title: "Modern high gain", tags: ["Fortin"], downloads: 9_000 }),
      tone("fortin", { title: "Fortin Cali Suite", downloads: 30 }),
    ];
    expect(filterAndSortTones(tones, { ...filters, query: "Fortin" }).map((item) => item.id)).toEqual(["fortin", "tag", "mesa"]);
  });

  it("matches multi-word searches across identity fields and uses deterministic tie breakers", () => {
    const tones = [
      tone("older", { title: "Cali Lead", metadata: { manufacturer: "Fortin" }, downloads: 10, createdAt: "2025-01-01" }),
      tone("newer", { title: "Cali Lead", metadata: { manufacturer: "Fortin" }, downloads: 20, createdAt: "2026-01-01" }),
      tone("wrong", { title: "Cali Clean", author: "Someone else" }),
    ];
    expect(filterAndSortTones(tones, { ...filters, query: "Fortin Cali" }).map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("respects an explicit date sort even when a search query is present", () => {
    const tones = [
      tone("title", { title: "Fortin Cali", createdAt: "2024-01-01" }),
      tone("notes", { title: "Other amp", description: "Fortin", createdAt: "2026-01-01" }),
    ];
    expect(filterAndSortTones(tones, { ...filters, query: "Fortin", sort: "newest" }).map((item) => item.id)).toEqual(["notes", "title"]);
  });

  it("returns the most common normalized tags", () => {
    expect(popularToneTags([tone("a", { tags: ["British", "Rock"] }), tone("b", { tags: ["british"] })], 1)).toEqual([{ tag: "British", count: 2 }]);
  });

  it("converts capture chips into provider-side Tone3000 gear filters", () => {
    expect(tone3000GearsForCaptureTypes(["amp"])).toEqual(["amp"]);
    expect(tone3000GearsForCaptureTypes(["effect"])).toEqual(["pedal", "outboard", "space"]);
    expect(tone3000GearsForCaptureTypes(["amp+ir", "ir"])).toEqual(["amp-cab", "cab"]);
    expect(tone3000GearsForCaptureTypes([], ["experimental"])).toEqual(["experimental"]);
  });

  it("understands Tone3000 architecture, size, format and trust metadata", () => {
    const tones = [
      tone("a2", { metadata: { a2_models_count: 2, format: "nam", gear: "amp", "user.is_verified": true } }),
      tone("a1", { metadata: { a1_models_count: 1, format: "nam", gear: "pedal", sizes: "lite, nano", "user.is_verified": false } }),
    ];
    expect(filterAndSortTones(tones, { ...filters, architecture: "a2-lite", formats: ["nam"], verifiedOnly: true }).map((item) => item.id)).toEqual(["a2"]);
    expect(filterAndSortTones(tones, { ...filters, architecture: "a1", gears: ["pedal"], sizes: ["nano"] }).map((item) => item.id)).toEqual(["a1"]);
  });

  it("supports exact multi-tag, make, license, age, artwork and model-quality filters", () => {
    const recent = new Date().toISOString();
    const tones = [
      tone("match", { tags: ["High Gain"], createdAt: recent, imageUrl: "https://example.test/a.jpg", modelCount: 3, metadata: { makes: "Marshall JCM800", license: "cc-by" } }),
      tone("other", { tags: ["Clean"], createdAt: "2020-01-01", modelCount: 1, metadata: { makes: "Fender Twin", license: "t3k" } }),
    ];
    expect(filterAndSortTones(tones, { ...filters, tag: "metal, High Gain", make: "JCM800", licenses: ["cc-by"], minimumModels: 2, publishedWithinDays: 30, artworkOnly: true }).map((item) => item.id)).toEqual(["match"]);
  });
});
