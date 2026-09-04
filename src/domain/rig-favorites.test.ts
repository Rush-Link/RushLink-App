import { describe, expect, it } from "vitest";
import { availableFavoriteRigIds } from "./rig-favorites";

describe("availableFavoriteRigIds", () => {
  it("excludes stale IDs and removes duplicates while preserving order", () => {
    const rigs = [{ id: "device-rig-a" }, { id: "device-rig-b" }];
    expect(availableFavoriteRigIds(rigs, ["rig-1", "device-rig-b", "device-rig-b", "deleted-rig"]))
      .toEqual(["device-rig-b"]);
  });

  it("returns an empty list when persisted favourites belong to another library", () => {
    expect(availableFavoriteRigIds([{ id: "device-rig" }], ["rig-1", "rig-2", "rig-5"]))
      .toEqual([]);
  });
});
