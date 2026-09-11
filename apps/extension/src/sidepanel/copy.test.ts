import { describe, expect, it } from "vitest";
import { COPY } from "./copy.js";

const FORBIDDEN = [/scam/i, /fraud/i, /fake/i, /illegal/i, /deceptive/i, /all-time low/i];

function sample(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      return [String((value as (a: never, b: never) => string)("HIGH" as never, "x" as never))];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(sample);
  }
  return [];
}

describe("copy", () => {
  it("never uses forbidden words or em dashes", () => {
    const texts = sample(COPY);
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) {
      for (const w of FORBIDDEN) expect(t).not.toMatch(w);
      expect(t).not.toContain("—");
    }
  });

  it("keeps Deal Score and Discount Integrity as separate labels", () => {
    expect(COPY.dealScore).toBe("Deal Score");
    expect(COPY.discountIntegrity).toBe("Discount Integrity");
    expect(COPY.tagline).toBe("Know what it really costs.");
  });
});
