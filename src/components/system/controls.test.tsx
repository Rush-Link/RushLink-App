import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Parameter } from "../../domain/types";
import { CloudStatus, CpuIndicator, DeviceBadge, NetworkStatus, ParameterControl, SignalMeter, ValueKnob } from "./controls";
import { demoDevice } from "../../data/demo-data";

afterEach(cleanup);

function choiceParameter(choices: string[], value = choices[0]): Parameter {
  return { id: "Mode", label: "Performance mode", value, rawValue: value, choices };
}

describe("adaptive reflected choices", () => {
  it("renders short musical choices as direct buttons", () => {
    const onChange = vi.fn();
    render(<ParameterControl parameter={choiceParameter(["Bridge", "Fill", "Fill Hold"])} choiceStyle="adaptive" onChange={onChange}/>);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fill Hold" }));
    expect(onChange).toHaveBeenCalledWith("Fill Hold");
  });

  it("renders long lists as wrapping previous and next steppers", () => {
    const choices = Array.from({ length: 15 }, (_, index) => String(index + 2));
    const onChange = vi.fn();
    const { rerender } = render(<ParameterControl parameter={choiceParameter(choices, "16")} choiceStyle="adaptive" onChange={onChange}/>);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next Performance mode" }));
    expect(onChange).toHaveBeenLastCalledWith("2");

    rerender(<ParameterControl parameter={choiceParameter(choices, "2")} choiceStyle="adaptive" onChange={onChange}/>);
    fireEvent.click(screen.getByRole("button", { name: "Previous Performance mode" }));
    expect(onChange).toHaveBeenLastCalledWith("16");
  });
});

describe("shared device controls", () => {
  it("supports precise range input, pointer movement and midpoint reset on a knob", () => {
    const onChange = vi.fn();
    render(<ValueKnob label="Gain" value={40} min={0} max={100} unit="%" onChange={onChange}/>);
    fireEvent.change(screen.getByRole("slider", { name: "Gain slider" }), { target: { value: "65" } });
    expect(onChange).toHaveBeenLastCalledWith(65);

    const dial = screen.getByRole("button", { name: "Gain 40%" });
    fireEvent.doubleClick(dial);
    expect(onChange).toHaveBeenLastCalledWith(50);
    fireEvent(dial, new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }));
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 64 }));
    expect(onChange).toHaveBeenLastCalledWith(60);
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
  });

  it("renders and edits boolean, select, numeric and text parameters", () => {
    const change = vi.fn();
    const { rerender } = render(<ParameterControl parameter={{ id: "On", label: "Enabled", value: false }} onChange={change}/>);
    fireEvent.click(screen.getByRole("switch"));
    expect(change).toHaveBeenLastCalledWith(true);

    rerender(<ParameterControl parameter={{ id: "Mode", label: "Mode", value: "A", choices: ["A", "B"] }} onChange={change}/>);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "B" } });
    expect(change).toHaveBeenLastCalledWith("B");

    rerender(<ParameterControl compact parameter={{ id: "Mix", label: "Mix", value: 25, min: 0, max: 100, step: 1, unit: "%" }} onChange={change}/>);
    fireEvent.change(screen.getByRole("slider", { name: "Mix" }), { target: { value: "80" } });
    expect(change).toHaveBeenLastCalledWith(80);

    rerender(<ParameterControl parameter={{ id: "Name", label: "Name", value: "Clean" }} onChange={change}/>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Lead" } });
    expect(change).toHaveBeenLastCalledWith("Lead");
  });

  it("communicates connected, offline, network, cloud, CPU and signal states accessibly", () => {
    const { rerender } = render(<><DeviceBadge device={demoDevice}/><NetworkStatus online/><CloudStatus online/><CpuIndicator value={37}/><SignalMeter value={.5}/></>);
    expect(screen.getByText(demoDevice.name)).toBeInTheDocument();
    expect(screen.getByText("DEMO")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Services available")).toBeInTheDocument();
    expect(screen.getByText("37% CPU")).toBeInTheDocument();
    expect(screen.getByLabelText("Signal 50%")).toBeInTheDocument();

    rerender(<><DeviceBadge device={null}/><NetworkStatus online={false} label="Pedal unreachable"/><CloudStatus online={false}/></>);
    expect(screen.getByText("Connect HeadRush")).toBeInTheDocument();
    expect(screen.getByText("Pedal unreachable")).toBeInTheDocument();
    expect(screen.getByText("Cloud unavailable")).toBeInTheDocument();
  });
});
