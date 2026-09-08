import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, isTauri: bridge.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: bridge.open, save: vi.fn() }));

import { chooseNamTransferRoot, completeNamTransfer, NAM_DEVICE_ROOT, NAM_USER_FOLDER, validateNamDestinationFolder } from "./nam-transfer";

const namRoot = "E:\\Neural Amp Modeler";
const source = `${NAM_DEVICE_ROOT}/Tone 3000/Stage capture.nam`;
const destination = `${NAM_USER_FOLDER}/Clean tones/Saved capture.nam`;

describe("NAM destination folders", () => {
  it("accepts the NAM root and its user-selected descendants", () => {
    expect(validateNamDestinationFolder(NAM_DEVICE_ROOT)).toBe("Neural Amp Modeler");
    expect(validateNamDestinationFolder(NAM_USER_FOLDER)).toBe("Neural Amp Modeler/User");
    expect(validateNamDestinationFolder("Neural Amp Modeler\\User\\Clean tones\\")).toBe("Neural Amp Modeler/User/Clean tones");
    expect(validateNamDestinationFolder("Neural Amp Modeler/Other captures")).toBe("Neural Amp Modeler/Other captures");
  });

  it.each([
    "", "User", "Neural Amp Modeler Other/User", "/Neural Amp Modeler/User", "E:/Neural Amp Modeler/User",
    "//HeadRush/Neural Amp Modeler/User", "Neural Amp Modeler/../Rigs", "Neural Amp Modeler/User/../../Rigs",
    "Neural Amp Modeler/./User", "Neural Amp Modeler//User", "Neural Amp Modeler/User?", "Neural Amp Modeler/User./Nested",
    "Neural Amp Modeler/User /Nested", "Neural Amp Modeler/User\u0000/Nested",
  ])("refuses unsafe or out-of-root folder %j", (folder) => {
    expect(() => validateNamDestinationFolder(folder)).toThrow(/inside Neural Amp Modeler/);
  });
});

describe("NAM USB transfer", () => {
  beforeEach(() => {
    bridge.invoke.mockReset();
    bridge.open.mockReset();
    bridge.isTauri.mockReturnValue(true);
  });

  it("opens a recursive folder chooser for the mounted NAM root", async () => {
    bridge.open.mockResolvedValue(namRoot);
    await expect(chooseNamTransferRoot()).resolves.toBe(namRoot);
    expect(bridge.open).toHaveBeenCalledWith({ directory: true, recursive: true, title: "Choose Neural Amp Modeler on HeadRush" });
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("returns cancellation without copying files", async () => {
    bridge.open.mockResolvedValue(null);
    await expect(chooseNamTransferRoot()).resolves.toBeNull();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("surfaces folder chooser failure", async () => {
    const error = new Error("Folder chooser failed");
    bridge.open.mockRejectedValue(error);
    await expect(chooseNamTransferRoot()).rejects.toBe(error);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("rejects an incomplete folder chooser result", async () => {
    bridge.open.mockResolvedValue("");
    await expect(chooseNamTransferRoot()).rejects.toThrow("No HeadRush NAM folder");
  });

  it("requires the desktop app for both the chooser and copy", async () => {
    bridge.isTauri.mockReturnValue(false);
    await expect(chooseNamTransferRoot()).rejects.toThrow("desktop app");
    await expect(completeNamTransfer(namRoot, source, destination)).rejects.toThrow("desktop app");
    expect(bridge.open).not.toHaveBeenCalled();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("copies to the chosen descendant without a live Wi-Fi connection", async () => {
    const result = { name: "Saved capture", path: destination };
    bridge.invoke.mockResolvedValue(result);
    await expect(completeNamTransfer(namRoot, source.replaceAll("/", "\\"), destination)).resolves.toEqual(result);
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith("transfer_nam_file", { namRoot, sourcePath: source, destinationPath: destination });
  });

  it.each([
    ["", source, destination],
    [namRoot, "Rigs/Source.nam", destination],
    [namRoot, source, "Neural Amp Modeler/../Rigs/Target.nam"],
    [namRoot, source, "E:/Neural Amp Modeler/User/Target.nam"],
    [namRoot, "Neural Amp Modeler/Tone 3000/Source.wav", destination],
    [namRoot, source, "Neural Amp Modeler/User/Target.json"],
    [namRoot, source, "Neural Amp Modeler/User/.nam"],
    [namRoot, source, source],
  ])("rejects invalid copy paths before invoking native IO", async (root, from, to) => {
    await expect(completeNamTransfer(root, from, to)).rejects.toThrow();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("preserves native copy failures instead of reporting a saved file", async () => {
    const error = new Error("The destination file already exists");
    bridge.invoke.mockRejectedValue(error);
    await expect(completeNamTransfer(namRoot, source, destination)).rejects.toBe(error);
  });

  it.each([null, {}, { name: "Saved capture", path: source }, { name: "Other capture", path: destination }])("refuses an unconfirmed native result: %j", async (response) => {
    bridge.invoke.mockResolvedValue(response);
    await expect(completeNamTransfer(namRoot, source, destination)).rejects.toThrow("could not confirm the USB copy destination");
  });
});
