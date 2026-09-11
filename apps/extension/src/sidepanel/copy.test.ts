import { describe, expect, it } from "vitest";
import { COPY } from "./copy.js";

const FORBIDDEN = [/scam/i, /fraud/i, /fake/i, /illegal/i, /deceptive/i, /all-time low/i];

describe("copy", () => {
  it("never uses forbidden words", () => {
    const texts: string[] = [];
    for (const v of Object.values(COPY)) {
      texts.push(typeof v === "function" ? (v as (...a: unknown[]) => string)("HIGH") : v);
    }
    for (const t of texts) {
      for (const w of FORBIDDEN) expect(t).not.toMatch(w);
    }
  });
});
