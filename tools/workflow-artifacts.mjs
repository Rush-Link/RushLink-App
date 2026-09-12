import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(workspace, "release-artifacts", "current-build");
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function dependencyInstallMatches(expected, installed) {
  if (!expected?.packages || !installed?.packages) return false;
  for (const [path, entry] of Object.entries(expected.packages)) {
    if (!path) continue;
    const actual = installed.packages[path];
    if (!actual && entry.optional) continue;
    if (!actual) return false;
    for (const field of ["version", "resolved", "integrity", "link"]) {
      if (entry[field] !== actual[field]) return false;
    }
  }
  return Object.keys(installed.packages).every((path) => !path || expected.packages[path]);
}

export function parseChecksums(contents) {
  return contents.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64}) [ *](.+)$/i);
    if (!match) throw new Error("Malformed installer checksum line.");
    const [, hash, name] = match;
    if (/[/\\:*?"<>|\x00-\x1f]/.test(name) || name === "." || name === ".." || !/\.(?:exe|msi|apk|dmg)$/i.test(name)) {
      throw new Error("Checksum must name an installer in its own directory.");
    }
    return { hash: hash.toLowerCase(), name };
  });
}

function collectManifest(path, platform) {
  if (!existsSync(path)) return [];
  return parseChecksums(readFileSync(path, "utf8")).map(({ hash, name }) => {
    const file = join(dirname(path), name);
    if (digest(file) !== hash) throw new Error(`Installer checksum does not match: ${file}`);
    return { platform, file, hash, name, bytes: statSync(file).size };
  });
}

function findMacManifests() {
  // A snapshot keeps its two architectures together, including after a failed newer run.
  const candidates = [];
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = join(output, entry.name);
    const arm = join(base, "macos-arm64", "SHA256SUMS-macos-arm64.txt");
    const intel = join(base, "macos-x86_64", "SHA256SUMS-macos-x86_64.txt");
    if (existsSync(arm) && existsSync(intel)) candidates.push({ arm, intel, time: Math.max(statSync(arm).mtimeMs, statSync(intel).mtimeMs) });
  }
  return candidates.sort((a, b) => b.time - a.time)[0];
}

function writeCatalogue() {
  mkdirSync(output, { recursive: true });
  const installers = [
    ...collectManifest(join(output, "windows", "SHA256SUMS-windows-x64.txt"), "Windows x64"),
    ...collectManifest(join(output, "android", "SHA256SUMS.txt"), "Android preview"),
  ];
  const mac = findMacManifests();
  if (mac) installers.push(...collectManifest(mac.arm, "macOS Apple Silicon"), ...collectManifest(mac.intel, "macOS Intel"));
  const localPath = (file) => relative(output, file).split(sep).join("/");
  const rows = installers.map((item) => `| ${item.platform} | [${item.name}](${localPath(item.file).split("/").map(encodeURIComponent).join("/")}) | ${(item.bytes / 1024 / 1024).toFixed(1)} MB |`);
  const content = [
    "# RushLink preview builds", "",
    "Latest verified installers available in this workspace. Each platform can come from a different build; names retain their application version. No release is published by these build commands.", "",
    "| Platform | Installer | Size |", "| --- | --- | --- |", ...rows, "",
    "Use the Android `x86_64-emulator` APK for the PC tablet and `arm64-device` for ARM64 hardware. Android APKs are debug previews. macOS previews are ad-hoc signed and not notarized; Windows installers are unsigned.", "",
    "Checksums were verified while generating this index. The combined list is in [SHA256SUMS.txt](SHA256SUMS.txt).", "",
    "## Everyday commands", "", "Run from VS Code's terminal at the repository root:", "",
    "```powershell", "npm run tablet", "npm run build:local", "npm run build:macos", "npm run build:all", "npm run tablet:stop", "```", "",
    "[Workflow guide](../../docs/WORKFLOW.md)", "",
    "Build success and emulator startup do not verify physical HeadRush saving. All HeadRush communication remains over Wi-Fi.", "",
  ].join("\n");
  writeFileSync(join(output, "README.md"), content);
  writeFileSync(join(output, "SHA256SUMS.txt"), installers.map((item) => `${item.hash}  ${localPath(item.file)}`).join("\n") + (installers.length ? "\n" : ""));
  console.log(`Verified ${installers.length} installers. Build index: ${join(output, "README.md")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "check-dependencies") {
      const lock = join(workspace, "node_modules", ".package-lock.json");
      process.exitCode = existsSync(lock) && dependencyInstallMatches(json(join(workspace, "package-lock.json")), json(lock)) ? 0 : 1;
    } else if (process.argv[2] === "index") {
      writeCatalogue();
    } else {
      throw new Error("Expected check-dependencies or index.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
