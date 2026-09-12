import { describe, expect, it } from "vitest";
import { primaryConnectionAddress } from "./connection-address";

describe("primary HeadRush address", () => {
  it.each(["192.168.1.129", "http://192.168.1.129:80", "[fe80::1]", "fe80::1"])("keeps legacy IP %s behind the model address", address => {
    expect(primaryConnectionAddress(address)).toBe("headrushflexprime.local");
    expect(primaryConnectionAddress(address, "headrushcore.local")).toBe("headrushcore.local");
  });
  it("preserves explicitly configured hostnames", () => {
    expect(primaryConnectionAddress("headrushprime.local")).toBe("headrushprime.local");
    expect(primaryConnectionAddress("http://pedal.local:8080")).toBe("http://pedal.local:8080");
  });
});
