import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parameterDeviceValue, parametersForObject } from "../domain/headrush-reflection";
import type { HeadRushObject } from "../domain/types";
import { testRigTemplates } from "../data/demo-data";
import { TestRigParameterEditor } from "./tonemod-test-rigs";

afterEach(cleanup);

describe("Test Rig reflected selection controls", () => {
  it.each([
    ["Cabinet", ["Angel 412 Slant", "Michael Bluesmaker 212 Open Back"], 0, 1],
    ["Microphone", ["414B (Card)", "414B (Omni)"], 0, 1],
    ["Amp model", ["Clean", "Lead"], 0, 1],
    ["Delay sync", ["Off", "On"], false, true],
    ["NAM quality", ["Standard", "High"], 0, 1],
    ["Reverb type", ["Room", "Hall"], 0, 1],
  ] as const)("keeps %s selection mapped to the correct device value", (label, options, initial, expected) => {
    const object = {
      value: { Mode: initial, order: ["Mode"], labels: [label] },
      meta: { properties: { Mode: { type: typeof initial === "boolean" ? "boolean" : "integer", "x-options": { strings: [...options] } } } },
    } as HeadRushObject;
    const parameters = parametersForObject(object);
    const before = structuredClone(parameters);
    const change = vi.fn();
    render(<TestRigParameterEditor parameters={parameters} onChange={change}/>);
    const control = screen.getByRole("combobox", { name: label });
    expect(control).toHaveClass("ui-select");
    expect(control).toHaveValue(options[0]);
    fireEvent.change(control, { target: { value: options[1] } });
    expect(change).toHaveBeenCalledExactlyOnceWith("Mode", options[1]);
    expect(parameterDeviceValue(parameters[0], change.mock.calls[0][1])).toBe(expected);
    expect(parameters).toEqual(before);
  });

  it("distinguishes dual-cab controls without changing reflected property IDs", () => {
    const parameters = [
      { id: "CabType", label: "CabType", value: "Cab A", choices: ["Cab A", "Cab B"] },
      { id: "CabType2", label: "CabType", value: "Cab A", choices: ["Cab A", "Cab B"] },
      { id: "MicType", label: "MicType", value: "Mic A", choices: ["Mic A", "Mic B"] },
      { id: "MicType2", label: "MicType", value: "Mic A", choices: ["Mic A", "Mic B"] },
    ];
    const change = vi.fn();
    render(<TestRigParameterEditor parameters={parameters} onChange={change}/>);
    expect(screen.getByRole("combobox", { name: "Cabinet 1" })).toHaveValue("Cab A");
    fireEvent.change(screen.getByRole("combobox", { name: "Cabinet 2" }), { target: { value: "Cab B" } });
    expect(change).toHaveBeenLastCalledWith("CabType2", "Cab B");
    fireEvent.change(screen.getByRole("combobox", { name: "Microphone 2" }), { target: { value: "Mic B" } });
    expect(change).toHaveBeenLastCalledWith("MicType2", "Mic B");
    expect(parameters[1].label).toBe("CabType");
  });

  it.each(testRigTemplates.map((rig) => [rig.name, rig] as const))("renders all %s template block controls without unstyled selects", (_name, rig) => {
    for (const block of rig.blocks) {
      const { container, unmount } = render(<TestRigParameterEditor parameters={block.parameters} onChange={vi.fn()}/>);
      for (const control of container.querySelectorAll("select")) {
        expect(control).toHaveClass("ui-select");
        expect(control).toHaveAccessibleName();
      }
      unmount();
    }
  });
});
