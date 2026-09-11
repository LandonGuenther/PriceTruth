import { describe, expect, it } from "vitest";
import { retailerForHostname } from "./retailers.js";

describe("retailerForHostname", () => {
  it("maps registered hostnames", () => {
    expect(retailerForHostname("www.amazon.com")).toBe("amazon");
    expect(retailerForHostname("amazon.com")).toBe("amazon");
    expect(retailerForHostname("smile.amazon.com")).toBe("amazon");
    expect(retailerForHostname("www.bestbuy.com")).toBe("bestbuy");
  });

  it("maps subdomains and is case-insensitive", () => {
    expect(retailerForHostname("WWW.AMAZON.COM")).toBe("amazon");
    expect(retailerForHostname("foo.bestbuy.com")).toBe("bestbuy");
  });

  it("returns null for unsupported hosts", () => {
    expect(retailerForHostname("www.walmart.com")).toBeNull();
    expect(retailerForHostname("amazon.com.evil.example")).toBeNull();
    expect(retailerForHostname("notamazon.com")).toBeNull();
  });
});
