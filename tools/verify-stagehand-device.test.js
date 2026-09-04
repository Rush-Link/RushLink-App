import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageHandStateSummary, validateStageHandContract } from "./verify-stagehand-device.mjs";

describe("StageHand reflected device contract", () => {
  it("matches every required property and method in the captured Flex Prime subtree", async () => {
    const tree = JSON.parse(await readFile(join(process.cwd(), "reference/headrush/raw/subtree.json"), "utf8"));
    const checks = validateStageHandContract(tree);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThan(30);
  });

  it("summarizes live state without retaining the full reflected tree", async () => {
    const tree = JSON.parse(await readFile(join(process.cwd(), "reference/headrush/raw/subtree.json"), "utf8"));
    expect(stageHandStateSummary(tree)).toMatchObject({
      rig: expect.any(String),
      occupiedSlots: expect.any(Number),
      tuner: { open: expect.any(Boolean), muted: expect.any(Boolean) },
      drums: { playing: expect.any(Boolean), muted: expect.any(Boolean) },
      tempoBpm: expect.any(Number),
    });
    expect(stageHandStateSummary(tree).tempoBpm).toBeGreaterThanOrEqual(30);
    expect(stageHandStateSummary(tree).tempoBpm).toBeLessThanOrEqual(240);
  });
});
