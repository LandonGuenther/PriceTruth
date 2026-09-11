import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnalysisResponse, HistoryResponse, RetailerObservation } from "@pricetruth/shared";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { Panel } from "./Panel.js";
import type { TabState } from "../messages.js";

const observation: RetailerObservation = {
  retailer: "amazon",
  externalId: "B0DEMOASIN",
  url: "https://www.amazon.com/dp/B0DEMOASIN",
  title: "Acme Demo Widget 3000",
  priceCents: 29900,
  referencePriceCents: 49900,
  currency: "USD",
  source: OBSERVATION_SOURCES.EXTENSION_CONTENT_SCRIPT,
  observedAt: "2025-06-30T12:00:00.000Z",
};

const analysis: AnalysisResponse = {
  retailer: "amazon",
  externalId: "B0DEMOASIN",
  title: "Acme Demo Widget 3000",
  url: observation.url,
  currency: "USD",
  currentPriceCents: 29900,
  referencePriceCents: 49900,
  observedAt: observation.observedAt,
  typical: { cents: 31900, window: "90d" },
  stats: {
    observationCount: 180,
    uniqueDays: 180,
    coverageDays: 180,
    newestObservedAt: observation.observedAt,
    oldestObservedAt: "2025-01-02T12:00:00.000Z",
    median30Cents: 31900,
    median90Cents: 31900,
    median180Cents: 31900,
    medianAllCents: 31900,
    low90Cents: 25900,
    low180Cents: 25900,
    recordedLowCents: 25900,
    recordedHighCents: 34900,
    pricePercentile: 0.6,
    shareAtOrBelowCurrent: 1.1,
    referencePricePercentile: 100,
    shareNearReference: 0,
  },
  confidence: { level: "HIGH", reasons: [] },
  discountIntegrity: {
    score: 9,
    label: "Reference price not supported by our observations",
    reasons: ["The advertised $499.00 reference price is above 100% of observed prices."],
    advertisedDiscountPct: 40.1,
    actualDiscountVsTypicalPct: 6.3,
  },
  dealScore: {
    score: 78,
    label: "Better than typical",
    reasons: ["180 observations across 180 days."],
  },
  computedAt: "2025-06-30T12:00:00.000Z",
};

const history: HistoryResponse = {
  retailer: "amazon",
  externalId: "B0DEMOASIN",
  days: 180,
  points: [],
  daily: [
    { day: "2025-06-29", medianPriceCents: 31900 },
    { day: "2025-06-30", medianPriceCents: 29900 },
  ],
};

const ready: TabState = {
  status: "ready",
  observation,
  analysis,
  history,
  ingest: { accepted: true, duplicate: false },
  updatedAt: "2025-06-30T12:00:00.000Z",
};

afterEach(cleanup);

describe("Panel", () => {
  it("ready state shows price, advertised discount, scores and labels", () => {
    render(<Panel state={ready} />);
    expect(screen.getByText("Acme Demo Widget 3000")).toBeTruthy();
    expect(screen.getByText("$299.00")).toBeTruthy();
    expect(screen.getByText(/40% OFF/)).toBeTruthy();
    expect(screen.getByText(/Was \$499\.00/)).toBeTruthy();
    expect(screen.getByText(/~6\.3% below typical/)).toBeTruthy();
    expect(screen.getByText("9/100")).toBeTruthy();
    expect(screen.getByText("78/100")).toBeTruthy();
    expect(screen.getByText("Reference price not supported by our observations")).toBeTruthy();
    expect(screen.getByText("Better than typical")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("180 observations across 180 days")).toBeTruthy();
    expect(screen.getByText("ASIN B0DEMOASIN", { exact: false })).toBeTruthy();
  });

  it("INSUFFICIENT confidence hides numeric scores and shows the notice", () => {
    const insuff: TabState = {
      ...ready,
      analysis: {
        ...analysis,
        confidence: { level: "INSUFFICIENT", reasons: ["not enough history"] },
        dealScore: { score: null, label: "Limited history", reasons: ["x"] },
        discountIntegrity: {
          ...analysis.discountIntegrity,
          score: null,
          label: "Limited history",
        },
        stats: { ...analysis.stats, observationCount: 1 },
      },
    };
    render(<Panel state={insuff} />);
    expect(screen.queryByText("9/100")).toBeNull();
    expect(screen.queryByText("78/100")).toBeNull();
    expect(screen.queryAllByText(/\/100/)).toHaveLength(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Limited history").length).toBeGreaterThan(0);
    expect(screen.getByText(/has only 1 observation\(s\)/)).toBeTruthy();
  });

  it("idle state prompts to open a supported product page", () => {
    render(<Panel state={{ status: "idle" }} />);
    expect(screen.getByText(/Open a supported product page on Amazon or Best Buy\./)).toBeTruthy();
  });

  it("unsupported state explains, with extra note for no_price", () => {
    render(<Panel state={{ status: "unsupported", retailer: "amazon", reason: "no_price" }} />);
    expect(screen.getByText("This page isn't a supported product page.")).toBeTruthy();
    expect(
      screen.getByText("We couldn't read a price on this page, so nothing was recorded."),
    ).toBeTruthy();
  });

  it("error state shows message and a Retry button", () => {
    let retried = false;
    render(
      <Panel
        state={{
          status: "error",
          observation,
          message: "Could not reach the service.",
          updatedAt: "",
        }}
        onRetry={() => (retried = true)}
      />,
    );
    const btn = screen.getByText("Retry");
    expect(btn).toBeTruthy();
    btn.click();
    expect(retried).toBe(true);
  });
});
