import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssFiles = [
  join(sourceRoot, "styles.css"),
  ...readdirSync(join(sourceRoot, "styles"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => join(sourceRoot, "styles", entry.name)),
];

function tinyTypeDeclarations() {
  return cssFiles.flatMap((file) => {
    const css = readFileSync(file, "utf8");
    const declarations = [
      ...css.matchAll(/font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px/gi),
      ...css.matchAll(/\bfont\s*:\s*[^;{}]*?([0-9]+(?:\.[0-9]+)?)px/gi),
    ];
    return declarations.flatMap((match) => Number(match[1]) < 11
      ? [`${file.replace(sourceRoot, "src")}: ${match[0]}`]
      : []);
  });
}

describe("app typography", () => {
  it("does not reintroduce unreadable fixed pixel text", () => {
    expect(tinyTypeDeclarations()).toEqual([]);
  });
});
