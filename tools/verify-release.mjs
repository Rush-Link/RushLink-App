import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];
const packageJson = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(join(workspace, "src-tauri", "tauri.conf.json"), "utf8"));
const cargoToml = await readFile(join(workspace, "src-tauri", "Cargo.toml"), "utf8");
const distRoot = join(workspace, "dist");

if (packageJson.version !== tauriConfig.version) failures.push(`package version ${packageJson.version} does not match Tauri version ${tauriConfig.version}`);
if (!new RegExp(`^version\\s*=\\s*"${packageJson.version.replaceAll(".", "\\.")}"`, "m").test(cargoToml)) failures.push("Cargo package version does not match package.json");
if (packageJson.dependencies?.["@tauri-apps/plugin-store"]) failures.push("unused Tauri Store plugin is present in production dependencies");
if (/tauri-plugin-store\s*=/.test(cargoToml)) failures.push("unused native Tauri Store plugin is present");
if (tauriConfig.bundle?.resources && Object.keys(tauriConfig.bundle.resources).length) failures.push("bundle resources must be reviewed before release");

const requiredIcons = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "icon.icns"];
for (const icon of requiredIcons) {
  const path = join(workspace, "src-tauri", "icons", icon);
  try {
    if ((await stat(path)).size < 512) failures.push(`release icon is unexpectedly small: ${icon}`);
  } catch {
    failures.push(`release icon is missing: ${icon}`);
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesBelow(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

let distFiles = [];
try {
  distFiles = await filesBelow(distRoot);
} catch {
  failures.push("dist/ is missing; run npm run build before release verification");
}

const forbiddenExtensions = new Set([".map", ".log", ".db", ".sqlite", ".pem", ".key", ".p12", ".pfx"]);
const textExtensions = new Set([".html", ".css", ".js", ".json", ".svg", ".txt"]);
const forbiddenText = [
  [/\bC:\\Users\\/i, "absolute Windows user path"],
  [/(?:^|["'])\/Users\/[^/]+\//i, "absolute macOS user path"],
  [/reference[\\/]headrush/i, "captured HeadRush reference path"],
  [/latest-subtree|midi-input-discovery|reflection-midi-cc92-sweep/i, "device discovery fixture"],
  [/HeadRush Flex Prime_0000|\b192\.168\.1\.129\b/i, "development device identity"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
];

for (const file of distFiles) {
  const extension = extname(file).toLowerCase();
  if (forbiddenExtensions.has(extension)) failures.push(`forbidden release file: ${file.slice(workspace.length + 1)}`);
  if (!textExtensions.has(extension)) continue;
  const contents = await readFile(file, "utf8");
  for (const [pattern, label] of forbiddenText) if (pattern.test(contents)) failures.push(`${label} found in ${file.slice(workspace.length + 1)}`);
}

if (!distFiles.some((file) => basename(file) === "index.html")) failures.push("built frontend has no index.html");
if (failures.length) {
  console.error("Release verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Release verification passed for RushLink ${packageJson.version}: ${distFiles.length} frontend files and ${requiredIcons.length} platform icons checked.`);
