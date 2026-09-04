import { describe, expect, it } from "vitest";
import { mapHeadRushCloud, mapTone3000, mapTone3000Models, parseHeadRushCloudPage, parseTone3000Page, replaceProviderTones } from "./app-store";

describe("TonePilot live service mapping", () => {
  it("maps a public Tone3000 group and preserves its remote group id", () => {
    const tones = mapTone3000({ success: true, result: { tones: [{ id: 86614, title: "Dual Amp", gear: "amp-cab", published_at: "2026-08-14T10:30:00Z", downloads_count: 473, favorites_count: 17, images: ["https://example.test/tone.jpg"], tags: [{ name: "boutique" }], makes: [{ name: "British 800" }], user: { display_name: "Maker" } }] } });
    expect(tones[0]).toMatchObject({ id: "t3k-86614", remoteId: 86614, remoteKind: "tone-group", source: "Tone3000", detectedType: "amp+ir", createdAt: "2026-08-14T10:30:00Z" });
    expect(tones[0].metadata).toMatchObject({ gear: "amp-cab", "user.display_name": "Maker", "filters.makes": "British 800" });
    expect(tones[0]).not.toHaveProperty("downloaded");
  });

  it("maps public HeadRush Cloud results independently of download state", () => {
    const tones = mapHeadRushCloud({ item_collection: [{ rig_metadata: { id: "cloud-1", display_name: "Public Rig", artist: "Artist", genre: "Rock", likes_count: 10, downloads_count: 20 }, relationship: { is_downloaded_by_me: false } }] });
    expect(tones[0]).toMatchObject({ id: "hrc-cloud-1", remoteId: "cloud-1", remoteKind: "rig", source: "HeadRush Cloud", downloaded: false });
  });

  it("reads Tone3000 page totals used for multi-page catalogue loading", () => {
    const page = parseTone3000Page({ success: true, result: { total: 842, total_pages: 34, tones: [] } });
    expect(page).toMatchObject({ total: 842, totalPages: 34, tones: [] });
  });

  it("reads the HeadRush Cloud continuation token and public catalogue total", () => {
    const page = parseHeadRushCloudPage({ item_collection: [], page_metadata: { total_size: 1276, next_page_token: "page-2" } });
    expect(page).toMatchObject({ total: 1276, nextPageToken: "page-2", tones: [] });
  });

  it("keeps all useful primitive metadata for an exact Tone3000 model", () => {
    const models = mapTone3000Models([{ id: 91, name: "Lead channel", arch: "A2", size_bytes: 2048, calibrated: true, gain_stage: "high", url: "https://example.test/model" }], "A2");
    expect(models[0]).toMatchObject({ id: "t3k-model-91", remoteId: 91, architecture: "A2", sizeBytes: 2048, calibrated: true, metadata: { gain_stage: "high" } });
  });

  it("replaces one provider page without mixing or deleting the other provider cache", () => {
    const oldTone3000 = mapTone3000({ success: true, result: { tones: [{ id: 1, title: "Old" }] } });
    const cloud = mapHeadRushCloud({ item_collection: [{ rig_metadata: { id: "cloud-1", display_name: "Cloud" } }] });
    const nextTone3000 = mapTone3000({ success: true, result: { tones: [{ id: 2, title: "New" }] } });
    const merged = replaceProviderTones([...oldTone3000, ...cloud], "Tone3000", nextTone3000);
    expect(merged.map((tone) => tone.title)).toEqual(["Cloud", "New"]);
    expect(merged.filter((tone) => tone.source === "HeadRush Cloud")).toHaveLength(1);
  });
});
