import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoRigs, demoSetlists } from "../data/demo-data";
import {
  AuditionRigNameConflictError,
  useAppStore,
  type AuditionRigSaveOptions,
  type AuditionRigSaveResult,
} from "../stores/app-store";
import { nextAvailableHeadRushRigName, TonePilotSaveRigDialog } from "./tonepilot-save-rig-dialog";

const saveResult: AuditionRigSaveResult = { rigId: "saved-rig", name: "Saved rig" };
const saveAuditionRig = vi.fn<(options: AuditionRigSaveOptions) => Promise<AuditionRigSaveResult>>();

function reflectedSaveDefaults(programs: number[] | null = [3]) {
  return {
    "/Evil/API/Rigs": {
      value: {
        loadedColor: 7,
        loadedProgMIDICC: 7,
        ...(programs ? { availableProgMIDICC: programs } : {}),
      },
      meta: { properties: {} },
    },
    "/Evil/Engine/Patch/Rig": {
      value: { Tempo: 0.5, TempoFromMaster: false },
      meta: { properties: { Tempo: { type: "number", minimum: 30, maximum: 240 } } },
    },
  };
}

describe("TonePilotSaveRigDialog", () => {
  beforeEach(() => {
    saveAuditionRig.mockReset().mockResolvedValue(saveResult);
    useAppStore.setState({
      rigs: structuredClone(demoRigs),
      setlists: structuredClone(demoSetlists),
      liveSnapshot: null,
      liveSubtree: reflectedSaveDefaults(),
      saveAuditionRig,
    } as never);
  });

  it("starts with unique tone naming and reflected HeadRush defaults", async () => {
    render(<TonePilotSaveRigDialog open onClose={vi.fn()} toneTitle="QA Lead"/>);
    const dialog = screen.getByRole("dialog", { name: "Save audition to Rigs" });

    await waitFor(() => expect(within(dialog).getByLabelText("Rig name")).toHaveValue("QA Lead"));
    expect(within(dialog).getByRole("radio", { name: "Violet" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: /Fixed/ })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("Rig tempo")).toHaveValue(135);
    expect(within(dialog).getByLabelText("MIDI Program Change")).toHaveValue("7");
    expect(within(dialog).getByRole("option", { name: /Program 8.*Current/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: demoSetlists[0].name })).toBeInTheDocument();
  });

  it("limits HeadRush rig names to 200 characters", async () => {
    render(<TonePilotSaveRigDialog open onClose={vi.fn()} toneTitle={"A".repeat(240)}/>);
    const name = within(screen.getByRole("dialog", { name: "Save audition to Rigs" })).getByLabelText("Rig name");

    await waitFor(() => expect(name).toHaveValue("A".repeat(200)));
    expect(name).toHaveAttribute("maxlength", "200");
    expect((name as HTMLInputElement).maxLength).toBe(200);
  });

  it("uses arrow keys to select colour and tempo radios with one tab stop per group", async () => {
    render(<TonePilotSaveRigDialog open onClose={vi.fn()} toneTitle="Keyboard rig"/>);
    const dialog = screen.getByRole("dialog", { name: "Save audition to Rigs" });
    await waitFor(() => expect(within(dialog).getByLabelText("Rig name")).toHaveValue("Keyboard rig"));

    const colourGroup = within(dialog).getByRole("radiogroup", { name: "Rig colour" });
    const violet = within(colourGroup).getByRole("radio", { name: "Violet" });
    const blue = within(colourGroup).getByRole("radio", { name: "Blue" });
    expect(violet).toHaveAttribute("aria-checked", "true");
    expect(violet).toHaveAttribute("tabindex", "0");
    expect(blue).toHaveAttribute("tabindex", "-1");

    violet.focus();
    fireEvent.keyDown(violet, { key: "ArrowRight" });

    expect(blue).toHaveFocus();
    expect(blue).toHaveAttribute("aria-checked", "true");
    expect(blue).toHaveAttribute("tabindex", "0");
    expect(violet).toHaveAttribute("aria-checked", "false");
    expect(violet).toHaveAttribute("tabindex", "-1");
    expect(within(colourGroup).getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toHaveLength(1);

    const tempoGroup = within(dialog).getByRole("radiogroup", { name: "Tempo source" });
    const fixed = within(tempoGroup).getByRole("radio", { name: /^Fixed/ });
    const deviceTempo = within(tempoGroup).getByRole("radio", { name: /^Device tempo/ });
    expect(fixed).toHaveAttribute("aria-checked", "true");
    expect(fixed).toHaveAttribute("tabindex", "0");
    expect(deviceTempo).toHaveAttribute("tabindex", "-1");

    fixed.focus();
    fireEvent.keyDown(fixed, { key: "ArrowLeft" });

    expect(deviceTempo).toHaveFocus();
    expect(deviceTempo).toHaveAttribute("aria-checked", "true");
    expect(deviceTempo).toHaveAttribute("tabindex", "0");
    expect(fixed).toHaveAttribute("aria-checked", "false");
    expect(fixed).toHaveAttribute("tabindex", "-1");
    expect(within(tempoGroup).getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
  });

  it("requires explicit confirmation before replacing a duplicate and submits every selected option", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<TonePilotSaveRigDialog open onClose={onClose} onSaved={onSaved} toneTitle="Fresh tone"/>);
    const dialog = screen.getByRole("dialog", { name: "Save audition to Rigs" });
    const name = within(dialog).getByLabelText("Rig name");

    fireEvent.change(name, { target: { value: `  ${demoRigs[0].name}  ` } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("already exists");
    expect(within(dialog).getByRole("button", { name: "Replace existing rig" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /replace the existing rig/i }));
    fireEvent.change(within(dialog).getByLabelText(/Add to setlist/i), { target: { value: demoSetlists[1].id } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Orange" }));
    fireEvent.change(within(dialog).getByLabelText("Rig tempo"), { target: { value: "148.5" } });
    fireEvent.change(within(dialog).getByLabelText("MIDI Program Change"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace existing rig" }));

    await waitFor(() => expect(saveAuditionRig).toHaveBeenCalledWith({
      name: demoRigs[0].name,
      setlistId: demoSetlists[1].id,
      color: 4,
      tempoMode: "fixed",
      tempoBpm: 148.5,
      programChange: 3,
      overwrite: true,
    }));
    expect(onSaved).toHaveBeenCalledWith(saveResult);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides unsupported Program Change controls and keeps a failed save open", async () => {
    saveAuditionRig.mockRejectedValueOnce(new Error("HeadRush is busy"));
    useAppStore.setState({ liveSubtree: reflectedSaveDefaults(null) } as never);
    const onClose = vi.fn();
    render(<TonePilotSaveRigDialog open onClose={onClose} toneTitle="Unique ambience"/>);
    const dialog = screen.getByRole("dialog", { name: "Save audition to Rigs" });

    await waitFor(() => expect(within(dialog).getByLabelText("Rig name")).toHaveValue("Unique ambience"));
    expect(within(dialog).queryByLabelText("MIDI Program Change")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to Rigs" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("HeadRush is busy");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks for replacement confirmation when the device reports a rig missing from the local library", async () => {
    saveAuditionRig
      .mockRejectedValueOnce(new AuditionRigNameConflictError("Device-only rig"))
      .mockResolvedValueOnce(saveResult);
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<TonePilotSaveRigDialog open onClose={onClose} onSaved={onSaved} toneTitle="Device-only rig"/>);
    const dialog = screen.getByRole("dialog", { name: "Save audition to Rigs" });

    await waitFor(() => expect(within(dialog).getByLabelText("Rig name")).toHaveValue("Device-only rig"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to Rigs" }));

    const conflict = await within(dialog).findByRole("alert");
    expect(conflict).toHaveTextContent("Device-only rig");
    expect(conflict).toHaveTextContent("already exists");
    expect(within(dialog).getByRole("button", { name: "Replace existing rig" })).toBeDisabled();
    expect(saveAuditionRig).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ overwrite: true }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /replace the existing rig/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace existing rig" }));

    await waitFor(() => expect(saveAuditionRig).toHaveBeenCalledTimes(2));
    expect(saveAuditionRig).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: "Device-only rig",
      overwrite: true,
    }));
    expect(onSaved).toHaveBeenCalledWith(saveResult);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("generates a sanitized, case-insensitively unique default name", () => {
    expect(nextAvailableHeadRushRigName("Lead/One", ["LeadOne", "leadone 2"])).toBe("LeadOne 3");
  });
});
