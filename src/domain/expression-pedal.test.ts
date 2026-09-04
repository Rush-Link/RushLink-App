import { describe, expect, it } from "vitest";
import { expressionPedalCapabilities } from "./expression-pedal";

describe("expression pedal mode capabilities", () => {
  it("limits Classic to one assignment and keeps A/B switching", () => {
    expect(expressionPedalCapabilities(1, 0)).toMatchObject({ assignmentLimit: 1, supportsBankSwitching: true, supportsAutoEngage: false });
  });

  it("exposes all four Advanced assignments without Auto-Engage controls", () => {
    expect(expressionPedalCapabilities(1, 1)).toMatchObject({ assignmentLimit: 4, supportsBankSwitching: true, supportsAutoEngage: false });
  });

  it("shows only the Auto-Engage target and movement controls in Auto-Engage mode", () => {
    expect(expressionPedalCapabilities(1, 2)).toMatchObject({ assignmentLimit: 1, supportsBankSwitching: false, supportsAutoEngage: true });
  });

  it("uses the four firmware lanes and Auto-Engage fields exposed by external Pedal B", () => {
    expect(expressionPedalCapabilities(2, null)).toMatchObject({ assignmentLimit: 4, supportsBankSwitching: false, supportsAutoEngage: true });
  });
});
