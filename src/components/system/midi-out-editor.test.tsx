import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadRushObject, HeadRushPropertyMeta } from "../../domain/types";
import { deviceApi } from "../../services/device-api";
import { useAppStore } from "../../stores/app-store";
import { fieldsForMessage, midiField, MidiOutEditor } from "./midi-out-editor";

const typeMeta: HeadRushPropertyMeta = { type: "integer", minimum: 0, maximum: 4, "x-options": { strings: ["None", "Program Change", "Control Change", "Note-On", "Note-Off"] } };
const dataMeta: HeadRushPropertyMeta = { type: "integer", minimum: 0, maximum: 127 };
const bankMeta: HeadRushPropertyMeta = { type: "integer", minimum: -1, maximum: 127 };

function midiObject(): HeadRushObject {
  const properties: Record<string, HeadRushPropertyMeta> = { HasAlt: { type: "boolean" }, LoadedPreset: { type: "string" } };
  const value: Record<string, unknown> = { HasAlt: true, LoadedPreset: "Lead", Type1: 1, Chan1: 2, MSB1: -1, LSB1: -1, Val11: 24, TypeAlt1: 2, ChanAlt1: 3, Val1Alt1: 17, Val2Alt1: 127 };
  for (let lane = 0; lane < 5; lane += 1) {
    for (const alternate of [false, true]) {
      const type = midiField("Type", lane, alternate);
      properties[type] = typeMeta;
      if (value[type] === undefined) value[type] = 0;
      for (const base of ["Chan", "Val1", "Val2", "MSB", "LSB"]) {
        const field = midiField(base, lane, alternate);
        properties[field] = base === "MSB" || base === "LSB" ? bankMeta : dataMeta;
        if (value[field] === undefined) value[field] = base === "Chan" ? 1 : base === "MSB" || base === "LSB" ? -1 : 0;
      }
    }
  }
  return { meta: { properties }, value };
}

describe("MIDI Out settings editor", () => {
  beforeEach(() => {
    vi.spyOn(useAppStore.getState(), "refreshPage").mockResolvedValue();
    vi.spyOn(deviceApi, "callMethod").mockImplementation(async (_path, method) => ({ status: 200, body: { methodReturnValue: method === "presets" ? JSON.stringify(["Lead", "Clean"]) : true } }));
    vi.spyOn(deviceApi, "setProperties").mockResolvedValue({ status: 200, body: true });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("maps primary and alternate firmware fields for each message type", () => {
    expect(fieldsForMessage(0, false, 1)).toEqual(["Type1", "Chan1", "MSB1", "LSB1", "Val11"]);
    expect(fieldsForMessage(0, true, 2)).toEqual(["TypeAlt1", "ChanAlt1", "Val1Alt1", "Val2Alt1"]);
    expect(fieldsForMessage(4, true, 0)).toEqual(["TypeAlt5"]);
  });

  it("renders five lanes and only the controls relevant to the active message", async () => {
    const { container } = render(<MidiOutEditor object={midiObject()}/>);
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(container.querySelector('[data-parameter="Type1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-parameter="MSB1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-parameter="Val21"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Alternate$/i }));
    expect(container.querySelector('[data-parameter="TypeAlt1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-parameter="Val2Alt1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-parameter="MSBAlt1"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Message 2/i }));
    expect(container.querySelector('[data-parameter="TypeAlt2"]')).toBeInTheDocument();
    expect(container.querySelector('[data-parameter="ChanAlt2"]')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "MIDI Out preset" })).toHaveTextContent("Clean"));
  });

  it("tests messages, creates presets and updates the real alternate-state property", async () => {
    render(<MidiOutEditor object={midiObject()}/>);
    fireEvent.click(screen.getByRole("button", { name: /Test on pedal/i }));
    await waitFor(() => expect(deviceApi.callMethod).toHaveBeenCalledWith("/Evil/Engine/MIDIOutCtrl", "test", []));

    fireEvent.click(screen.getByRole("button", { name: /Save as preset/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /New preset name/i }), { target: { value: "Arena changes" } });
    fireEvent.click(screen.getByRole("button", { name: /Create preset/i }));
    await waitFor(() => expect(deviceApi.callMethod).toHaveBeenCalledWith("/Evil/Engine/MIDIOutCtrl", "createPreset", ["Arena changes"]));

    fireEvent.click(screen.getByRole("switch", { name: /Enable alternate MIDI state/i }));
    await waitFor(() => expect(deviceApi.setProperties).toHaveBeenCalledWith("/Evil/Engine/MIDIOutCtrl", { HasAlt: false }));
  });
});
