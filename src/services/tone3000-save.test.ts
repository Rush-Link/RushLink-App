import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi, TONE3000_DEVICE_FOLDER } from "./device-api";
import { NAM_DEVICE_ROOT, NAM_USER_FOLDER } from "./nam-transfer";
import { prepareNamFolderSave, saveTone3000Source, Tone3000ModelNameConflictError } from "./tone3000-save";

const tone: CloudTone = {
  id: "tone-1", title: "Amp collection", author: "Artist", description: "", captureType: "amp", detectedType: "amp",
  tags: [], rating: 0, downloads: 0, source: "Tone3000", imageColor: "#000", remoteId: 1,
};
const model: ToneModel = { id: "model-2", remoteId: 2, name: "Provider capture", architecture: "A2", url: "https://models.test/capture.nam" };

describe("saving a Tone3000 source to HeadRush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(deviceApi, "isNative").mockReturnValue(true);
    vi.spyOn(deviceApi, "listDeviceFiles").mockResolvedValue([]);
    vi.spyOn(deviceApi, "downloadTone").mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("downloads the named source and verifies the exact permanent filename", async () => {
    vi.mocked(deviceApi.listDeviceFiles).mockResolvedValueOnce([]).mockResolvedValueOnce([`${TONE3000_DEVICE_FOLDER}/My Clean.NAM`]);

    await expect(saveTone3000Source(tone, model, '  My Clean?.nam  ')).resolves.toEqual({
      name: "My Clean", path: `${TONE3000_DEVICE_FOLDER}/My Clean.NAM`,
    });
    expect(deviceApi.downloadTone).toHaveBeenCalledWith(tone, model, "My Clean");
    expect(deviceApi.listDeviceFiles).toHaveBeenNthCalledWith(1, TONE3000_DEVICE_FOLDER, "nam");
    expect(deviceApi.listDeviceFiles).toHaveBeenNthCalledWith(2, TONE3000_DEVICE_FOLDER, "nam");
  });

  it.each(["", "  ", "<>?", ".nam", "..."])("rejects unusable names before reading or writing: %j", async (name) => {
    await expect(saveTone3000Source(tone, model, name)).rejects.toThrow("Enter a name");
    expect(deviceApi.listDeviceFiles).not.toHaveBeenCalled();
    expect(deviceApi.downloadTone).not.toHaveBeenCalled();
  });

  it("rejects browser preview saves", async () => {
    vi.mocked(deviceApi.isNative).mockReturnValue(false);
    await expect(saveTone3000Source(tone, model, "Clean")).rejects.toThrow("desktop app");
    expect(deviceApi.listDeviceFiles).not.toHaveBeenCalled();
    expect(deviceApi.downloadTone).not.toHaveBeenCalled();
  });

  it("rejects a different provider before requesting a download", async () => {
    await expect(saveTone3000Source({ ...tone, source: "HeadRush Cloud" }, model, "Clean")).rejects.toThrow("Tone3000 NAM model");
    expect(deviceApi.listDeviceFiles).not.toHaveBeenCalled();
    expect(deviceApi.downloadTone).not.toHaveBeenCalled();
  });

  it.each(["cLeAn.NAM", `${TONE3000_DEVICE_FOLDER}/CLEAN.nam`, "Neural Amp Modeler\\Tone 3000\\clean.nam"])("prevents a case-insensitive existing filename from being overwritten: %s", async (existing) => {
    vi.mocked(deviceApi.listDeviceFiles).mockResolvedValue([existing]);
    const saved = saveTone3000Source(tone, model, "Clean");
    await expect(saved).rejects.toBeInstanceOf(Tone3000ModelNameConflictError);
    await expect(saved).rejects.toMatchObject({
      name: "Tone3000ModelNameConflictError", modelName: "Clean", path: `${TONE3000_DEVICE_FOLDER}/Clean.nam`,
    });
    expect(deviceApi.downloadTone).not.toHaveBeenCalled();
  });

  it("stops if the duplicate preflight cannot read the device", async () => {
    const error = new Error("Device disconnected");
    vi.mocked(deviceApi.listDeviceFiles).mockRejectedValue(error);
    await expect(saveTone3000Source(tone, model, "Clean")).rejects.toBe(error);
    expect(deviceApi.downloadTone).not.toHaveBeenCalled();
  });

  it("propagates download rejection without claiming success or polling", async () => {
    const error = new Error("Provider download failed");
    vi.mocked(deviceApi.downloadTone).mockRejectedValue(error);
    await expect(saveTone3000Source(tone, model, "Clean")).rejects.toBe(error);
    expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(1);
  });

  it("retries delayed directory updates and temporary read failures", async () => {
    vi.mocked(deviceApi.listDeviceFiles)
      .mockResolvedValueOnce(["Other.nam"])
      .mockResolvedValueOnce(["Clean.nam.nam"])
      .mockRejectedValueOnce(new Error("Device busy"))
      .mockResolvedValueOnce(["Clean.nam"]);
    const saved = expect(saveTone3000Source(tone, model, "Clean")).resolves.toEqual({ name: "Clean", path: `${TONE3000_DEVICE_FOLDER}/Clean.nam` });
    await vi.runAllTimersAsync();
    await saved;
    expect(deviceApi.downloadTone).toHaveBeenCalledTimes(1);
    expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(4);
  });

  it("reports an unverified download after bounded retries without accepting similar filenames", async () => {
    vi.mocked(deviceApi.listDeviceFiles).mockResolvedValue(["Clean.nam.nam", "Clean 2.nam", "Other Clean.nam"]);
    const saved = expect(saveTone3000Source(tone, model, "Clean")).rejects.toThrow(/download.*was requested.*could not confirm.*Check that folder/i);
    await vi.runAllTimersAsync();
    await saved;
    expect(deviceApi.downloadTone).toHaveBeenCalledTimes(1);
    expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(5);
  });

  it("reports uncertainty when directory reads fail after the requested download", async () => {
    const error = new Error("Device disconnected");
    vi.mocked(deviceApi.listDeviceFiles).mockResolvedValueOnce([]).mockRejectedValue(error);
    const saved = expect(saveTone3000Source(tone, model, "Clean")).rejects.toMatchObject({ message: expect.stringContaining("could not confirm"), cause: error });
    await vi.runAllTimersAsync();
    await saved;
    expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(5);
  });

  describe("preparing the selected NAM destination", () => {
    function simulateFolders(initial: Record<string, string[]> = {}) {
      const folders = new Map(Object.entries(initial));
      vi.mocked(deviceApi.listDeviceFiles).mockImplementation(async (folder = "") => [...(folders.get(folder) ?? [])]);
      vi.mocked(deviceApi.downloadTone).mockImplementation(async (_tone, _model, name = "") => {
        folders.set(TONE3000_DEVICE_FOLDER, [...(folders.get(TONE3000_DEVICE_FOLDER) ?? []), `${name}.nam`]);
      });
      return folders;
    }

    it("defaults to User and distinguishes the staged file from the requested destination", async () => {
      const folders = simulateFolders();
      await expect(prepareNamFolderSave(tone, model, "My Clean.nam")).resolves.toEqual({
        name: "My Clean",
        path: `${NAM_USER_FOLDER}/My Clean.nam`,
        sourcePath: `${TONE3000_DEVICE_FOLDER}/My Clean.nam`,
        requiresTransfer: true,
      });
      expect(deviceApi.listDeviceFiles).toHaveBeenNthCalledWith(1, NAM_USER_FOLDER, "nam");
      expect(deviceApi.downloadTone).toHaveBeenCalledExactlyOnceWith(tone, model, "My Clean");
      expect(folders.get(NAM_USER_FOLDER)).toBeUndefined();
    });

    it.each([
      ["Neural Amp Modeler\\User\\Clean tones\\", "Neural Amp Modeler/User/Clean tones"],
      ["Neural Amp Modeler/Shared captures", "Neural Amp Modeler/Shared captures"],
      [NAM_DEVICE_ROOT, NAM_DEVICE_ROOT],
    ])("preserves the chosen NAM destination %s", async (requested, expected) => {
      simulateFolders();
      await expect(prepareNamFolderSave(tone, model, "Clean", requested)).resolves.toEqual({
        name: "Clean", path: `${expected}/Clean.nam`, sourcePath: `${TONE3000_DEVICE_FOLDER}/Clean.nam`, requiresTransfer: true,
      });
      expect(deviceApi.listDeviceFiles).toHaveBeenNthCalledWith(1, expected, "nam");
    });

    it("refuses an existing destination before downloading a staged copy", async () => {
      simulateFolders({ [NAM_USER_FOLDER]: [`${NAM_USER_FOLDER}/cLeAn.NAM`] });
      const prepared = prepareNamFolderSave(tone, model, "Clean");
      await expect(prepared).rejects.toBeInstanceOf(Tone3000ModelNameConflictError);
      await expect(prepared).rejects.toMatchObject({ modelName: "Clean", path: `${NAM_USER_FOLDER}/Clean.nam` });
      expect(deviceApi.downloadTone).not.toHaveBeenCalled();
      expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(1);
    });

    it("uses a free staging filename while retaining the desired User filename", async () => {
      const existing = ["cLeAn.NAM", `${TONE3000_DEVICE_FOLDER}/Clean 2.nam`];
      const folders = simulateFolders({ [TONE3000_DEVICE_FOLDER]: existing });
      await expect(prepareNamFolderSave(tone, model, "Clean")).resolves.toEqual({
        name: "Clean", path: `${NAM_USER_FOLDER}/Clean.nam`, sourcePath: `${TONE3000_DEVICE_FOLDER}/Clean 3.nam`, requiresTransfer: true,
      });
      expect(deviceApi.downloadTone).toHaveBeenCalledExactlyOnceWith(tone, model, "Clean 3");
      expect(folders.get(TONE3000_DEVICE_FOLDER)).toEqual([...existing, "Clean 3.nam"]);
      expect(folders.get(NAM_USER_FOLDER)).toBeUndefined();
    });

    it("bounds a suffixed staging name without shortening the intended destination", async () => {
      const name = "N".repeat(200);
      simulateFolders({ [TONE3000_DEVICE_FOLDER]: [`${name}.nam`] });
      const stagedName = `${"N".repeat(198)} 2`;
      await expect(prepareNamFolderSave(tone, model, name)).resolves.toEqual({
        name, path: `${NAM_USER_FOLDER}/${name}.nam`, sourcePath: `${TONE3000_DEVICE_FOLDER}/${stagedName}.nam`, requiresTransfer: true,
      });
      expect(deviceApi.downloadTone).toHaveBeenCalledExactlyOnceWith(tone, model, stagedName);
    });

    it("finishes directly when the user explicitly chooses Tone 3000", async () => {
      simulateFolders();
      const path = `${TONE3000_DEVICE_FOLDER}/Clean.nam`;
      await expect(prepareNamFolderSave(tone, model, "Clean", TONE3000_DEVICE_FOLDER)).resolves.toEqual({
        name: "Clean", path, sourcePath: path, requiresTransfer: false,
      });
      expect(deviceApi.listDeviceFiles).toHaveBeenCalledTimes(2);
      expect(deviceApi.listDeviceFiles).toHaveBeenNthCalledWith(1, TONE3000_DEVICE_FOLDER, "nam");
      expect(deviceApi.downloadTone).toHaveBeenCalledExactlyOnceWith(tone, model, "Clean");
    });

    it("does not silently rename a duplicate in the explicitly selected Tone 3000 folder", async () => {
      simulateFolders({ [TONE3000_DEVICE_FOLDER]: ["Clean.nam"] });
      await expect(prepareNamFolderSave(tone, model, "Clean", TONE3000_DEVICE_FOLDER)).rejects.toBeInstanceOf(Tone3000ModelNameConflictError);
      expect(deviceApi.downloadTone).not.toHaveBeenCalled();
    });

    it.each(["Rigs", "/Neural Amp Modeler/User", "Neural Amp Modeler/../Rigs", "Neural Amp Modeler/User/../Other"])("rejects invalid destination %s before device IO", async (folder) => {
      await expect(prepareNamFolderSave(tone, model, "Clean", folder)).rejects.toThrow(/inside Neural Amp Modeler/);
      expect(deviceApi.listDeviceFiles).not.toHaveBeenCalled();
      expect(deviceApi.downloadTone).not.toHaveBeenCalled();
    });

    it("does not return a prepared transfer if the staged download cannot be verified", async () => {
      const prepared = expect(prepareNamFolderSave(tone, model, "Clean")).rejects.toThrow(/was requested.*could not confirm/);
      await vi.runAllTimersAsync();
      await prepared;
      expect(deviceApi.downloadTone).toHaveBeenCalledTimes(1);
    });

    it("requires native mode before querying either destination or staging files", async () => {
      vi.mocked(deviceApi.isNative).mockReturnValue(false);
      await expect(prepareNamFolderSave(tone, model, "Clean")).rejects.toThrow("desktop app");
      expect(deviceApi.listDeviceFiles).not.toHaveBeenCalled();
      expect(deviceApi.downloadTone).not.toHaveBeenCalled();
    });
  });
});
