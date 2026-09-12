import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi, TONE3000_DEVICE_FOLDER } from "./device-api";
import { saveTone3000Source, Tone3000ModelNameConflictError } from "./tone3000-save";

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

});
