import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRushLinkArchive } from "../domain/backup";

const platform = vi.hoisted(() => ({ isTauri: vi.fn(), open: vi.fn(), save: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: platform.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: platform.open, save: platform.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: platform.readTextFile, writeTextFile: platform.writeTextFile }));

import { openRushLinkArchive, readRushLinkArchiveFile, saveRushLinkArchive } from "./backup-file";

const archive = createRushLinkArchive({ snapshots: [], workspace: {}, deviceIndex: { rigs: [], setlists: [] } });

describe("portable backup file service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(platform).forEach((mock) => mock.mockReset());
    platform.isTauri.mockReturnValue(false);
  });

  it("downloads a sanitized archive in browser builds and revokes the object URL", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:archive"); const revokeObjectURL = vi.fn(); const click = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => tag === "a" ? { href: "", download: "", click } as unknown as HTMLElement : originalCreate(tag)) as typeof document.createElement);
    await expect(saveRushLinkArchive(archive, '  Tour: A/B *  ')).resolves.toBe("Tour--A-B--.rushlink.json");
    expect(createObjectURL).toHaveBeenCalled(); expect(click).toHaveBeenCalled();
    vi.advanceTimersByTime(1_000); expect(revokeObjectURL).toHaveBeenCalledWith("blob:archive");
    vi.useRealTimers();
  });

  it("writes through Tauri and treats a cancelled save as non-destructive", async () => {
    platform.isTauri.mockReturnValue(true);
    platform.save.mockResolvedValueOnce(null);
    await expect(saveRushLinkArchive(archive)).resolves.toBeNull();
    expect(platform.writeTextFile).not.toHaveBeenCalled();
    platform.save.mockResolvedValueOnce("C:/Backups/show.json");
    await expect(saveRushLinkArchive(archive, "show")).resolves.toBe("C:/Backups/show.json");
    expect(platform.writeTextFile).toHaveBeenCalledWith("C:/Backups/show.json", expect.stringContaining('"format": "rushlink-archive"'));
  });

  it("opens, parses and identifies native archives", async () => {
    expect(await openRushLinkArchive()).toBeNull();
    platform.isTauri.mockReturnValue(true); platform.open.mockResolvedValueOnce(null);
    expect(await openRushLinkArchive()).toBeNull();
    platform.open.mockResolvedValueOnce("C:/Backups/show.json"); platform.readTextFile.mockResolvedValue(JSON.stringify(archive));
    await expect(openRushLinkArchive()).resolves.toMatchObject({ source: "C:/Backups/show.json", archive: { version: 2 } });
  });

  it("parses user-selected files and rejects malformed content", async () => {
    const file = { text: vi.fn().mockResolvedValue(JSON.stringify(archive)) } as unknown as File;
    await expect(readRushLinkArchiveFile(file)).resolves.toMatchObject({ format: "rushlink-archive" });
    await expect(readRushLinkArchiveFile({ text: async () => "{" } as unknown as File)).rejects.toBeInstanceOf(SyntaxError);
  });
});
