import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalysisResponse, HistoryResponse, RetailerObservation } from "@pricetruth/shared";
import { OBSERVATION_SOURCES } from "@pricetruth/shared";
import { Panel } from "./Panel.js";
import { buildHistoryPath, filterDailyByWindow } from "./components.js";
import { COPY } from "./copy.js";
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
  schemaVersion: 1,
  priceType: "STANDARD",
  referenceType: "UNKNOWN",
  extractorVersion: "1.0.0",
};

const analysis: AnalysisResponse = {
  retailer: "amazon",
  externalId: "B0DEMOASIN",
  title: "Acme Demo Widget 3000",
  url: observation.url,
  currency: "USD",
  currentPriceCents: 29900,
  referencePriceCents: 49900,
  effectiveAt: observation.observedAt,
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
  evidence: {
    eligibleCount: 180,
    excluded: { synthetic: 0, quarantined: 0, excluded: 0, priceType: 0 },
  },
  computedAt: "2025-06-30T12:00:00.000Z",
};

const history: HistoryResponse = {
  retailer: "amazon",
  externalId: "B0DEMOASIN",
  days: 180,
  points: [],
  daily: [
    { day: "2025-06-01", medianPriceCents: 33000 },
    { day: "2025-06-02", medianPriceCents: 32500 },
    { day: "2025-06-10", medianPriceCents: 31000 },
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

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("history path helpers", () => {
  it("filters daily points by chart window without inventing days", () => {
    const filtered = filterDailyByWindow(history.daily, "30");
    expect(filtered.map((p) => p.day)).toEqual([
      "2025-06-01",
      "2025-06-02",
      "2025-06-10",
      "2025-06-29",
      "2025-06-30",
    ]);
    const short = filterDailyByWindow(
      [
        { day: "2025-01-01", medianPriceCents: 100 },
        { day: "2025-06-20", medianPriceCents: 200 },
        { day: "2025-06-30", medianPriceCents: 300 },
      ],
      "30",
    );
    expect(short.map((p) => p.day)).toEqual(["2025-06-20", "2025-06-30"]);
  });

  it("breaks the SVG path across calendar gaps", () => {
    const pts = [
      { day: "2025-06-01", medianPriceCents: 100 },
      { day: "2025-06-02", medianPriceCents: 110 },
      { day: "2025-06-10", medianPriceCents: 120 },
    ];
    const path = buildHistoryPath(
      pts,
      (i) => i * 10,
      (v) => v,
    );
    expect(path).toBe("M0.0,100.0 L10.0,110.0 M20.0,120.0");
  });
});

describe("Panel", () => {
  it("ready state shows price, advertised discount, scores and labels", () => {
    render(<Panel state={ready} />);
    expect(screen.getByText("Acme Demo Widget 3000")).toBeTruthy();
    expect(screen.getByText("$299.00")).toBeTruthy();
    expect(screen.getByText(/40% off store reference of \$499\.00/)).toBeTruthy();
    expect(screen.getByText(/~6\.3% below typical/)).toBeTruthy();
    expect(screen.getByText("9/100")).toBeTruthy();
    expect(screen.getByText("78/100")).toBeTruthy();
    expect(screen.getByText("Discount Integrity")).toBeTruthy();
    expect(screen.getByText("Deal Score")).toBeTruthy();
    expect(screen.getByText("Reference price not supported by our observations")).toBeTruthy();
    expect(screen.getByText("Better than typical")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("180 observations across 180 days")).toBeTruthy();
    expect(screen.getByText("ASIN B0DEMOASIN", { exact: false })).toBeTruthy();
    expect(screen.getByText(COPY.tagline)).toBeTruthy();
    expect(document.body.textContent).not.toContain("—");
  });

  it("INSUFFICIENT confidence shows learning card and hides ScoreCards", () => {
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
        stats: {
          ...analysis.stats,
          observationCount: 1,
          oldestObservedAt: "2025-06-28T12:00:00.000Z",
          median30Cents: null,
          median90Cents: null,
          median180Cents: null,
          low90Cents: null,
          recordedLowCents: null,
        },
      },
    };
    render(<Panel state={insuff} />);
    expect(screen.getByRole("heading", { name: COPY.learningTitle })).toBeTruthy();
    expect(screen.getByText(COPY.learningBody)).toBeTruthy();
    expect(screen.getByText("1 observation so far")).toBeTruthy();
    expect(screen.getByText(/First observed/)).toBeTruthy();
    expect(screen.queryByText("9/100")).toBeNull();
    expect(screen.queryByText("78/100")).toBeNull();
    expect(screen.queryByText("0/100")).toBeNull();
    expect(screen.queryAllByText(/\/100/)).toHaveLength(0);
    expect(screen.queryByText("Discount Integrity")).toBeNull();
    expect(screen.queryByText("Deal Score")).toBeNull();
    expect(document.body.textContent).not.toContain("—");
    expect(screen.getByText(COPY.notEnoughData)).toBeTruthy();
  });

  it("history chart offers window controls and an accessible table fallback", () => {
    render(<Panel state={ready} />);
    const group = screen.getByRole("group", { name: COPY.chartWindowGroup });
    expect(within(group).getByRole("button", { name: "30D" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "90D" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "180D" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "ALL" })).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "30D" }));
    expect(within(group).getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText(COPY.historyTableSummary)).toBeTruthy();
    expect(screen.getByText("2025-06-30")).toBeTruthy();
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
          kind: "network",
        }}
        onRetry={() => (retried = true)}
      />,
    );
    const btn = screen.getByRole("button", { name: "Retry" });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(retried).toBe(true);
  });

  it("ambiguous state explains that nothing was recorded", () => {
    render(
      <Panel
        state={{
          status: "ambiguous",
          retailer: "bestbuy",
          url: "https://www.bestbuy.com/site/x/1.p",
          warnings: [],
          message: COPY.ambiguous,
        }}
      />,
    );
    expect(screen.getByText(COPY.ambiguous)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/ambiguous/i);
  });

  it("exposes a Diagnostics toggle hidden by default", () => {
    render(<Panel state={ready} />);
    const toggle = screen.getByRole("button", { name: COPY.diagnostics });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(COPY.diagnosticsApiBase)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(COPY.diagnosticsApiBase)).toBeTruthy();
    expect(screen.getByText("amazon")).toBeTruthy();
    expect(screen.getByText("B0DEMOASIN")).toBeTruthy();
    expect(screen.getByText("1.0.0")).toBeTruthy();
  });

  it("feedback looks-right and report-issue store a local session note only", () => {
    render(<Panel state={ready} />);
    expect(screen.getByText(COPY.feedbackPrompt)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: COPY.feedbackReport }));
    const raw = sessionStorage.getItem("pt:price-feedback");
    expect(raw).toBeTruthy();
    const note = JSON.parse(raw!) as {
      kind: string;
      retailer: string;
      externalId: string;
      displayedCents: number;
      version: string;
    };
    expect(note.kind).toBe("report");
    expect(note.retailer).toBe("amazon");
    expect(note.externalId).toBe("B0DEMOASIN");
    expect(note.displayedCents).toBe(29900);
    expect(typeof note.version).toBe("string");
    expect(screen.getByText(COPY.feedbackReported)).toBeTruthy();
  });

  it("renders HTML-ish product titles as text (XSS-safe)", () => {
    const evilTitle = `<img src=x onerror="window.__pt_xss=1"><script>window.__pt_xss=1</script>`;
    const evil: TabState = {
      ...ready,
      observation: { ...observation, title: evilTitle },
      analysis: { ...analysis, title: evilTitle },
    };
    render(<Panel state={evil} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(evilTitle);
    expect(heading.querySelector("img")).toBeNull();
    expect(heading.querySelector("script")).toBeNull();
    expect((window as unknown as { __pt_xss?: number }).__pt_xss).toBeUndefined();
  });

  it("announces status changes in a live region", () => {
    render(<Panel state={ready} />);
    expect(screen.getByRole("status").textContent).toBe(COPY.statusReady);
  });
});
