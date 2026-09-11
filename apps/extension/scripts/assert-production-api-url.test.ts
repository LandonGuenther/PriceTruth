import { describe, expect, it } from "vitest";
import { assertProductionApiUrl } from "./assert-production-api-url.js";

describe("assertProductionApiUrl", () => {
  it("requires a non-empty URL", () => {
    expect(() => assertProductionApiUrl(undefined)).toThrow(/required/);
    expect(() => assertProductionApiUrl("")).toThrow(/required/);
    expect(() => assertProductionApiUrl("   ")).toThrow(/required/);
  });

  it("rejects localhost and loopback hosts", () => {
    expect(() => assertProductionApiUrl("http://localhost:3000")).toThrow(/localhost/);
    expect(() => assertProductionApiUrl("http://127.0.0.1:3000")).toThrow(/localhost/);
    expect(() => assertProductionApiUrl("http://[::1]:3000")).toThrow(/localhost/);
  });

  it("rejects non-http(s) and invalid URLs", () => {
    expect(() => assertProductionApiUrl("not a url")).toThrow(/not a valid URL/);
    expect(() => assertProductionApiUrl("ftp://api.example.com")).toThrow(/http\(s\)/);
  });

  it("accepts a public https origin", () => {
    expect(assertProductionApiUrl("https://api.example.com")).toBe("https://api.example.com");
    expect(assertProductionApiUrl(" https://api.example.com/v1 ")).toBe(
      "https://api.example.com/v1",
    );
  });
});
