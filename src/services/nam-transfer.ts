import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { deviceApi } from "./device-api";

export const NAM_DEVICE_ROOT = "Neural Amp Modeler";
export const NAM_USER_FOLDER = `${NAM_DEVICE_ROOT}/User`;

export interface NamTransferResult {
  name: string;
  path: string;
}

function requireNativeTransfer(): void {
  if (!deviceApi.isNative()) throw new Error("Use the desktop app to copy NAM files to HeadRush over USB.");
}

function namPathSegments(input: string): string[] {
  if (typeof input !== "string") throw new Error("Choose a folder inside Neural Amp Modeler.");
  const path = input.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = path.split("/");
  if (
    segments[0] !== NAM_DEVICE_ROOT
    || segments.some((segment) => !segment || segment === "." || segment === ".." || /[<>:"|?*\u0000-\u001f\u007f]/.test(segment) || /[. ]$/.test(segment))
  ) throw new Error("Choose a folder inside Neural Amp Modeler. Absolute paths and parent-folder shortcuts are not allowed.");
  return segments;
}

export function validateNamDestinationFolder(input: string): string {
  return namPathSegments(input).join("/");
}

function validateNamFilePath(input: string): string {
  const segments = namPathSegments(input);
  const filename = segments.at(-1) ?? "";
  if (segments.length < 2 || !/\.nam$/i.test(filename) || !filename.slice(0, -4).trim()) throw new Error("Choose a .nam file inside Neural Amp Modeler.");
  return segments.join("/");
}

export async function chooseNamTransferRoot(): Promise<string | null> {
  requireNativeTransfer();
  const selected = await open({ directory: true, recursive: true, title: "Choose Neural Amp Modeler on HeadRush" });
  if (selected === null) return null;
  if (typeof selected !== "string" || !selected.trim()) throw new Error("No HeadRush NAM folder was selected.");
  return selected;
}

export async function completeNamTransfer(namRoot: string, sourcePath: string, destinationPath: string): Promise<NamTransferResult> {
  requireNativeTransfer();
  if (!namRoot.trim()) throw new Error("Choose the Neural Amp Modeler folder on the HeadRush USB drive first.");
  const source = validateNamFilePath(sourcePath);
  const destination = validateNamFilePath(destinationPath);
  if (source.toLocaleLowerCase() === destination.toLocaleLowerCase()) throw new Error("Choose a different NAM destination from the staged source.");
  const result = await invoke<NamTransferResult>("transfer_nam_file", { namRoot, sourcePath: source, destinationPath: destination });
  const expectedName = destination.split("/").at(-1)!.slice(0, -4);
  if (!result || typeof result !== "object" || result.path !== destination || result.name !== expectedName) {
    throw new Error("RushLink could not confirm the USB copy destination. Check the selected HeadRush folder before trying again.");
  }
  return result;
}
