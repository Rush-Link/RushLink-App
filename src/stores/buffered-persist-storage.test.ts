import { afterEach, describe, expect, it, vi } from "vitest";
import { createBufferedPersistStorage } from "./buffered-persist-storage";

afterEach(() => vi.useRealTimers());

describe("createBufferedPersistStorage", () => {
  it("turns a burst of updates into one synchronous storage write", async () => {
    vi.useFakeTimers();
    const backing = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ revision: number }>({ delayMs: 250, storage: backing });

    for (let revision = 1; revision <= 100; revision += 1) storage.setItem("app", { state: { revision } });
    expect(backing.setItem).not.toHaveBeenCalled();
    expect(storage.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(backing.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(backing.setItem.mock.calls[0][1]).state.revision).toBe(100);
  });

  it("skips an unchanged memoized persisted slice", () => {
    const backing = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: string }>({ storage: backing });
    const state = { value: "stable" };
    storage.setItem("app", { state });
    storage.flush();
    storage.setItem("app", { state });
    storage.flush();
    expect(backing.setItem).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest state on demand", () => {
    const backing = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: number }>({ storage: backing });
    storage.setItem("app", { state: { value: 42 } });
    storage.flush();
    expect(backing.setItem).toHaveBeenCalledTimes(1);
  });

  it("treats malformed JSON as an empty workspace without throwing", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const backing = { getItem: vi.fn(() => "{broken"), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: number }>({ storage: backing });

    expect(storage.getItem("app")).toBeNull();
    expect(warning).toHaveBeenCalledWith("Could not read persisted app", expect.any(SyntaxError));
  });

  it("recovers when browser storage itself rejects a read", () => {
    const denial = new DOMException("Storage denied", "SecurityError");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const backing = { getItem: vi.fn(() => { throw denial; }), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: number }>({ storage: backing });

    expect(storage.getItem("app")).toBeNull();
    expect(warning).toHaveBeenCalledWith("Could not read persisted app", denial);
  });

  it("contains quota failures and accepts a later retry", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const backing = { getItem: vi.fn(() => null), setItem: vi.fn().mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); }), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: number }>({ storage: backing });

    storage.setItem("app", { state: { value: 1 } });
    expect(() => storage.flush()).not.toThrow();
    expect(storage.pending()).toBe(0);
    expect(warning).toHaveBeenCalledWith("Could not persist app", expect.any(DOMException));

    storage.setItem("app", { state: { value: 2 } });
    storage.flush();
    expect(backing.setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(backing.setItem.mock.calls[1][1]).state.value).toBe(2);
  });

  it("cancels a queued write when persisted state is removed", async () => {
    vi.useFakeTimers();
    const backing = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: number }>({ delayMs: 100, storage: backing });
    storage.setItem("app", { state: { value: 1 } });

    storage.removeItem("app");
    await vi.advanceTimersByTimeAsync(150);

    expect(storage.pending()).toBe(0);
    expect(backing.setItem).not.toHaveBeenCalled();
    expect(backing.removeItem).toHaveBeenCalledWith("app");
  });

  it("writes the same state reference again when its schema version changes", () => {
    const backing = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const storage = createBufferedPersistStorage<{ value: string }>({ storage: backing });
    const state = { value: "stable" };
    storage.setItem("app", { state, version: 3 });
    storage.flush();
    storage.setItem("app", { state, version: 4 });
    storage.flush();

    expect(backing.setItem).toHaveBeenCalledTimes(2);
  });
});
