import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceApi } from "./device-api";

describe("5.2 Tone3000 browser authentication", () => {
  afterEach(() => vi.restoreAllMocks());

  it("unwraps the reflected sign-in URL and calls the new method without arguments", async () => {
    const method = vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: { methodReturnValue: "https://www.tone3000.com/auth/device?code=example" } });
    await expect(deviceApi.startTone3000Login()).resolves.toBe("https://www.tone3000.com/auth/device?code=example");
    expect(method).toHaveBeenCalledWith("/Evil/API/Tone3000", "startLoginGetAuthUrl", []);
  });

  it.each(["", "javascript:alert(1)", "http://tone3000.com/login", "https://tone3000.com.evil.test/login", "https://user:password@tone3000.com/login", { success: true }])("rejects untrusted or invalid sign-in responses: %j", async (value) => {
    vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 200, body: { methodReturnValue: value } });
    await expect(deviceApi.startTone3000Login()).rejects.toThrow();
  });

  it("reports a device method failure without returning a URL", async () => {
    vi.spyOn(deviceApi, "callMethod").mockResolvedValue({ status: 404, body: "Not found" });
    await expect(deviceApi.startTone3000Login()).rejects.toThrow();
  });
});
