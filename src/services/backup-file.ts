import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseRushLinkArchive, type RushLinkArchive } from "../domain/backup";

const safeName = (name: string) => name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").slice(0, 70) || "rushlink-backup";

export async function saveRushLinkArchive(archive: RushLinkArchive, suggestedName = "rushlink-backup") {
  const contents = JSON.stringify(archive, null, 2);
  if (isTauri()) {
    const path = await save({ defaultPath: `${safeName(suggestedName)}.rushlink.json`, filters: [{ name: "RushLink archive", extensions: ["json"] }] });
    if (!path) return null;
    await writeTextFile(path, contents);
    return path;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${safeName(suggestedName)}.rushlink.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return anchor.download;
}

export async function openRushLinkArchive() {
  if (!isTauri()) return null;
  const path = await open({ multiple: false, directory: false, filters: [{ name: "RushLink archive", extensions: ["json"] }] });
  if (!path) return null;
  return { archive: parseRushLinkArchive(JSON.parse(await readTextFile(path))), source: path };
}

export async function readRushLinkArchiveFile(file: File) {
  return parseRushLinkArchive(JSON.parse(await file.text()));
}
