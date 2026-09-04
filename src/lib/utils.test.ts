import { describe, expect, it } from "vitest";
import { clamp, cn, formatCompact } from "./utils";

describe("shared UI utilities", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("p-2", false && "hidden", ["text-sm", "p-4"])).toBe("text-sm p-4");
  });

  it("formats compact values and clamps both boundaries", () => {
    expect(formatCompact(1_250)).toMatch(/1\.3K/i);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
