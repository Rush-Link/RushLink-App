import { test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dependencyInstallMatches, parseChecksums } from "./workflow-artifacts.mjs";

test.skipIf(process.platform !== "win32")("Android setup preserves isolation and rejects invalid tools and licenses", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "test-android-tools.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    encoding: "utf8", timeout: 55000, windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}, 60000);

test.skipIf(process.platform !== "win32")("Mac build snapshots preserve Git state and reject invalid artifacts", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "test-macos-build.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    encoding: "utf8", timeout: 55000, windowsHide: true,
  });
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
