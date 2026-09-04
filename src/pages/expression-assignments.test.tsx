import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HeadRushObject, HeadRushSubtree } from "../domain/types";
import { useAppStore } from "../stores/app-store";
import { ExpressionAssignmentsPanel } from "./assignments";

function pedal(mode: 0 | 1 | 2, external = false): HeadRushObject {
  const properties: NonNullable<HeadRushObject["meta"]>["properties"] = {
    AutoEngageDelay: { type: "number", minimum: 0, maximum: 5000 },
    AutoEngageMode: { type: "integer", minimum: 0, maximum: 2, "x-options": { strings: ["TOE UP", "TOE DOWN", "STOP"] } },
  };
  const value: Record<string, unknown> = { AutoEngageDelay: 0, AutoEngageMode: 0 };
  if (!external) {
    properties.PedalMode = { type: "integer", minimum: 0, maximum: 2, "x-options": { strings: ["Classic", "Advanced", "Auto-Engage"] } };
    properties.PedalAssignment = { type: "boolean", "x-options": { strings: ["A", "B"] } };
    properties.PedalAssignmentEdit = { type: "integer", minimum: 0, maximum: 1, "x-options": { strings: ["A", "B"] } };
    Object.assign(value, { PedalMode: mode, PedalAssignment: false, PedalAssignmentEdit: 0 });
  }
  for (let lane = 1; lane <= 4; lane += 1) {
    properties[`Module${lane}`] = { type: "string" };
    properties[`Param${lane}`] = { type: "string" };
    properties[`Min${lane}`] = { type: "number", minimum: 0, maximum: 100 };
    properties[`Max${lane}`] = { type: "number", minimum: 0, maximum: 100 };
    Object.assign(value, { [`Module${lane}`]: lane === 1 ? "Wah" : "Unassigned", [`Module${lane}List`]: ["Unassigned", "Wah"], [`Param${lane}`]: lane === 1 ? "Pedal" : "", [`Min${lane}`]: 0, [`Max${lane}`]: 1 });
  }
  return { meta: { properties }, value };
}

function tree(mode: 0 | 1 | 2): HeadRushSubtree {
  return { "/Evil/Engine/Pedal1": pedal(mode), "/Evil/Engine/Pedal2": pedal(0, true) };
}

describe("Expression pedal mode UI", () => {
  afterEach(cleanup);

  it("shows only controls and assignment lanes supported by the active mode", () => {
    useAppStore.setState({ liveSubtree: tree(0), liveSnapshot: null });
    const { container } = render(<ExpressionAssignmentsPanel/>);

    expect(screen.getByText("Pedal A/B behaviour")).toBeInTheDocument();
    expect(screen.queryByText("Auto-Engage behaviour")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".expression-assignment-list > section")).toHaveLength(1);

    act(() => useAppStore.setState({ liveSubtree: tree(1) }));
    expect(screen.getByText("Pedal A/B behaviour")).toBeInTheDocument();
    expect(screen.queryByText("Auto-Engage behaviour")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".expression-assignment-list > section")).toHaveLength(4);

    act(() => useAppStore.setState({ liveSubtree: tree(2) }));
    expect(screen.queryByText("Pedal A/B behaviour")).not.toBeInTheDocument();
    expect(screen.getByText("Auto-Engage behaviour")).toBeInTheDocument();
    expect(container.querySelectorAll(".expression-assignment-list > section")).toHaveLength(1);
  });
});
