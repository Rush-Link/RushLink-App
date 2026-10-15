// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const verifier = fileURLToPath(new URL("./verify-repository.mjs", import.meta.url));
const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (dirname(resolve(fixture)) !== resolve(tmpdir()) || !fixture.startsWith(join(tmpdir(), "rushlink-repository-check-"))) throw new Error("Unexpected test cleanup target");
    rmSync(fixture, { recursive: true, force: true });
  }
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "rushlink-repository-check-"));
  fixtures.push(root);
  const write = (name, contents = "") => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), contents); };
  for (const name of ["CONTRIBUTING.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "LICENSE", "src-tauri/Cargo.lock", "docs/README.md"]) write(name);
  write("README.md", "[Contributing](CONTRIBUTING.md)\n");
  write("package.json", JSON.stringify({ license: "MIT", engines: { node: ">=22.12.0" }, scripts: {} }));
  write("package-lock.json", JSON.stringify({ packages: { "": { license: "MIT", engines: { node: ">=22.12.0" } } } }));
  write("src-tauri/Cargo.toml", 'license = "MIT"\n');
  return { root, write, run: () => spawnSync(process.execPath, [verifier, "--root", root], { encoding: "utf8" }) };
}

it("verifies a standalone source export without requiring Git history", () => {
  const fixture = project();
  expect(fixture.run().status).toBe(0);
});

it("rejects broken or external local documentation links and stale tool commands", () => {
  const fixture = project();
  fixture.write("README.md", "[Missing](docs/missing.md)\n[Outside](../outside.md)\n");
  fixture.write("package.json", JSON.stringify({ license: "MIT", engines: { node: ">=22.12.0" }, scripts: { old: "node tools/removed.mjs" } }));
  const result = fixture.run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Broken documentation link");
  expect(result.stderr).toContain("Documentation link escapes project");
  expect(result.stderr).toContain("missing tool");
});

it("rejects private files and archives while safely ignoring deleted tracked files", () => {
  const fixture = project();
  execFileSync("git", ["init", "--quiet"], { cwd: fixture.root });
  fixture.write("reference/old.md", "old capture");
  execFileSync("git", ["add", "."], { cwd: fixture.root });
  rmSync(join(fixture.root, "reference/old.md"));
  expect(fixture.run().status).toBe(0);
  fixture.write("archive/old.md", "historical material");
  fixture.write("signing.key", "not a real key");
  const result = fixture.run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Local or archived material");
  expect(result.stderr).toContain("Private material");
});
