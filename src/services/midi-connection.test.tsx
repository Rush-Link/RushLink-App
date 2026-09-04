import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { midiConnection, useMidiConnection } from "./midi-connection";

type MidiMessageHandler = ((event: { data: Uint8Array }) => void) | null;

function midiAccess() {
  const input = { id: "in-1", name: "Keyboard", manufacturer: "Test", onmidimessage: null as MidiMessageHandler };
  const output = { id: "out-1", name: "Pedal", manufacturer: "Test", send: vi.fn() };
  const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null as (() => void) | null };
  return { access, input, output };
}

function setMidiRequester(value?: () => Promise<unknown>) {
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value });
}

describe("shared MIDI connection service", () => {
  beforeEach(() => {
    midiConnection.disconnect();
    localStorage.clear();
    setMidiRequester(undefined);
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined });
  });

  it("reports unsupported Web MIDI without throwing", async () => {
    await expect(midiConnection.connect()).resolves.toBeNull();
    expect(midiConnection.getSnapshot()).toMatchObject({ ready: false, connecting: false, status: "Web MIDI is unavailable on this platform" });
    await expect(midiConnection.autoConnect()).resolves.toBeNull();
  });

  it("discovers and persists inputs without exposing an outbound transport", async () => {
    const { access, input, output } = midiAccess();
    setMidiRequester(vi.fn().mockResolvedValue(access));
    const listener = vi.fn(); const unsubscribe = midiConnection.subscribeMessages(listener);
    await midiConnection.connect();
    expect(midiConnection.getSnapshot()).toMatchObject({ enabled: true, ready: true, inputId: "all", status: "1 MIDI input" });
    expect(midiConnection.getSnapshot()).not.toHaveProperty("outputs");
    expect(midiConnection.getSnapshot()).not.toHaveProperty("outputId");
    expect(midiConnection).not.toHaveProperty("send");
    expect(localStorage.getItem("rushlink-stagehand-midi-enabled")).toBe("true");
    input.onmidimessage?.({ data: new Uint8Array([0xb0, 69, 127]) });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "cc", number: 69, value: 127 }), "midi:in-1");
    midiConnection.selectInput("in-1");
    expect(localStorage.getItem("rushlink-stagehand-midi-input")).toBe("in-1");
    expect(output.send).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("refreshes changed ports and falls back from removed selections", async () => {
    const first = midiAccess(); setMidiRequester(vi.fn().mockResolvedValue(first.access));
    await midiConnection.connect(); midiConnection.selectInput("in-1");
    first.access.inputs.clear(); first.access.outputs.clear(); first.access.onstatechange?.();
    expect(midiConnection.getSnapshot()).toMatchObject({ inputs: [], inputId: "all", ready: false });
  });

  it("surfaces access failures and disconnects active inputs", async () => {
    setMidiRequester(vi.fn().mockRejectedValue(new Error("permission denied")));
    await midiConnection.connect();
    expect(midiConnection.getSnapshot().status).toContain("permission denied");
    const next = midiAccess(); setMidiRequester(vi.fn().mockResolvedValue(next.access));
    await midiConnection.connect(); expect(next.input.onmidimessage).toBeTypeOf("function");
    midiConnection.disconnect();
    expect(next.input.onmidimessage).toBeNull();
    expect(midiConnection.getSnapshot()).toMatchObject({ enabled: false, status: "Disconnected" });
  });

  it("connects direct BLE MIDI and receives notifications without writing packets", async () => {
    class Characteristic extends EventTarget {
      value?: DataView;
      startNotifications = vi.fn(async () => this);
    }
    const characteristic = new Characteristic(); const disconnect = vi.fn();
    const device = { id: "ble-1", name: "Blue Pedal", gatt: { connect: vi.fn(async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) })), disconnect } };
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice: vi.fn(async () => device) } });
    const listener = vi.fn(); const off = midiConnection.subscribeMessages(listener);
    await expect(midiConnection.connectBluetooth()).resolves.toBe(true);
    expect(midiConnection.getSnapshot()).toMatchObject({ ready: true, bleDeviceName: "Blue Pedal" });
    characteristic.value = new DataView(new Uint8Array([0x80, 0x80, 0xb0, 69, 127]).buffer);
    characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ number: 69 }), "ble");
    expect(characteristic).not.toHaveProperty("writeValueWithoutResponse");
    midiConnection.disconnect(); expect(disconnect).toHaveBeenCalled(); off();
  });

  it("handles unavailable and rejected Bluetooth requests", async () => {
    await expect(midiConnection.connectBluetooth()).resolves.toBe(false);
    expect(midiConnection.getSnapshot().status).toContain("unavailable");
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice: vi.fn().mockRejectedValue(new Error("cancelled")) } });
    await expect(midiConnection.connectBluetooth()).resolves.toBe(false);
    expect(midiConnection.getSnapshot().status).toContain("cancelled");
  });

  it("exposes stable reactive snapshots to components", async () => {
    const View = () => { const midi = useMidiConnection(); return <output>{midi.status}</output>; };
    render(<View/>); expect(screen.getByText("Disconnected")).toBeInTheDocument();
    await act(() => midiConnection.connect());
    expect(screen.getByText("Web MIDI is unavailable on this platform")).toBeInTheDocument();
  });
});
