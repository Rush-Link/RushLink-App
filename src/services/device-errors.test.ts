import { describe, expect, it } from "vitest";
import { DeviceError, deviceErrorDetail, deviceErrorMessage, invalidDeviceResponse, normalizeDeviceError } from "./device-errors";

describe("device error normalization", () => {
  it.each([
    ["request timed out", "timeout", true],
    ["No HeadRush device is connected", "offline", true],
    ["connection refused", "offline", true],
    ["Device returned HTTP 404", "unavailable", true],
    ["Device returned HTTP 409", "rejected", false],
    ["Device returned HTTP 503", "http", true],
    ["Invalid reflected method name", "invalid-request", false],
    ["Model is incompatible", "rejected", false],
  ] as const)("classifies %s", (input, code, recoverable) => {
    expect(normalizeDeviceError(input, "Testing device")).toMatchObject({ code, recoverable, action: "Testing device" });
  });

  it("preserves a typed error and extracts messages from bridge-shaped objects", () => {
    const original = new DeviceError("offline", "Already normalized", { action: "Connect" });
    expect(normalizeDeviceError(original, "Ignored")).toBe(original);
    expect(normalizeDeviceError({ message: "network is unreachable" })).toMatchObject({ code: "offline" });
    expect(normalizeDeviceError({ error: "operation timed out" })).toMatchObject({ code: "timeout" });
  });

  it("keeps user guidance concise while retaining technical diagnostics", () => {
    const error = normalizeDeviceError("Device returned HTTP 500: internal stack", "Saving rig");
    expect(deviceErrorMessage(error)).toBe("Saving rig: the HeadRush reported an internal error. Wait a moment and try again.");
    expect(deviceErrorDetail(error)).toContain("Device returned HTTP 500");
    expect(error).toMatchObject({ status: 500, code: "http" });
  });

  it("reports malformed payloads without serializing their contents into the UI", () => {
    const error = invalidDeviceResponse("Refreshing device state", "an object", ["private", "payload"]);
    expect(error).toMatchObject({ code: "invalid-response", recoverable: true });
    expect(error.message).not.toContain("private");
    expect(error.technicalMessage).toBe("Expected an object; received array");
  });

  it("falls back safely for unknown and non-serializable errors", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(normalizeDeviceError(cyclic)).toMatchObject({ code: "unknown" });
    expect(deviceErrorMessage(null)).toBe("Unknown device error");
  });
});
