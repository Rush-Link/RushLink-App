import { afterEach, describe, expect, it, vi } from "vitest";
import { testRigTemplates } from "../data/demo-data";
import { APP_STATE_VERSION, flushAppPersistence, migratePersistedAppState, migratePersistedTestRigIrFiles, migratePersistedTestRigOrder, useAppStore } from "./app-store";

describe("app-store persistence performance", () => {
  afterEach(() => {
    useAppStore.getState().setPerformanceTunerActive(false);
    flushAppPersistence();
    vi.restoreAllMocks();
  });

  it("does not write the large workspace for volatile live-state updates", () => {
    // Warm the memoized persisted slice after hydration/legacy migration.
    useAppStore.getState().setPerformanceTunerActive(false);
    flushAppPersistence();
    const write = vi.spyOn(localStorage, "setItem");

    for (let index = 0; index < 100; index += 1) {
      useAppStore.getState().setPerformanceTunerActive(index % 2 === 0);
    }
    flushAppPersistence();

    expect(write).not.toHaveBeenCalled();
  });

  it("preserves a user's custom Test Rig order on subsequent database writes", () => {
    const lead = structuredClone(testRigTemplates.find((rig) => rig.id === "lead")!);
    lead.blocks = lead.blocks.map((block) => block.category === "delay" ? { ...block, slot: 2 } : block.category === "reverb" ? { ...block, slot: 4 } : block);
    useAppStore.setState({ testRigs: [lead], selectedTestRigId: lead.id });
    flushAppPersistence();

    const persisted = JSON.parse(localStorage.getItem("rushlink-state-v1") ?? "{}") as { state?: { testRigs?: typeof testRigTemplates } };
    const blocks = persisted.state?.testRigs?.[0].blocks ?? [];
    const ir = blocks.find((block) => block.category === "ir")!;
    const delay = blocks.find((block) => block.category === "delay")!;
    const reverb = blocks.find((block) => block.category === "reverb")!;
    expect(ir.slot).toBe(7);
    expect(delay.slot).toBe(2);
    expect(reverb.slot).toBe(4);
  });

  it("repairs the old database layout only during migration", () => {
    const lead = structuredClone(testRigTemplates.find((rig) => rig.id === "lead")!);
    lead.blocks = lead.blocks.map((block) => block.category === "delay" ? { ...block, slot: 2 } : block.category === "reverb" ? { ...block, slot: 4 } : block);
    const migrated = migratePersistedTestRigOrder([lead])[0];
    const ir = migrated.blocks.find((block) => block.category === "ir")!;
    const delay = migrated.blocks.find((block) => block.category === "delay")!;
    const reverb = migrated.blocks.find((block) => block.category === "reverb")!;
    expect([ir.slot, delay.slot, reverb.slot]).toEqual([7, 8, 9]);
  });

  it("adds missing template IR files to old database records without replacing a user selection", () => {
    const clean = structuredClone(testRigTemplates.find((rig) => rig.id === "clean")!);
    const withoutFile = structuredClone(clean);
    withoutFile.blocks = withoutFile.blocks.map((block) => block.category === "ir"
      ? { ...block, parameters: block.parameters.filter((parameter) => parameter.id !== "IR") }
      : block);
    const customFile = structuredClone(clean);
    customFile.blocks = customFile.blocks.map((block) => block.category === "ir"
      ? { ...block, parameters: block.parameters.map((parameter) => parameter.id === "IR" ? { ...parameter, value: "Impulse Responses/User/My Cab.wav" } : parameter) }
      : block);

    const [repaired, preserved] = migratePersistedTestRigIrFiles([withoutFile, customFile]);
    expect(repaired.blocks.find((block) => block.category === "ir")?.parameters.find((parameter) => parameter.id === "IR")).toMatchObject({
      value: "Impulse Responses/Choptones/CT-Fend312EMFDS-4217B.wav",
      deviceFile: { fileType: 2, startPath: "Impulse Responses" },
    });
    expect(preserved.blocks.find((block) => block.category === "ir")?.parameters.find((parameter) => parameter.id === "IR")?.value).toBe("Impulse Responses/User/My Cab.wav");
  });

  it("upgrades every version-3 database Test Rig with a complete reflected IR file control", () => {
    const versionThreeRigs = structuredClone(testRigTemplates).map((rig) => ({
      ...rig,
      blocks: rig.blocks.map((block) => block.category !== "ir" ? block : {
        ...block,
        parameters: block.parameters.map((parameter) => parameter.id !== "IR" ? parameter : {
          ...parameter,
          value: String(parameter.value).split("/").at(-1)!,
          sourceProperty: undefined,
          deviceFile: undefined,
        }),
      }),
    }));

    const migrated = migratePersistedAppState({ testRigs: versionThreeRigs }, 3);

    expect(APP_STATE_VERSION).toBe(6);
    expect(migrated.testRigs).toHaveLength(testRigTemplates.length);
    for (const rig of migrated.testRigs!) {
      const expected = testRigTemplates.find((template) => template.id === rig.id)!;
      const actualFile = rig.blocks.find((block) => block.category === "ir")!.parameters.find((parameter) => parameter.id === "IR")!;
      const expectedFile = expected.blocks.find((block) => block.category === "ir")!.parameters.find((parameter) => parameter.id === "IR")!;
      expect(actualFile, rig.name).toMatchObject({
        value: expectedFile.value,
        sourceProperty: "IR",
        writable: true,
        deviceFile: { fileType: 2, startPath: "Impulse Responses" },
      });
    }
  });

  it("persists all six corrected templates in the local database shape", () => {
    useAppStore.setState({ testRigs: structuredClone(testRigTemplates), selectedTestRigId: "clean" });
    flushAppPersistence();

    const database = JSON.parse(localStorage.getItem("rushlink-state-v1") ?? "{}") as { version?: number; state?: { testRigs?: typeof testRigTemplates } };
    expect(database.version).toBe(APP_STATE_VERSION);
    expect(database.state?.testRigs?.map((rig) => rig.id)).toEqual(["clean", "overdrive", "distortion", "lead", "rhythm", "metal"]);
    for (const rig of database.state?.testRigs ?? []) {
      const ir = rig.blocks.find((block) => block.category === "ir")!;
      expect(ir.parameters.find((parameter) => parameter.id === "IR"), rig.name).toMatchObject({
        value: expect.stringMatching(/^Impulse Responses\/Choptones\/.+\.wav$/i),
        sourceProperty: "IR",
        deviceFile: { fileType: 2, startPath: "Impulse Responses" },
      });
    }
  });
});
