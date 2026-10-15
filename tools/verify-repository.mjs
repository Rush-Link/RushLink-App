import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootArgument = process.argv.indexOf("--root");
const root = rootArgument < 0
  ? resolve(fileURLToPath(new URL("..", import.meta.url)))
  : resolve(process.argv[rootArgument + 1] ?? ".");
const failures = [];
const localDirectories = new Set([
  ".git", "node_modules", "dist", "target", "release-artifacts", "coverage",
  "coverage-all", "playwright-report", "test-results", ".gradle", "build",
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) return [];
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return localDirectories.has(entry.name) ? [] : walk(file);
    return [relative(root, file).split(sep).join("/")];
  });
}

let files;
try {
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (resolve(gitRoot) !== root) throw new Error("Source export has no repository of its own");
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(file => file && existsSync(join(root, file)));
} catch {
  files = walk(root);
}
files = [...new Set(files)].sort();

for (const required of ["README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "package-lock.json", "src-tauri/Cargo.lock", "docs/README.md"]) {
  if (!files.includes(required)) failures.push(`Missing required project file: ${required}`);
}

const forbiddenPath = /^(?:archive|reference|output|captures|brand|site|node_modules|dist|release-artifacts|coverage(?:-all)?|playwright-report|test-results)\//i;
const privateFile = /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx|jks|keystore|prompt\.txt|bundle))$/i;
const secretPatterns = [
  [/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "GitHub fine-grained token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key"],
];
const textExtensions = new Set([".md", ".txt", ".json", ".ts", ".tsx", ".mjs", ".js", ".css", ".html", ".yml", ".yaml", ".toml", ".rs", ".ps1", ".py"]);
let markdownCount = 0;

for (const file of files) {
  if (forbiddenPath.test(file)) failures.push(`Local or archived material in source inventory: ${file}`);
  if (privateFile.test(file) && !/(?:^|\/)\.env\.example$/i.test(file)) failures.push(`Private material in source inventory: ${file}`);
  if (!textExtensions.has(extname(file)) && file !== "LICENSE") continue;
  const contents = readFileSync(join(root, file), "utf8");
  for (const [pattern, label] of secretPatterns) if (pattern.test(contents)) failures.push(`${label} pattern in ${file}; inspect locally before sharing`);
  if (extname(file) !== ".md") continue;
  markdownCount++;
  for (const match of contents.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g)) {
    const href = match[1].startsWith("<") ? match[1].slice(1, -1) : match[1].split(/\s+["']/)[0];
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue;
    let target;
    try { target = decodeURIComponent(href.split(/[?#]/)[0]); } catch { failures.push(`Invalid link encoding in ${file}`); continue; }
    if (!target) continue;
    const resolved = target.startsWith("/") ? resolve(root, `.${target}`) : resolve(root, file, "..", target);
    if (!resolved.startsWith(root + sep) && resolved !== root) failures.push(`Documentation link escapes project: ${file} -> ${href}`);
    else if (!existsSync(resolved)) failures.push(`Broken documentation link: ${file} -> ${href}`);
  }
}

try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  if (pkg.license !== "MIT" || lock.packages?.[""]?.license !== pkg.license || !/^license\s*=\s*"MIT"\s*$/m.test(cargo)) failures.push("Root package, lockfile and Cargo license metadata must agree on MIT");
  if (JSON.stringify(pkg.engines) !== JSON.stringify(lock.packages?.[""]?.engines)) failures.push("Root package and lockfile Node engine requirements differ");
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    for (const match of command.matchAll(/(?:\b(?:node|python)\s+|-File\s+)(tools\/[\w./-]+\.(?:mjs|js|py|ps1))/g)) {
      if (!existsSync(join(root, match[1]))) failures.push(`npm script ${name} points to a missing tool: ${match[1]}`);
    }
  }
} catch (error) {
  failures.push(`Could not validate project metadata: ${error.message}`);
}

if (failures.length) {
  console.error("Repository verification failed:\n" + failures.map(failure => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Repository verification passed: ${files.length} source files, ${markdownCount} Markdown documents, license metadata and local links checked.`);
}
