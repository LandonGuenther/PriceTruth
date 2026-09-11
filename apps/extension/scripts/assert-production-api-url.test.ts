import { describe, expect, it } from "vitest";
import { assertProductionApiUrl } from "./assert-production-api-url.js";

describe("assertProductionApiUrl", () => {
  it("requires a non-empty URL", () => {
    expect(() => assertProductionApiUrl(undefined)).toThrow(/required/);
    expect(() => assertProductionApiUrl("")).toThrow(/required/);
    expect(() => assertProductionApiUrl("   ")).toThrow(/required/);
  });

  it("rejects localhost and loopback hosts", () => {
    expect(() => assertProductionApiUrl("https://localhost:3000")).toThrow(/localhost/);
    expect(() => assertProductionApiUrl("https://127.0.0.1:3000")).toThrow(/localhost/);
    expect(() => assertProductionApiUrl("https://[::1]:3000")).toThrow(/localhost/);
  });

  it("rejects non-https and invalid URLs", () => {
    expect(() => assertProductionApiUrl("not a url")).toThrow(/not a valid URL/);
    expect(() => assertProductionApiUrl("ftp://api.example.com")).toThrow(/https/);
    expect(() => assertProductionApiUrl("http://api.example.com")).toThrow(/https/);
  });

  it("accepts a public https origin", () => {
    expect(assertProductionApiUrl("https://api.example.com")).toBe("https://api.example.com");
    expect(assertProductionApiUrl(" https://api.example.com/v1 ")).toBe(
      "https://api.example.com/v1",
    );
  });
});
