import { test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dependencyInstallMatches, parseChecksums } from "./workflow-artifacts.mjs";

function runWindowsPowerShell(args, timeout, inheritedEnvironment = process.env) {
  const env = { ...inheritedEnvironment };
  // A PowerShell Core parent can pass its incompatible module paths to Desktop
  // PowerShell 5.1. Let the child initialize its own built-in module search paths.
  for (const key of Object.keys(env)) if (key.toLowerCase() === "psmodulepath") delete env[key];
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], {
    env, encoding: "utf8", timeout, windowsHide: true,
  });
}

test.skipIf(process.platform !== "win32")("Windows PowerShell loads native hash tools with an inherited Core module path", () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), "workflow-artifacts.mjs");
  const inheritedModulePath = join(dirname(file), "rushlink-core-only-modules");
  const command = [
    "$ErrorActionPreference='Stop'",
    "$hash = (Get-FileHash -LiteralPath $env:RUSHLINK_TEST_HASH_FILE -Algorithm SHA256).Hash",
    "$nestedHash = & powershell.exe -NoProfile -NonInteractive -Command '(Get-FileHash -LiteralPath $env:RUSHLINK_TEST_HASH_FILE -Algorithm SHA256).Hash'",
    "if ($LASTEXITCODE -ne 0) { throw 'Nested Windows PowerShell hashing failed.' }",
    "@{ hash=$hash; nestedHash=$nestedHash; modulePath=$env:PSModulePath } | ConvertTo-Json -Compress",
  ].join("\n");
  const result = runWindowsPowerShell(["-Command", command], 15000, {
    ...process.env, PSModulePath: inheritedModulePath, RUSHLINK_TEST_HASH_FILE: file,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const actual = JSON.parse(result.stdout);
  const expectedHash = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(actual.hash.toLowerCase(), expectedHash);
  assert.equal(actual.nestedHash.toLowerCase(), expectedHash);
  assert.equal(actual.modulePath.toLowerCase().includes(inheritedModulePath.toLowerCase()), false);
}, 20000);

test.skipIf(process.platform !== "win32")("Phone and tablet runtimes preserve separate sessions and correct screen sizes", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "test-android-runtime.ps1");
  const result = runWindowsPowerShell(["-File", script], 15000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}, 20000);

test.skipIf(process.platform !== "win32")("Android setup preserves isolation and rejects invalid tools and licenses", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "test-android-tools.ps1");
  const result = runWindowsPowerShell(["-File", script], 55000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}, 60000);

test.skipIf(process.platform !== "win32")("Mac build snapshots preserve Git state and reject invalid artifacts", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "test-macos-build.ps1");
  const result = runWindowsPowerShell(["-File", script], 55000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}, 60000);

test("changed locked dependencies require installation; optional platform packages may be absent", () => {
  const entry = { version: "1.2.3", resolved: "https://registry.npmjs.org/example/-/example-1.2.3.tgz", integrity: "sha512-pinned" };
  const expected = { packages: { "": { version: "1.0.0" }, "node_modules/example": entry, "node_modules/other-platform": { optional: true, version: "1" } } };
  const installed = { packages: { "node_modules/example": { ...entry } } };
  assert.equal(dependencyInstallMatches(expected, installed), true);
  for (const field of ["version", "resolved", "integrity"]) {
    assert.equal(dependencyInstallMatches(expected, { packages: { "node_modules/example": { ...entry, [field]: "changed" } } }), false);
  }
  assert.equal(dependencyInstallMatches(expected, { packages: {} }), false);
  assert.equal(dependencyInstallMatches(expected, { packages: { ...installed.packages, "node_modules/unlocked": entry } }), false);
});

test("installer checksum manifests cannot point outside their platform directory", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(parseChecksums(`${hash}  RushLink test.apk\n`), [{ hash, name: "RushLink test.apk" }]);
  assert.deepEqual(parseChecksums(`${hash.toUpperCase()} *RushLink.dmg\r\n`), [{ hash, name: "RushLink.dmg" }]);
  for (const name of ["../secret.apk", "..\\secret.apk", "C:\\temp\\app.exe", "C:stream.exe", "/tmp/app.msi", "runtime.json"]) {
    assert.throws(() => parseChecksums(`${hash}  ${name}`));
  }
  assert.throws(() => parseChecksums("not-a-checksum  RushLink.apk"));
});
