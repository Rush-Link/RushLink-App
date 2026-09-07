import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
  app: { security: { csp: string; devCsp: string } };
};

const trustedArtworkOrigins = [
  "https://api.tone3000.com",
  "https://images.api.inmusicbrands.com",
];

describe("Tauri content security policy", () => {
  it.each(["csp", "devCsp"] as const)("allows only the trusted remote artwork origins in %s", (policyName) => {
    const imageDirective = config.app.security[policyName]
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("img-src "));

    expect(imageDirective).toBeDefined();
    expect(imageDirective?.split(/\s+/)).toEqual(expect.arrayContaining(trustedArtworkOrigins));
    expect(imageDirective?.split(/\s+/)).not.toContain("https:");
  });
});
