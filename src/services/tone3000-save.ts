import type { CloudTone, ToneModel } from "../domain/types";
import { deviceApi, TONE3000_DEVICE_FOLDER, tone3000ModelFilename, tone3000ModelName } from "./device-api";

export interface Tone3000SourceSaveResult {
  name: string;
  path: string;
}

export class Tone3000ModelNameConflictError extends Error {
  readonly modelName: string;
  readonly path: string;

  constructor(modelName: string, filename: string) {
    super(`A NAM model named "${modelName}" already exists on the HeadRush. Choose another name.`);
    this.name = "Tone3000ModelNameConflictError";
    this.modelName = modelName;
    this.path = `${TONE3000_DEVICE_FOLDER}/${filename}`;
  }
}

const filenameOf = (entry: string) => entry.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.trim() ?? "";
const filenameKey = (entry: string) => filenameOf(entry).toLocaleLowerCase();

export async function saveTone3000Source(tone: CloudTone, model: ToneModel, name: string, assertContext?: () => void): Promise<Tone3000SourceSaveResult> {
  if (!deviceApi.isNative()) throw new Error("Connect a HeadRush in the desktop app before saving a NAM model to the device.");
  if (tone.source !== "Tone3000") throw new Error("Choose a Tone3000 NAM model to save.");
  const modelName = name.trim() ? tone3000ModelName(model, name) : "";
  if (!modelName) throw new Error("Enter a name for the NAM model.");

  const filename = tone3000ModelFilename(model, modelName);
  const key = filenameKey(filename);
  const existing = await deviceApi.listDeviceFiles(TONE3000_DEVICE_FOLDER, "nam");
  assertContext?.();
  if (existing.some((entry) => filenameKey(entry) === key)) throw new Tone3000ModelNameConflictError(modelName, filename);

  await deviceApi.downloadTone(tone, model, modelName);
  assertContext?.();

  let lastReadError: unknown;
  for (const delay of [0, 100, 250, 500]) {
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    assertContext?.();
    try {
      const files = await deviceApi.listDeviceFiles(TONE3000_DEVICE_FOLDER, "nam");
      assertContext?.();
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
