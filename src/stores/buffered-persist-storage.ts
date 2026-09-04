import type { PersistStorage, StorageValue } from "zustand/middleware";

interface BufferedPersistStorageOptions {
  delayMs?: number;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export interface BufferedPersistStorage<T> extends PersistStorage<T> {
  flush: () => void;
  pending: () => number;
}

/**
 * Zustand calls persistence after every store mutation. Live device state can
 * change several times per second, while the persisted workspace is much
 * larger and changes comparatively rarely. This adapter accepts the latest
 * snapshot immediately, but serializes and writes it once after the burst.
 */
export function createBufferedPersistStorage<T>({
  delayMs = 300,
  storage = localStorage,
}: BufferedPersistStorageOptions = {}): BufferedPersistStorage<T> {
  const queued = new Map<string, StorageValue<T>>();
  const lastState = new Map<string, { state: T; version?: number }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const commit = (name: string) => {
    const value = queued.get(name);
    queued.delete(name);
    const timer = timers.get(name);
    if (timer) clearTimeout(timer);
    timers.delete(name);
    if (!value) return;

    try {
      storage.setItem(name, JSON.stringify(value));
      lastState.set(name, value);
    } catch (error) {
      // A storage quota problem must not interrupt a live device control.
      console.warn(`Could not persist ${name}`, error);
    }
  };

  const flush = () => {
    for (const name of [...queued.keys()]) commit(name);
  };

  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

  return {
    getItem(name) {
      try {
        const raw = storage.getItem(name);
        if (!raw) return null;
        const value = JSON.parse(raw) as StorageValue<T>;
        lastState.set(name, value);
        return value;
      } catch (error) {
        // Browsers may deny storage access (private mode, policy, a broken
        // WebView) before JSON parsing even begins. Hydration must fall back to
        // defaults instead of preventing the application from starting.
        console.warn(`Could not read persisted ${name}`, error);
        return null;
      }
    },
    setItem(name, value) {
      const previous = queued.get(name) ?? lastState.get(name);
      if (previous && Object.is(previous.state, value.state) && previous.version === value.version) return;
      queued.set(name, value);
      const timer = timers.get(name);
      if (timer) clearTimeout(timer);
      timers.set(name, setTimeout(() => commit(name), delayMs));
    },
    removeItem(name) {
      const timer = timers.get(name);
      if (timer) clearTimeout(timer);
      timers.delete(name);
      queued.delete(name);
      lastState.delete(name);
      storage.removeItem(name);
    },
    flush,
    pending: () => queued.size,
  };
}
