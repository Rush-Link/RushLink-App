import { flexPrimeMidiCommand } from "./headrush-midi";
import { normalizeLiveDeckActions } from "./live-layout";
import type { LiveButton, LiveGesture, MidiCommand } from "./types";

export interface StageMidiMessage {
  type: MidiCommand["type"];
  channel: number;
  number: number;
  value: number;
  released: boolean;
}

export interface StageMidiMatch {
  button: LiveButton;
  target?: string;
  gesture: LiveGesture;
}

export function parseStageMidiMessage(data: ArrayLike<number>): StageMidiMessage | null {
  if (!data.length) return null;
  const status = Number(data[0]);
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const number = Number(data[1] ?? 0) & 0x7f;
  const value = Number(data[2] ?? (kind === 0xc0 ? 127 : 0)) & 0x7f;
  if (kind === 0x80) return { type: "note", channel, number, value, released: true };
  if (kind === 0x90) return { type: "note", channel, number, value, released: value === 0 };
  if (kind === 0xb0) return { type: "cc", channel, number, value, released: value === 0 };
  if (kind === 0xc0) return { type: "pc", channel, number, value: 0, released: false };
  return null;
}

export function midiMessageMatches(message: StageMidiMessage, command: MidiCommand) {
  return message.type === command.type && message.channel === command.channel && message.number === command.number;
}

function gestureFor(button: LiveButton, message: StageMidiMessage, target?: string): LiveGesture | null {
  const momentary = button.switchType === "momentary" || target === "accent";
  if (message.released) return momentary ? "release" : null;
  if (momentary) return "press";
  if (button.switchType === "hold") return "hold";
  return "release";
}

export function findStageMidiMatch(buttons: Array<LiveButton | null>, message: StageMidiMessage): StageMidiMatch | null {
  for (const button of buttons) {
    if (!button || (button.widget !== "looper" && button.widget !== "drums")) continue;
    const kind = button.widget;
    const actions = normalizeLiveDeckActions(kind, button.widgetLayout ?? "2x2", button.widgetActions);
    const target = actions.find((action) => midiMessageMatches(message, { ...flexPrimeMidiCommand(kind, action), channel: button.midi.channel }));
    if (!target) continue;
    const gesture = gestureFor(button, message, target);
    if (gesture) return { button, target, gesture };
  }
  for (const button of buttons) {
    if (!button || !midiMessageMatches(message, button.midi)) continue;
    const gesture = gestureFor(button, message, button.target);
    if (gesture) return { button, target: button.target, gesture };
  }
  return null;
}

// BLE-MIDI packets contain a timestamp header followed by one or more ordinary
// MIDI messages. Running status is supported because compact controllers use it.
export function parseBleMidiPacket(data: ArrayLike<number>): StageMidiMessage[] {
  const bytes = Array.from(data, Number);
  if (bytes.length < 3 || (bytes[0] & 0x80) === 0) return [];
  const messages: StageMidiMessage[] = [];
  let index = 1;
  let runningStatus = 0;
  while (index < bytes.length) {
    if ((bytes[index] & 0x80) !== 0) index++; // timestamp-low byte
    if (index >= bytes.length) break;
    let status = runningStatus;
    if ((bytes[index] & 0x80) !== 0) { status = bytes[index++]; runningStatus = status; }
    if (!status) break;
    const kind = status & 0xf0;
    const dataLength = kind === 0xc0 || kind === 0xd0 ? 1 : kind >= 0x80 && kind <= 0xe0 ? 2 : 0;
    if (!dataLength || index + dataLength > bytes.length) break;
    const raw = [status, ...bytes.slice(index, index + dataLength)];
    index += dataLength;
    const parsed = parseStageMidiMessage(raw);
    if (parsed) messages.push(parsed);
  }
  return messages;
}
