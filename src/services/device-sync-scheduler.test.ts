import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsyncRefreshScheduler } from "./device-sync-scheduler";

afterEach(() => vi.useRealTimers());

describe("createAsyncRefreshScheduler", () => {
  it("coalesces a large WebSocket burst into one refresh", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const scheduler = createAsyncRefreshScheduler(task, { debounceMs: 100, minIntervalMs: 600 });
    for (let index = 0; index < 100; index += 1) scheduler.trigger();

    await vi.advanceTimersByTimeAsync(99);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs one trailing refresh for events received during an active request", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const scheduler = createAsyncRefreshScheduler(task, { debounceMs: 50, minIntervalMs: 200 });
    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(50);
    expect(task).toHaveBeenCalledTimes(1);

    scheduler.trigger();
    scheduler.trigger();
    finish?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("cancels queued work", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const scheduler = createAsyncRefreshScheduler(task);
    scheduler.trigger();
    scheduler.cancel();
    await vi.runAllTimersAsync();
    expect(task).not.toHaveBeenCalled();
  });

  it("contains task failures, reports them, and remains usable", async () => {
    vi.useFakeTimers();
    const failure = new Error("temporary refresh failure");
    const task = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = createAsyncRefreshScheduler(task, { debounceMs: 10, minIntervalMs: 20, onError });

    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(scheduler.pending()).toBe(false);

    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(20);
    expect(task).toHaveBeenCalledTimes(2);
    expect(scheduler.pending()).toBe(false);
  });

  it("cancels trailing work requested during an active refresh", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const scheduler = createAsyncRefreshScheduler(task, { debounceMs: 10, minIntervalMs: 20 });

    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(10);
    scheduler.trigger();
    expect(scheduler.pending()).toBe(true);
    scheduler.cancel();
    finish?.();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(task).toHaveBeenCalledOnce();
    expect(scheduler.pending()).toBe(false);
  });
});
