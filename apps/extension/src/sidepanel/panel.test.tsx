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
  generation: 1,
};

afterEach(cleanup);

describe("Panel", () => {
  it("ready state shows price, advertised discount, scores and labels", () => {
    render(<Panel state={ready} />);
    expect(screen.getByText("Acme Demo Widget 3000")).toBeTruthy();
    expect(screen.getAllByText("$299.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/40% off store reference of \$499\.00/)).toBeTruthy();
    expect(screen.getByText(/~6% below typical recent price/)).toBeTruthy();
    expect(screen.getByText("9/100")).toBeTruthy();
    expect(screen.getByText("78/100")).toBeTruthy();
    expect(screen.getByText("Reference price not supported by our observations")).toBeTruthy();
    expect(screen.getByText("Better than typical")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("180 observations across 180 days")).toBeTruthy();
    expect(screen.getByText(/ASIN B0DEMOASIN/)).toBeTruthy();
  });

  it("INSUFFICIENT confidence shows learning card and hides numeric scores", () => {
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
    expect(screen.getByRole("heading", { name: /still learning this product/i })).toBeTruthy();
    expect(screen.getByText(/1 observation\(s\) so far/i)).toBeTruthy();
  });

  it("idle state prompts to open a supported product page", () => {
    render(<Panel state={{ status: "idle" }} />);
    expect(
      screen.getAllByText(/Open a supported product page on Amazon or Best Buy\./).length,
    ).toBeGreaterThan(0);
  });

  it("unsupported state explains, with extra note for no_price", () => {
    render(<Panel state={{ status: "unsupported", retailer: "amazon", reason: "no_price" }} />);
    expect(screen.getByText("This page isn't a supported product page.")).toBeTruthy();
    expect(screen.getByText(/couldn'?t confidently read a purchase price/i)).toBeTruthy();
  });

  it("ambiguous state explains without scores", () => {
    render(
      <Panel
        state={{
          status: "ambiguous",
          observation: { retailer: "amazon", url: observation.url, title: observation.title },
          message: "Price looks ambiguous on this page.",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: /Price looks ambiguous/i })).toBeTruthy();
    expect(screen.queryByText(/\/100/)).toBeNull();
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
          kind: "network",
        }}
        onRetry={() => {
          retried = true;
        }}
      />,
    );
    const btn = screen.getByText("Retry");
    expect(btn).toBeTruthy();
    btn.click();
    expect(retried).toBe(true);
  });

  it("HTML-like titles render as text, not HTML", () => {
    render(
      <Panel
        state={{
          ...ready,
          observation: { ...observation, title: "<script>alert(1)</script> Safe Title" },
        }}
      />,
    );
    expect(screen.getByText("<script>alert(1)</script> Safe Title")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("loading state announces submitting phase", () => {
    render(
      <Panel
        state={{
          status: "loading",
          observation,
          phase: "submitting",
          generation: 2,
        }}
      />,
    );
    expect(screen.getAllByText(/Saving today/i).length).toBeGreaterThan(0);
  });

  it("loading analyzing phase shows history check copy", () => {
    render(
      <Panel
        state={{
          status: "loading",
          observation,
          phase: "analyzing",
          generation: 3,
        }}
      />,
    );
    expect(screen.getAllByText(/Checking price history/i).length).toBeGreaterThan(0);
  });

  it("network error kind still exposes Retry", () => {
    render(
      <Panel
        state={{
          status: "error",
          observation,
          message: "Could not reach the PriceTruth service.",
          updatedAt: "",
          kind: "network",
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.getAllByText(/Could not reach/i).length).toBeGreaterThan(0);
  });

  it("unknown reason codes still render without crashing", () => {
    render(
      <Panel
        state={{
          ...ready,
          analysis: {
            ...analysis,
            discountIntegrity: {
              ...analysis.discountIntegrity,
              reasons: ["FUTURE_REASON_CODE_XYZ", "Reference price not supported by history"],
            },
            dealScore: {
              ...analysis.dealScore,
              reasons: ["SOME_NEW_BACKEND_CODE"],
            },
          },
        }}
      />,
    );
    expect(screen.getByText("FUTURE_REASON_CODE_XYZ")).toBeTruthy();
    expect(screen.getByText("SOME_NEW_BACKEND_CODE")).toBeTruthy();
    expect(screen.getByText(/rarely/i)).toBeTruthy();
  });

  it("diagnostics toggle control is present", () => {
    render(<Panel state={ready} />);
    expect(screen.getByText(/Diagnostics/i)).toBeTruthy();
  });

  it("feedback controls are present on ready state", () => {
    render(<Panel state={ready} />);
    expect(screen.getByText(/Is this price correct/i)).toBeTruthy();
  });
});
