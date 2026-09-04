import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

function createTestStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(String(key)) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(String(key)),
    setItem: (key: string, value: string) => values.set(String(key), String(value)),
  };
}

Object.defineProperties(globalThis, {
  localStorage: { configurable: true, value: createTestStorage() },
  sessionStorage: { configurable: true, value: createTestStorage() },
});

type AppStoreModule = typeof import("../stores/app-store");
let appStore: AppStoreModule["useAppStore"] | undefined;
let originalStoreActions: Record<string, unknown> | undefined;

// Zustand stores are module singletons. A test that injects a fake action with
// setState() must not silently replace that action for another file running in
// the same worker. Resolve the store lazily: Vitest gets to install each file's
// hoisted module mocks first, while this hook still runs before test mutations.
beforeEach(async () => {
  if (appStore) return;
  appStore = (await import("../stores/app-store")).useAppStore;
  originalStoreActions = Object.fromEntries(
    Object.entries(appStore.getState()).filter(([, value]) => typeof value === "function"),
  );
});

afterEach(() => {
  cleanup();
  if (appStore && originalStoreActions) appStore.setState(originalStoreActions);
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
