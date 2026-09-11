import { describe, expect, it } from "vitest";
import {
  ELIGIBLE_PRICE_TYPES,
  ELIGIBLE_STATUSES,
  ineligibilityReason,
  isEligibleForAnalysis,
} from "./eligibility.js";

describe("eligibility", () => {
  it("ACCEPTED + STANDARD is eligible", () => {
    const o = { status: "ACCEPTED", synthetic: false, priceType: "STANDARD" };
    expect(isEligibleForAnalysis(o)).toBe(true);
    expect(ineligibilityReason(o)).toBeNull();
  });

  it("CORROBORATED + SALE is eligible", () => {
    expect(
      isEligibleForAnalysis({ status: "CORROBORATED", synthetic: false, priceType: "SALE" }),
    ).toBe(true);
  });

  it("QUARANTINED / EXCLUDED / synthetic / non-eligible priceType each map to a reason", () => {
    expect(
      ineligibilityReason({ status: "QUARANTINED", synthetic: false, priceType: "STANDARD" }),
    ).toBe("status_quarantined");
    expect(
      ineligibilityReason({ status: "EXCLUDED", synthetic: false, priceType: "STANDARD" }),
    ).toBe("status_excluded");
    expect(
      ineligibilityReason({ status: "ACCEPTED", synthetic: true, priceType: "STANDARD" }),
    ).toBe("synthetic");
    expect(ineligibilityReason({ status: "ACCEPTED", synthetic: false, priceType: "USED" })).toBe(
      "price_type",
    );
    expect(
      ineligibilityReason({ status: "ACCEPTED", synthetic: false, priceType: "UNKNOWN" }),
    ).toBe("price_type");
  });

  it("reason precedence: synthetic first, then status, then priceType", () => {
    expect(ineligibilityReason({ status: "QUARANTINED", synthetic: true, priceType: "USED" })).toBe(
      "synthetic",
    );
    expect(
      ineligibilityReason({ status: "QUARANTINED", synthetic: false, priceType: "USED" }),
    ).toBe("status_quarantined");
  });

  it("constants are the canonical lists", () => {
    expect(ELIGIBLE_STATUSES).toEqual(["ACCEPTED", "CORROBORATED"]);
    expect(ELIGIBLE_PRICE_TYPES).toEqual(["STANDARD", "SALE"]);
  });
});
