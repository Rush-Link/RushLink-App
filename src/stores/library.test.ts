import { beforeEach, describe, expect, it } from "vitest";
import { demoRigs, demoSetlists } from "../data/demo-data";
import { flushAppPersistence, useAppStore } from "./app-store";

describe("local device-library behaviour", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState((state) => ({
      rigs: structuredClone(demoRigs),
      favoriteRigIds: demoRigs.filter((rig) => rig.favorite).map((rig) => rig.id),
      selectedRigId: demoRigs[0].id,
      selectedBlockId: demoRigs[0].blocks[0]?.id ?? null,
      setlists: structuredClone(demoSetlists),
      selectedSetlistId: demoSetlists[0].id,
      liveSnapshot: null,
      snapshots: [],
      preferences: { ...state.preferences, autoBackup: false },
    }));
  });

  it("toggles and persists RushLink rig favourites", () => {
    useAppStore.getState().toggleFavoriteRig("rig-3");
    expect(useAppStore.getState().favoriteRigIds).toContain("rig-3");
    flushAppPersistence();

    const persisted = JSON.parse(localStorage.getItem("rushlink-state-v1") ?? "{}") as { state?: { favoriteRigIds?: string[] } };
    expect(persisted.state?.favoriteRigIds).toContain("rig-3");
  });

  it("keeps rig management functional in desktop demo mode", async () => {
    const store = useAppStore.getState();
    await store.createRig("Library Test");
    const createdId = useAppStore.getState().selectedRigId;
    expect(useAppStore.getState().rigs.find((rig) => rig.id === createdId)?.name).toBe("Library Test");

    await useAppStore.getState().renameRig(createdId, "Renamed Test");
    expect(useAppStore.getState().rigs.find((rig) => rig.id === createdId)?.name).toBe("Renamed Test");

    await useAppStore.getState().duplicateRig("Copied Test");
    expect(useAppStore.getState().rigs.some((rig) => rig.name === "Copied Test")).toBe(true);

    await useAppStore.getState().deleteRig(createdId);
    expect(useAppStore.getState().rigs.some((rig) => rig.id === createdId)).toBe(false);
  });

  it("creates, edits and removes setlists in desktop demo mode", async () => {
    await useAppStore.getState().createSetlist("Demo Performance");
    const setlistId = useAppStore.getState().selectedSetlistId;
    useAppStore.getState().addRigToSetlist("rig-1");
    useAppStore.getState().addRigToSetlist("rig-2");
    useAppStore.getState().moveSetlistItem(1, 0);

    let selected = useAppStore.getState().setlists.find((list) => list.id === setlistId);
    expect(selected?.items.map((item) => item.rigId)).toEqual(["rig-2", "rig-1"]);

    await useAppStore.getState().renameSetlist(setlistId, "Opening Set");
    selected = useAppStore.getState().setlists.find((list) => list.id === setlistId);
    expect(selected?.name).toBe("Opening Set");

    await useAppStore.getState().saveSelectedSetlist();
    await useAppStore.getState().deleteSetlist(setlistId);
    expect(useAppStore.getState().setlists.some((list) => list.id === setlistId)).toBe(false);
  });
});
