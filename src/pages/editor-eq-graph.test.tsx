import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Parameter } from "../domain/types";
import { equalizerXForFrequency, equalizerYForGain } from "../domain/equalizer";
import { EqGraph } from "./editor";

const numeric = (id: string, label: string, value: number, min: number, max: number, unit?: string, step?: number): Parameter => ({
  id, label, value, min, max, unit, step, writable: true,
});

const parameters = (): Parameter[] => [
  { id: "SltEQOn", label: "Block EQ", value: true, writable: true },
  numeric("SltEQF", "Frequency", 1_000, 20, 20_000, "Hz", 1),
  numeric("SltEQG", "Gain", 0, -18, 18, "dB", 0.1),
  numeric("SltEQQ", "Q", 1, 0.1, 10, undefined, 0.1),
  numeric("SltEQHP", "High-pass", 100, 20, 20_000, "Hz", 1),
  numeric("SltEQLP", "Low-pass", 5_000, 20, 20_000, "Hz", 1),
];

function preparePointerTarget(target: Element, svg: SVGSVGElement) {
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 220, width: 800, height: 220, toJSON: () => ({}),
  });
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", target: Element, x: number, y: number, pointerId = 7) {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y },
  });
  fireEvent(target, event);
}

describe("interactive block EQ graph", () => {
  it("drags a parametric node without jumping and commits frequency and gain on release", () => {
    const change = vi.fn();
    const { container } = render(<EqGraph parameters={parameters()} onParameterChange={change}/>);
    const svg = screen.getByLabelText("Interactive block equalizer") as unknown as SVGSVGElement;
    const hit = container.querySelector<SVGCircleElement>(".eq-band-hit")!;
    preparePointerTarget(hit, svg);

    pointer("pointerDown", hit, equalizerXForFrequency(1_000), equalizerYForGain(0, 18));
    pointer("pointerMove", hit, equalizerXForFrequency(2_000), equalizerYForGain(6, 18));
    expect(container.querySelector(".graphic-eq")).toHaveClass("graphic-eq--dragging");
    pointer("pointerUp", hit, equalizerXForFrequency(2_000), equalizerYForGain(6, 18));

    const committed = Object.fromEntries(change.mock.calls.map(([parameter, value]) => [parameter.id, value]));
    expect(committed.SltEQF).toBeCloseTo(2_000, -1);
    expect(committed.SltEQG).toBeCloseTo(6, 1);
    expect(container.querySelector(".graphic-eq")).not.toHaveClass("graphic-eq--dragging");
  });

  it("throttles intermediate pointer updates but publishes the newest position", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    const { container } = render(<EqGraph parameters={parameters()} onParameterChange={change}/>);
    const svg = screen.getByLabelText("Interactive block equalizer") as unknown as SVGSVGElement;
    const hit = container.querySelector<SVGCircleElement>(".eq-band-hit")!;
    preparePointerTarget(hit, svg);

    pointer("pointerDown", hit, equalizerXForFrequency(1_000), equalizerYForGain(0, 18));
    pointer("pointerMove", hit, equalizerXForFrequency(1_500), equalizerYForGain(2, 18));
    pointer("pointerMove", hit, equalizerXForFrequency(3_000), equalizerYForGain(4, 18));
    act(() => vi.advanceTimersByTime(119));
    expect(change).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    const published = Object.fromEntries(change.mock.calls.map(([parameter, value]) => [parameter.id, value]));
    expect(published.SltEQF).toBeCloseTo(3_000, -1);
    expect(published.SltEQG).toBeCloseTo(4, 1);
  });

  it("clamps crossing high-pass and low-pass handles to a valid filter window", () => {
    const change = vi.fn();
    const { container } = render(<EqGraph parameters={parameters()} onParameterChange={change}/>);
    const svg = screen.getByLabelText("Interactive block equalizer") as unknown as SVGSVGElement;
    const cutoffs = [...container.querySelectorAll<SVGRectElement>(".eq-cutoff-hit")];
    const [highPass] = cutoffs;
    preparePointerTarget(highPass, svg);

    pointer("pointerDown", highPass, equalizerXForFrequency(100), 40, 1);
    pointer("pointerUp", highPass, equalizerXForFrequency(20_000), 40, 1);
    expect(change.mock.calls.find(([parameter]) => parameter.id === "SltEQHP")?.[1]).toBe(5_000);

    change.mockClear();
    const lowPass = [...container.querySelectorAll<SVGRectElement>(".eq-cutoff-hit")][1];
    preparePointerTarget(lowPass, svg);
    pointer("pointerDown", lowPass, equalizerXForFrequency(5_000), 40, 2);
    pointer("pointerUp", lowPass, equalizerXForFrequency(20), 40, 2);
    expect(change.mock.calls.find(([parameter]) => parameter.id === "SltEQLP")?.[1]).toBe(5_000);
  });

  it("commits the last valid draft on pointer cancellation and supports keyboard nudging", () => {
    const change = vi.fn();
    const { container } = render(<EqGraph parameters={parameters()} onParameterChange={change}/>);
    const svg = screen.getByLabelText("Interactive block equalizer") as unknown as SVGSVGElement;
    const hit = container.querySelector<SVGCircleElement>(".eq-band-hit")!;
    preparePointerTarget(hit, svg);

    pointer("pointerDown", hit, equalizerXForFrequency(1_000), equalizerYForGain(0, 18));
    pointer("pointerMove", hit, equalizerXForFrequency(1_800), equalizerYForGain(-3, 18));
    pointer("pointerCancel", hit, equalizerXForFrequency(1_800), equalizerYForGain(-3, 18));
    expect(change.mock.calls.some(([parameter]) => parameter.id === "SltEQG")).toBe(true);

    change.mockClear();
    const slider = screen.getByRole("slider", { name: /Block EQ/i });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(change.mock.calls.map(([parameter]) => parameter.id)).toEqual(["SltEQF", "SltEQG"]);
  });
});
