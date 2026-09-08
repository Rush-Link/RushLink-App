import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi, TONE3000_DEVICE_FOLDER, tone3000ModelFilename, tone3000ModelName } from "./device-api";
import { NAM_USER_FOLDER, validateNamDestinationFolder } from "./nam-transfer";

export interface Tone3000SourceSaveResult {
  name: string;
  path: string;
}

export interface PreparedNamFolderSave extends Tone3000SourceSaveResult {
  sourcePath: string;
  requiresTransfer: boolean;
}

export class Tone3000ModelNameConflictError extends Error {
  readonly modelName: string;
  readonly path: string;

  constructor(modelName: string, filename: string, folder = TONE3000_DEVICE_FOLDER) {
    super(`A NAM model named "${modelName}" already exists on the HeadRush. Choose another name.`);
    this.name = "Tone3000ModelNameConflictError";
    this.modelName = modelName;
    this.path = `${folder}/${filename}`;
  }
}

const filenameOf = (entry: string) => entry.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.trim() ?? "";
const filenameKey = (entry: string) => filenameOf(entry).toLocaleLowerCase();

/** The native downloader can only write Tone 3000. Other folders finish over USB. */
export async function prepareNamFolderSave(tone: CloudTone, model: ToneModel, name: string, destination = NAM_USER_FOLDER): Promise<PreparedNamFolderSave> {
  const folder = validateNamDestinationFolder(destination);
  const modelName = name.trim() ? tone3000ModelName(model, name) : "";
  if (!modelName) throw new Error("Enter a name for the NAM model.");
  if (!deviceApi.isNative()) throw new Error("Connect a HeadRush in the desktop app before saving a NAM model to the device.");
  if (folder === TONE3000_DEVICE_FOLDER) {
    const saved = await saveTone3000Source(tone, model, modelName);
    return { ...saved, sourcePath: saved.path, requiresTransfer: false };
  }
  const filename = tone3000ModelFilename(model, modelName);
  const existing = await deviceApi.listDeviceFiles(folder, "nam");
  if (existing.some((entry) => filenameKey(entry) === filenameKey(filename))) throw new Tone3000ModelNameConflictError(modelName, filename, folder);

  const used = new Set((await deviceApi.listDeviceFiles(TONE3000_DEVICE_FOLDER, "nam")).map(filenameKey));
  for (let copy = 1; copy <= 10_000; copy++) {
    const suffix = copy === 1 ? "" : ` ${copy}`;
    const candidate = `${modelName.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
    if (used.has(filenameKey(tone3000ModelFilename(model, candidate)))) continue;
    const staged = await saveTone3000Source(tone, model, candidate);
    return { name: modelName, path: `${folder}/${filename}`, sourcePath: staged.path, requiresTransfer: true };
  }
  throw new Error("Too many NAM downloads share this name. Choose another name.");
}

export async function saveTone3000Source(tone: CloudTone, model: ToneModel, name: string): Promise<Tone3000SourceSaveResult> {
  if (!deviceApi.isNative()) throw new Error("Connect a HeadRush in the desktop app before saving a NAM model to the device.");
  if (tone.source !== "Tone3000") throw new Error("Choose a Tone3000 NAM model to save.");
  const modelName = name.trim() ? tone3000ModelName(model, name) : "";
  if (!modelName) throw new Error("Enter a name for the NAM model.");

  const filename = tone3000ModelFilename(model, modelName);
  const key = filenameKey(filename);
  const existing = await deviceApi.listDeviceFiles(TONE3000_DEVICE_FOLDER, "nam");
  if (existing.some((entry) => filenameKey(entry) === key)) throw new Tone3000ModelNameConflictError(modelName, filename);

  await deviceApi.downloadTone(tone, model, modelName);

  let lastReadError: unknown;
  for (const delay of [0, 100, 250, 500]) {
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    try {
      const files = await deviceApi.listDeviceFiles(TONE3000_DEVICE_FOLDER, "nam");
      const savedFile = files.find((entry) => filenameKey(entry) === key);
      if (savedFile) return { name: modelName, path: `${TONE3000_DEVICE_FOLDER}/${filenameOf(savedFile)}` };
    } catch (error) {
      lastReadError = error;
    }
  }
  throw new Error(
    `The download of "${filename}" was requested, but RushLink could not confirm the file in ${TONE3000_DEVICE_FOLDER}. Check that folder on the HeadRush before trying again.`,
    { cause: lastReadError },
  );
}
