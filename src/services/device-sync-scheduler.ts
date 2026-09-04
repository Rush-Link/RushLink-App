export interface AsyncRefreshScheduler {
  trigger: () => void;
  cancel: () => void;
  pending: () => boolean;
}

/** Coalesces event bursts, enforces a minimum request interval and never overlaps work. */
export function createAsyncRefreshScheduler(
  task: () => Promise<unknown>,
  options: { debounceMs?: number; minIntervalMs?: number; onError?: (error: unknown) => void } = {},
): AsyncRefreshScheduler {
  const debounceMs = options.debounceMs ?? 100;
  const minIntervalMs = options.minIntervalMs ?? 600;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  let cancelled = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  const schedule = () => {
    if (cancelled || running || timer || !dirty) return;
    const throttleDelay = Math.max(0, lastStartedAt + minIntervalMs - Date.now());
    timer = setTimeout(run, Math.max(debounceMs, throttleDelay));
  };

  const run = async () => {
    timer = undefined;
    if (cancelled || running || !dirty) return;
    dirty = false;
    running = true;
    lastStartedAt = Date.now();
    try {
      await task();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
      schedule();
    }
  };

  return {
    trigger() {
      if (cancelled) return;
      dirty = true;
      schedule();
    },
    cancel() {
      cancelled = true;
      dirty = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    pending: () => dirty || running || Boolean(timer),
  };
}
