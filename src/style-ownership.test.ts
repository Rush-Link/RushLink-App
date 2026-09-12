import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

function stylesheetImports(relativePath: string) {
  const source = readFileSync(resolve(sourceRoot, relativePath), "utf8");
  return [...source.matchAll(/import\s+["'][^"']*\/([^/"']+\.css)["'];/g)].map((match) => match[1]);
}

const routeStyles = [
  ["pages/dashboard.tsx", []],
  ["pages/editor.tsx", [
    "editor-upgrades.css",
    "editor-workflows.css",
    "signal-canvas.css",
    "history-preview.css",
    "routing-node-editor.css",
    "block-catalogue-readable.css",
  ]],
  ["pages/assignments.tsx", [
    "assignments-upgrades.css",
    "assignment-studio.css",
    "expression-studio.css",
  ]],
  ["pages/rigs-setlists.tsx", ["device-library.css", "setlist-device-data.css"]],
  ["pages/live-play.tsx", ["live-tone.css", "stagehand-v2.css"]],
  ["pages/tone-lab.tsx", ["live-tone.css", "tonepilot-upgrades.css", "tonepilot-lab.css"]],
  ["pages/performance-studio.tsx", [
    "performance-tools.css",
    "performance-modern.css",
    "drum-preset-dialog.css",
    "device-tuner-controls.css",
  ]],
  ["pages/library-backup.tsx", ["backup-modern.css", "device-index-browser.css"]],
  ["pages/system-pages.tsx", ["settings-modern.css"]],
] as const;

const componentStyles = [
  ["components/ui/index.tsx", ["ui-components.css"]],
  ["components/system/controls.tsx", ["controls.css"]],
  ["components/system/device-file-control.tsx", ["device-file-picker.css"]],
  ["components/system/eq-graph.tsx", ["block-eq.css"]],
  ["components/system/midi-out-editor.tsx", ["midi-out-editor.css"]],
  ["components/system/slot-drag-preview.tsx", ["slot-drag-preview.css"]],
] as const;

describe("stylesheet ownership", () => {
  it("keeps lazy loaders focused on JavaScript modules", () => {
    const loaderSource = readFileSync(resolve(sourceRoot, "page-loaders.ts"), "utf8");
    expect(loaderSource).not.toMatch(/styles\/|\.css/);
    expect(loaderSource).not.toContain("Promise.all");
  });

  it.each(routeStyles)("%s owns its ordered route styles", (page, expected) => {
    expect(stylesheetImports(page)).toEqual(expected);
  });

  it.each(componentStyles)("%s owns its component styles", (component, expected) => {
    expect(stylesheetImports(component)).toEqual(expected);
  });

  it("does not leave a stylesheet dependent on incidental route loading", () => {
    const owners = [
      "main.tsx",
      ...routeStyles.map(([page]) => page),
      ...componentStyles.map(([component]) => component),
    ];
    const imported = new Set(owners.flatMap(stylesheetImports));
    const styles = readdirSync(resolve(sourceRoot, "styles"))
      .filter((file) => file.endsWith(".css"))
      .sort();

    expect(styles.filter((file) => !imported.has(file))).toEqual([]);
  });
});
