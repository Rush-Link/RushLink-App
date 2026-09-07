import { describe, expect, it } from "vitest";
import { stageHandStateSummary, validateStageHandContract } from "./verify-stagehand-device.mjs";
import { stagehandFixture } from "./fixtures/stagehand-subtree.mjs";

describe("StageHand reflected device contract", () => {
  it("matches every required property and method in an independent firmware-shaped fixture", () => {
    const tree = stagehandFixture();
    const checks = validateStageHandContract(tree);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThan(30);
  });

  it("summarizes state and converts normalized tempo without retaining the full tree", () => {
    const tree = stagehandFixture();
    expect(stageHandStateSummary(tree)).toEqual({
      rig: "QA Stage Rig", occupiedSlots: 4, scene: 4,
      tuner: { open: true, muted: false, note: "A", referenceHz: 440 },
      drums: { playing: true, muted: false, kit: "QA Kit", part: "Verse", bar: 3, beat: 2 },
      tempoBpm: 120,
    });
  });

  it("detects missing drum methods and scene controls that became read-only", () => {
    const tree = stagehandFixture();
    delete tree["/Evil/Engine/DrumsCtrl"].meta["x-methods"].playFill;
    tree["/Evil/Engine/FootSwitch"].meta.properties.SceneActive5.readOnly = true;
    const failures = validateStageHandContract(tree).filter((check) => !check.ok);
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "/Evil/Engine/DrumsCtrl.playFill()", detail: "method missing" }),
      expect.objectContaining({ capability: "/Evil/Engine/FootSwitch.SceneActive5 write", detail: "marked read-only" }),
    ]));
    expect(failures).toHaveLength(2);
  });
});
