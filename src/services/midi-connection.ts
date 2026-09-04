import { useSyncExternalStore } from "react";
import { parseBleMidiPacket, parseStageMidiMessage, type StageMidiMessage } from "../domain/stage-midi";

const BLE_MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const BLE_MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";
const STORAGE_ENABLED = "rushlink-stagehand-midi-enabled";
const STORAGE_INPUT = "rushlink-stagehand-midi-input";

interface BleMidiCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BleMidiCharacteristic>;
}

interface BleMidiDevice {
  id: string;
  name?: string;
  gatt?: {
    connect(): Promise<{
      getPrimaryService(service: string): Promise<{
        getCharacteristic(characteristic: string): Promise<BleMidiCharacteristic>;
      }>;
    }>;
    disconnect?(): void;
  };
}

export interface MidiConnectionSnapshot {
  inputs: MIDIInput[];
  inputId: string;
  bleDeviceName: string;
  enabled: boolean;
  connecting: boolean;
  ready: boolean;
  status: string;
}

type StateListener = () => void;
type MessageListener = (message: StageMidiMessage, source: string) => void;

class MidiConnectionService {
  private access: MIDIAccess | null = null;
  private bleCharacteristic: BleMidiCharacteristic | null = null;
  private bleDevice: BleMidiDevice | null = null;
  private stateListeners = new Set<StateListener>();
  private messageListeners = new Set<MessageListener>();
  private snapshot: MidiConnectionSnapshot = {
    inputs: [],
    inputId: localStorage.getItem(STORAGE_INPUT) ?? "all",
    bleDeviceName: "",
    enabled: localStorage.getItem(STORAGE_ENABLED) === "true",
    connecting: false,
    ready: false,
    status: "Not connected",
  };

  subscribe = (listener: StateListener) => { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); }; };
  subscribeMessages = (listener: MessageListener) => { this.messageListeners.add(listener); return () => { this.messageListeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(patch: Partial<MidiConnectionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.stateListeners.forEach((listener) => listener());
  }

  private emit(message: StageMidiMessage, source: string) {
    this.messageListeners.forEach((listener) => listener(message, source));
  }

  private bindInputs() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = this.snapshot.inputId === "all" || input.id === this.snapshot.inputId
      ? (event) => { const message = event.data && parseStageMidiMessage(event.data); if (message) this.emit(message, `midi:${input.id}`); }
      : null;
  }

  private refreshPorts() {
    if (!this.access) return;
    const inputs = [...this.access.inputs.values()];
    const inputId = this.snapshot.inputId !== "all" && !inputs.some((input) => input.id === this.snapshot.inputId) ? "all" : this.snapshot.inputId;
    localStorage.setItem(STORAGE_INPUT, inputId);
    this.update({ inputs, inputId, ready: Boolean(inputs.length || this.bleCharacteristic), status: `${inputs.length} MIDI input${inputs.length === 1 ? "" : "s"}` });
    this.bindInputs();
  }

  connect = async () => {
    if (!navigator.requestMIDIAccess) { this.update({ status: "Web MIDI is unavailable on this platform", connecting: false }); return null; }
    this.update({ connecting: true, status: "Looking for MIDI controllers…" });
    try {
      const access = this.access ?? await navigator.requestMIDIAccess();
      this.access = access;
      access.onstatechange = () => this.refreshPorts();
      localStorage.setItem(STORAGE_ENABLED, "true");
      this.update({ enabled: true, connecting: false });
      this.refreshPorts();
      return access;
    } catch (error) {
      this.update({ connecting: false, ready: Boolean(this.bleCharacteristic), status: `MIDI connection failed · ${String(error)}` });
      return null;
    }
  };

  autoConnect = () => this.snapshot.enabled ? this.connect() : Promise.resolve(null);

  selectInput = (inputId: string) => {
    localStorage.setItem(STORAGE_INPUT, inputId);
    this.update({ inputId });
    this.bindInputs();
  };

  connectBluetooth = async () => {
    const bluetooth = (navigator as Navigator & { bluetooth?: { requestDevice(options: unknown): Promise<BleMidiDevice> } }).bluetooth;
    if (!bluetooth) { this.update({ status: "Bluetooth MIDI is unavailable on this platform" }); return false; }
    this.update({ connecting: true, status: "Choose a Bluetooth MIDI controller…" });
    try {
      const device = await bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }], optionalServices: [BLE_MIDI_SERVICE] });
      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService(BLE_MIDI_SERVICE);
      const characteristic = await service?.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
      if (!characteristic) throw new Error("BLE-MIDI characteristic not found");
      await characteristic.startNotifications();
      this.bleDevice = device; this.bleCharacteristic = characteristic;
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const value = (event.target as BleMidiCharacteristic).value;
        if (!value) return;
        for (const message of parseBleMidiPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))) this.emit(message, "ble");
      });
      localStorage.setItem(STORAGE_ENABLED, "true");
      this.update({ bleDeviceName: device.name || "Bluetooth MIDI", enabled: true, connecting: false, ready: true, status: `Bluetooth controller connected · ${device.name || device.id}` });
      return true;
    } catch (error) {
      this.update({ connecting: false, status: `Bluetooth MIDI failed · ${String(error)}` });
      return false;
    }
  };

  disconnect = () => {
    if (this.access) for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.access = null;
    this.bleDevice?.gatt?.disconnect?.();
    this.bleDevice = null; this.bleCharacteristic = null;
    localStorage.setItem(STORAGE_ENABLED, "false");
    this.update({ inputs: [], bleDeviceName: "", enabled: false, connecting: false, ready: false, status: "Disconnected" });
  };
}

export const midiConnection = new MidiConnectionService();

export function useMidiConnection() {
  return useSyncExternalStore(midiConnection.subscribe, midiConnection.getSnapshot, midiConnection.getSnapshot);
}
