import { describe, expect, it } from "vitest";
import { mixAvailableForRouting, routingNodeSections } from "./editor";

describe("Rig routing node editor", () => {
  it("disables the parallel mixer for a straight signal path", () => {
    expect(mixAvailableForRouting(0)).toBe(false);
    expect([1, 2, 3, 4].every(mixAvailableForRouting)).toBe(true);
  });

  it("groups every meaningful reflected utility property without duplication", () => {
    const expected = {
      input: ["RigInput", "InputGain", "Lock", "GateThresh", "GateRelease", "FilterThreshold", "PPTInGain", "PPTMono", "PPTRange", "PPTTrigThresh", "PPTEndThresh", "PPTRetrigger"],
      mix: ["Para1Level", "Para1Pan", "Para2Level", "Para2Pan", "ParaDelay", "ParaXFade"],
      output: ["RigVolume", "RigWidth"],
    } as const;
    for (const node of ["input", "mix", "output"] as const) {
      const properties = routingNodeSections(node).flatMap((section) => section.properties);
      expect(properties).toEqual(expected[node]);
      expect(new Set(properties).size).toBe(properties.length);
    }
  });
});
