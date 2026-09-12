import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDevice } from "../data/demo-data";
import { DEFAULT_TONE3000_FILTERS, deviceApi } from "../services/device-api";
import { useAppStore } from "./app-store";

const toneRows = (page: number, size: number) => Array.from({ length: size }, (_, index) => ({
  id: (page - 1) * size + index + 1,
  title: `Tone ${page}-${index + 1}`,
  gear: "amp",
  user: { username: "qa" },
}));

const cloudRows = (size: number) => Array.from({ length: size }, (_, index) => ({
  rig_metadata: { id: `cloud-${index + 1}`, display_name: `Cloud ${index + 1}` },
}));

function resetCatalogue() {
  useAppStore.setState({
    device: { ...demoDevice, status: "ready" },
    tones: [],
    toneTotals: { tone3000: null, headRushCloud: null },
    toneHasMore: false,
    toneHasMoreBySource: { tone3000: false, headRushCloud: false },
    toneUpdatedAtBySource: { tone3000: null, headRushCloud: null },
    toneCursor: {
      tone3000: { query: "", nextPage: null, filters: { ...DEFAULT_TONE3000_FILTERS } },
      headRushCloud: { query: "", nextToken: null },
    },
    toneLoading: false,
    toneLoadingMore: false,
    toneLoadingMoreSource: null,
    tonePrefetchingSource: null,
    toneError: null,
  });
}

describe("ToneMod 50-item provider batches", () => {
  beforeEach(() => {
    resetCatalogue();
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("prefetches two native Tone3000 pages because the device fixes each page at 25", async () => {
    const search = vi.spyOn(deviceApi, "searchTone3000").mockImplementation(async (_query, page, pageSize) => ({
      success: true,
      result: { total: 100, total_pages: 4, tones: toneRows(page ?? 1, pageSize ?? 25) },
    }));

    await useAppStore.getState().prefetchToneService("Tone3000", "fifty-prefetch", DEFAULT_TONE3000_FILTERS);

    expect(search.mock.calls.map((call) => [call[1], call[2]])).toEqual([[1, 25], [2, 25]]);
    expect(useAppStore.getState().tones.filter((tone) => tone.source === "Tone3000")).toHaveLength(50);
    expect(useAppStore.getState().toneCursor.tone3000.nextPage).toBe(3);
  });

  it("loads the next two Tone3000 pages as one more 50-item batch", async () => {
    const search = vi.spyOn(deviceApi, "searchTone3000").mockImplementation(async (_query, page, pageSize) => ({
      success: true,
      result: { total: 100, total_pages: 4, tones: toneRows(page ?? 1, pageSize ?? 25) },
    }));
    await useAppStore.getState().refreshToneServices("fifty-more", true, DEFAULT_TONE3000_FILTERS, "Tone3000");
    search.mockClear();

    await useAppStore.getState().loadMoreTones("Tone3000");

    expect(search.mock.calls.map((call) => [call[1], call[2]])).toEqual([[3, 25], [4, 25]]);
    expect(useAppStore.getState().tones.filter((tone) => tone.source === "Tone3000")).toHaveLength(100);
    expect(useAppStore.getState().toneHasMoreBySource.tone3000).toBe(false);
  });

  it("requests one native 50-item page from HeadRush Cloud", async () => {
    const list = vi.spyOn(deviceApi, "listHeadRushCloud").mockResolvedValue({
      item_collection: cloudRows(50),
      page_metadata: { total_size: 100, next_page_token: "cloud-next" },
    });

    await useAppStore.getState().prefetchToneService("HeadRush Cloud", "cloud-fifty");

    expect(list).toHaveBeenCalledWith("cloud-fifty", undefined, 50, expect.any(Object));
    expect(useAppStore.getState().tones.filter((tone) => tone.source === "HeadRush Cloud")).toHaveLength(50);
  });

  it("keeps the successful first page and retries the failed page after a partial batch", async () => {
    const search = vi.spyOn(deviceApi, "searchTone3000").mockImplementation(async (_query, page, pageSize) => {
      if (page === 2) throw new Error("device timeout");
      return { success: true, result: { total: 100, total_pages: 4, tones: toneRows(page ?? 1, pageSize ?? 25) } };
    });

    await useAppStore.getState().refreshToneServices("partial", true, DEFAULT_TONE3000_FILTERS, "Tone3000");

    const state = useAppStore.getState();
    expect(state.tones.filter((tone) => tone.source === "Tone3000")).toHaveLength(25);
    expect(state.toneCursor.tone3000.nextPage).toBe(2);
    expect(state.toneHasMoreBySource.tone3000).toBe(true);
    expect(state.toneError).toMatch(/partial page/i);
    expect(search.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  });

  it("preserves existing results and restores loading state when load-more fails", async () => {
    const search = vi.spyOn(deviceApi, "searchTone3000").mockImplementation(async (_query, page, pageSize) => ({
      success: true,
      result: { total: 100, total_pages: 4, tones: toneRows(page ?? 1, pageSize ?? 25) },
    }));
    await useAppStore.getState().refreshToneServices("stable", true, DEFAULT_TONE3000_FILTERS, "Tone3000");
    const before = useAppStore.getState().tones.map((tone) => tone.id);
    search.mockRejectedValue(new Error("connection lost"));

    await useAppStore.getState().loadMoreTones("Tone3000");

    const state = useAppStore.getState();
    expect(state.tones.map((tone) => tone.id)).toEqual(before);
    expect(state.toneCursor.tone3000.nextPage).toBe(3);
    expect(state.toneLoadingMore).toBe(false);
    expect(state.toneLoadingMoreSource).toBeNull();
    expect(state.toneError).toMatch(/Could not load the next Tone3000 page/i);
  });
});
