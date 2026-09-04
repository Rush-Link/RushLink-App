import { describe, expect, it } from "vitest";
import { equalDeviceValue, mergeReflectedTree } from "./reflected-tree-merge";

describe("reflected device tree merging", () => {
  it("recognizes structurally equal nested device payloads", () => {
    expect(equalDeviceValue({ gain: 4, modes: [1, 2], nested: { on: true } }, { nested: { on: true }, modes: [1, 2], gain: 4 })).toBe(true);
    expect(equalDeviceValue({ gain: 4 }, { gain: 5 })).toBe(false);
  });

  it("preserves the tree reference when a poll reports no changes", () => {
    const tree = { "/rig": { value: { name: "Clean", tempo: 120 }, meta: { stable: true } } };
    const result = mergeReflectedTree(tree, [["/rig", { name: "Clean", tempo: 120 }]]);
    expect(result.changed).toBe(false);
    expect(result.tree).toBe(tree);
    expect(result.tree["/rig"]).toBe(tree["/rig"]);
  });

  it("only replaces objects whose values changed", () => {
    const tree = { "/rig": { value: { name: "Clean" } }, "/cpu": { value: { load: 10 } } };
    const result = mergeReflectedTree(tree, [["/rig", { name: "Clean" }], ["/cpu", { load: 11 }]]);
    expect(result.changed).toBe(true);
    expect(result.tree).not.toBe(tree);
    expect(result.tree["/rig"]).toBe(tree["/rig"]);
    expect(result.tree["/cpu"].value.load).toBe(11);
  });
});
