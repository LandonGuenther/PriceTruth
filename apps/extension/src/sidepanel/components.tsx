import { useEffect, useMemo, useState } from "react";
import { PRODUCT_NAME, RETAILERS, formatCents } from "@pricetruth/shared";
import type { AnalysisResponse, HistoryResponse } from "@pricetruth/shared";
import type { RetailerObservation } from "@pricetruth/shared";
import { API_BASE_URL } from "../config.js";
import { DIAGNOSTICS_KEY, type TabState } from "../messages.js";
import { COPY } from "./copy.js";

export type ChartWindow = "30" | "90" | "180" | "all";

const CHART_WINDOWS: Array<{ id: ChartWindow; label: string; days: number | null }> = [
  { id: "30", label: COPY.chartWindows.d30, days: 30 },
  { id: "90", label: COPY.chartWindows.d90, days: 90 },
  { id: "180", label: COPY.chartWindows.d180, days: 180 },
  { id: "all", label: COPY.chartWindows.all, days: null },
];

const DAY_MS = 86_400_000;

function dayUtcMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function calendarDaysBetween(a: string, b: string): number {
  return Math.round((dayUtcMs(b) - dayUtcMs(a)) / DAY_MS);
}

export function filterDailyByWindow(
  daily: HistoryResponse["daily"],
  window: ChartWindow,
): HistoryResponse["daily"] {
  if (daily.length === 0) return daily;
  const spec = CHART_WINDOWS.find((w) => w.id === window);
  if (!spec || spec.days === null) return daily;
  const endMs = dayUtcMs(daily[daily.length - 1]!.day);
  const startMs = endMs - (spec.days - 1) * DAY_MS;
  return daily.filter((p) => dayUtcMs(p.day) >= startMs);
}

/** Build an SVG path that breaks (new M) when calendar days skip. */
export function buildHistoryPath(
  points: HistoryResponse["daily"],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const gap = i > 0 && calendarDaysBetween(points[i - 1]!.day, p.day) > 1;
    const cmd = i === 0 || gap ? "M" : "L";
    parts.push(`${cmd}${x(i).toFixed(1)},${y(p.medianPriceCents).toFixed(1)}`);
  }
  return parts.join(" ");
}

function formatObservedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function extensionVersion(): string {
  try {
    return chrome?.runtime?.getManifest?.()?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function Header(): React.JSX.Element {
  return (
    <header className="header">
      <div className="brand">{PRODUCT_NAME}</div>
      <p className="tagline">{COPY.tagline}</p>
    </header>
  );
}

export function LiveStatus({ state }: { state: TabState }): React.JSX.Element {
  let message: string = COPY.statusIdle;
  if (state.status === "unsupported") message = COPY.statusUnsupported;
  else if (state.status === "ambiguous") message = COPY.statusAmbiguous;
  else if (state.status === "loading") message = COPY.statusLoading;
  else if (state.status === "error") message = state.message || COPY.statusError;
  else if (state.status === "ready") {
    message =
      state.analysis.confidence.level === "INSUFFICIENT"
        ? COPY.statusReadyInsufficient
        : COPY.statusReady;
  }
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

export function ProductHeading({
  observation,
}: {
  observation: RetailerObservation;
}): React.JSX.Element {
  const retailer = RETAILERS[observation.retailer];
  return (
    <>
      <h1 className="title">{observation.title}</h1>
      <div className="subtitle">
        {retailer.displayName} · {retailer.identifierLabel} {observation.externalId}
      </div>
    </>
  );
}

export function PriceSummary({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  const currency = analysis.currency;
  const advertised = analysis.discountIntegrity.advertisedDiscountPct;
  const vsTypical = analysis.discountIntegrity.actualDiscountVsTypicalPct;

  let storeLine: string = COPY.noAdvertisedDiscount;
  if (advertised !== null && analysis.referencePriceCents !== null) {
    storeLine = COPY.storeReference(
      Math.round(advertised),
      formatCents(analysis.referencePriceCents, currency),
    );
  }

  let historyLine: string = COPY.typicalRecentPrice;
  if (vsTypical !== null) {
    if (vsTypical >= 1) historyLine = COPY.belowTypical(vsTypical);
    else if (vsTypical <= -1) historyLine = COPY.aboveTypical(Math.abs(vsTypical));
  }

  return (
    <section className="price-summary" aria-label={COPY.today}>
      <div className="kv big">
        <span className="k">{COPY.today}</span>
        <span className="v">{formatCents(analysis.currentPriceCents, currency)}</span>
      </div>
      <div className="kv">
        <span className="k">{COPY.storeSays}</span>
        <span className="v">{storeLine}</span>
      </div>
      <div className="kv">
        <span className="k">{COPY.historySays}</span>
        <span className="v">{historyLine}</span>
      </div>
    </section>
  );
}

export function LearningCard({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  const first = analysis.stats.oldestObservedAt;
  return (
    <section className="learning-card" aria-labelledby="learning-title">
      <h2 id="learning-title" className="learning-title">
        {COPY.learningTitle}
      </h2>
      <p className="learning-body">{COPY.learningBody}</p>
      <ul className="learning-meta">
        <li>{COPY.learningObserved(analysis.stats.observationCount)}</li>
        {first && <li>{COPY.learningFirstSeen(formatObservedDate(first))}</li>}
      </ul>
    </section>
  );
}

export function HistoryChart({
  history,
  currentCents,
  recordedLowCents,
}: {
  history: HistoryResponse;
  currentCents: number;
  recordedLowCents: number | null;
}): React.JSX.Element | null {
  const [window, setWindow] = useState<ChartWindow>("90");
  const points = useMemo(() => filterDailyByWindow(history.daily, window), [history.daily, window]);
  if (history.daily.length === 0) return null;

  const W = 360;
  const H = 120;
  const pad = 8;
  const values = points.map((p) => p.medianPriceCents);
  const all = [...values, currentCents, ...(recordedLowCents !== null ? [recordedLowCents] : [])];
  const min = values.length ? Math.min(...all) : currentCents;
  const max = values.length ? Math.max(...all) : currentCents;
  const span = max - min || 1;

  const x = (i: number) =>
    points.length <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) * (H - 2 * pad)) / span;
  const path = buildHistoryPath(points, x, y);

  return (
    <section className="chart" aria-labelledby="history-heading">
      <div className="chart-toolbar">
        <h2 id="history-heading" className="chart-heading">
          {COPY.historyHeading}
        </h2>
        <div className="chart-windows" role="group" aria-label={COPY.chartWindowGroup}>
          {CHART_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={window === w.id ? "chart-window active" : "chart-window"}
              aria-pressed={window === w.id}
              onClick={() => setWindow(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {points.length > 0 ? (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={COPY.historyChartLabel}>
          {recordedLowCents !== null && (
            <line
              x1={pad}
              x2={W - pad}
              y1={y(recordedLowCents)}
              y2={y(recordedLowCents)}
              stroke="var(--muted)"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
          )}
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle
            cx={x(points.length - 1)}
            cy={y(currentCents)}
            r="4"
            fill="var(--accent)"
            stroke="var(--bg)"
            strokeWidth="1.5"
          />
          <text x={pad} y={12} fontSize="10" fill="var(--muted)">
            {formatCents(max)}
          </text>
          <text x={pad} y={H - 2} fontSize="10" fill="var(--muted)">
            {formatCents(min)}
          </text>
        </svg>
      ) : (
        <p className="chart-empty">{COPY.notEnoughData}</p>
      )}
      <details className="chart-details">
        <summary>{COPY.historyTableSummary}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{COPY.historyDay}</th>
              <th scope="col">{COPY.historyMedian}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{p.day}</td>
                <td>{formatCents(p.medianPriceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function StatsTable({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  const currency = analysis.currency;
  const rows: Array<[string, number | null]> = [
    [COPY.typical30, analysis.stats.median30Cents],
    [COPY.typical90, analysis.stats.median90Cents],
    [COPY.typical180, analysis.stats.median180Cents],
    [COPY.low90, analysis.stats.low90Cents],
    [COPY.recordedLow, analysis.stats.recordedLowCents],
  ];
  return (
    <section className="stats" aria-label="Price statistics">
      {rows.map(([k, v]) => (
        <div className="kv" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v === null ? COPY.notEnoughData : formatCents(v, currency)}</span>
        </div>
      ))}
    </section>
  );
}

function tier(score: number | null): "good" | "warn" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 60) return "good";
  if (score >= 40) return "warn";
  return "neutral";
}

export function ScoreCards({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element | null {
  if (analysis.confidence.level === "INSUFFICIENT") return null;
  const cards = [
    { name: COPY.discountIntegrity, ...analysis.discountIntegrity },
    { name: COPY.dealScore, ...analysis.dealScore },
  ];
  return (
    <div className="scores">
      {cards.map((c) => (
        <div className="score-card" key={c.name}>
          <div className="name">{c.name}</div>
          <div className="value">{c.score === null ? COPY.notEnoughData : `${c.score}/100`}</div>
          <span className={`chip ${tier(c.score)}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Reasons({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element | null {
  if (analysis.confidence.level === "INSUFFICIENT") return null;
  const seen = new Set<string>();
  const reasons = [...analysis.discountIntegrity.reasons, ...analysis.dealScore.reasons].filter(
    (r) => (seen.has(r) ? false : (seen.add(r), true)),
  );
  if (reasons.length === 0) return null;
  return (
    <section className="section">
      <h2>{COPY.why}</h2>
      <ul className="reasons">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </section>
  );
}

export function ConfidenceBlock({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  return (
    <section className="section">
      <h2>{COPY.confidence}</h2>
      <div className="confidence-level">{COPY.confidenceLabel(analysis.confidence.level)}</div>
      <div className="confidence-detail">
        {COPY.observationsAcross(analysis.stats.observationCount, analysis.stats.coverageDays)}
      </div>
    </section>
  );
}

export function Feedback({
  observation,
  displayedCents,
}: {
  observation: RetailerObservation;
  displayedCents: number;
}): React.JSX.Element {
  const [note, setNote] = useState<"right" | "report" | null>(null);

  const save = (kind: "right" | "report") => {
    const payload = {
      kind,
      retailer: observation.retailer,
      externalId: observation.externalId,
      displayedCents,
      version: extensionVersion(),
      at: new Date().toISOString(),
    };
    try {
      sessionStorage.setItem("pt:price-feedback", JSON.stringify(payload));
    } catch {
      // sessionStorage may be unavailable in some extension contexts
    }
    setNote(kind);
  };

  return (
    <section className="feedback" aria-label={COPY.feedbackPrompt}>
      <h2 className="feedback-prompt">{COPY.feedbackPrompt}</h2>
      <div className="feedback-actions">
        <button type="button" className="feedback-btn" onClick={() => save("right")}>
          {COPY.feedbackLooksRight}
        </button>
        <button type="button" className="feedback-btn secondary" onClick={() => save("report")}>
          {COPY.feedbackReport}
        </button>
      </div>
      {note === "right" && <p className="feedback-note">{COPY.feedbackThanks}</p>}
      {note === "report" && <p className="feedback-note">{COPY.feedbackReported}</p>}
    </section>
  );
}

export function DiagnosticsPanel({ state }: { state: TabState }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        if (typeof chrome === "undefined" || !chrome.storage?.session) return;
        const stored = await chrome.storage.session.get(DIAGNOSTICS_KEY);
        if (!cancelled) setOpen(Boolean(stored[DIAGNOSTICS_KEY]));
      } catch {
        // ignore missing chrome in tests
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = (enabled: boolean) => {
    setOpen(enabled);
    try {
      void chrome?.storage?.session?.set?.({ [DIAGNOSTICS_KEY]: enabled });
      void chrome?.runtime?.sendMessage?.({ type: "pt/set-diagnostics", enabled });
    } catch {
      // ignore
    }
  };

  const observation =
    state.status === "ready" || state.status === "loading"
      ? state.observation
      : state.status === "error"
        ? state.observation
        : undefined;
  const generation =
    state.status === "ready" || state.status === "loading"
      ? state.generation
      : state.status === "error"
        ? state.generation
        : undefined;
  const warnings =
    state.status === "ready" ||
    state.status === "loading" ||
    state.status === "unsupported" ||
    state.status === "ambiguous"
      ? (state.warnings ?? [])
      : [];
  const retailer =
    observation?.retailer ??
    (state.status === "unsupported" || state.status === "ambiguous" ? state.retailer : undefined);
  const adapterVersion = observation?.extractorVersion;

  return (
    <footer className="diagnostics-footer">
      <button
        type="button"
        className="diagnostics-toggle"
        aria-expanded={open}
        onClick={() => setEnabled(!open)}
      >
        {open ? COPY.diagnosticsHide : COPY.diagnostics}
      </button>
      {open && (
        <dl className="diagnostics-grid">
          <div>
            <dt>{COPY.diagnosticsStatus}</dt>
            <dd>{state.status}</dd>
          </div>
          <div>
            <dt>{COPY.diagnosticsRetailer}</dt>
            <dd>{retailer ?? COPY.diagnosticsNone}</dd>
          </div>
          <div>
            <dt>{COPY.diagnosticsExternalId}</dt>
            <dd>{observation?.externalId ?? COPY.diagnosticsNone}</dd>
          </div>
          <div>
            <dt>{COPY.diagnosticsGeneration}</dt>
            <dd>{generation ?? COPY.diagnosticsNone}</dd>
          </div>
          <div>
            <dt>{COPY.diagnosticsApiBase}</dt>
            <dd>{API_BASE_URL}</dd>
          </div>
          <div>
            <dt>{COPY.diagnosticsAdapter}</dt>
            <dd>{adapterVersion ?? COPY.diagnosticsNone}</dd>
          </div>
          <div>
            <dt>{COPY.diagnosticsWarnings}</dt>
            <dd>{warnings.length ? warnings.join("; ") : COPY.diagnosticsNone}</dd>
          </div>
        </dl>
      )}
    </footer>
  );
}

export function EmptyStates({
  kind,
  reason,
  message,
  onRetry,
}: {
  kind: "idle" | "unsupported" | "ambiguous" | "loading" | "error";
  reason?: string;
  message?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  if (kind === "loading") {
    return <div className="skeleton">{COPY.loading}</div>;
  }
  return (
    <div className="empty">
      {kind === "idle" && <p>{COPY.idle}</p>}
      {kind === "unsupported" && (
        <>
          <p>{COPY.unsupported}</p>
          {reason === "no_price" && <p>{COPY.noPrice}</p>}
        </>
      )}
      {kind === "ambiguous" && <p>{message ?? COPY.ambiguous}</p>}
      {kind === "error" && (
        <>
          <p>{message}</p>
          {onRetry && (
            <button type="button" className="retry" onClick={onRetry}>
              {COPY.retry}
            </button>
          )}
        </>
      )}
    </div>
  );
}
