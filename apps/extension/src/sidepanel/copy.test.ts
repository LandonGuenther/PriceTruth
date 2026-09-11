import { describe, expect, it } from "vitest";
import { COPY, humanizeReason } from "./copy.js";

const FORBIDDEN = [/scam/i, /fraud/i, /fake/i, /illegal/i, /deceptive/i, /all-time low/i];

function collectCopyStrings(): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(COPY)) {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      if (key === "confidenceLabel") {
        out.push(value("HIGH" as never));
        continue;
      }
      try {
        out.push((value as (a: never) => string)(1 as never));
      } catch {
        try {
          out.push((value as (a: never, b: never) => string)(1 as never, 2 as never));
        } catch {
          out.push(
            (value as (a: never, b: never, c: never) => string)(1 as never, "a" as never, "b" as never),
          );
        }
      }
    }
  }
  return out;
}

describe("copy", () => {
  it("never uses forbidden words", () => {
    for (const text of collectCopyStrings()) {
      for (const word of FORBIDDEN) expect(text).not.toMatch(word);
    }
  });

  it("humanizes known reason phrases and passes through unknowns safely", () => {
    expect(humanizeReason("Reference price not supported by history")).toMatch(/rarely/);
    expect(humanizeReason("Current price is below typical")).toMatch(/below/);
    expect(humanizeReason("Custom backend phrase")).toBe("Custom backend phrase");
  });
});
