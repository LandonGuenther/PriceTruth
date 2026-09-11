import { useId, useMemo, useState } from "react";
import { PRODUCT_NAME, RETAILERS, formatCents } from "@pricetruth/shared";
import type { AnalysisResponse, HistoryResponse, RetailerObservation } from "@pricetruth/shared";
import type { ExtractionMeta, TabState } from "../messages.js";
import { COPY, humanizeReason } from "./copy.js";

export function Header({ tagline = false }: { tagline?: boolean }): React.JSX.Element {
  return (
    <header className="header">
      <div className="header-brand">{PRODUCT_NAME}</div>
      {tagline ? <div className="header-tagline">{COPY.tagline}</div> : null}
    </header>
  );
}

export function ProductHeading({
  observation,
}: {
  observation: Pick<RetailerObservation, "retailer" | "externalId" | "title">;
}): React.JSX.Element {
  const retailer = RETAILERS[observation.retailer];
  return (
    <div className="product">
      <h1 className="title">{observation.title}</h1>
      <div className="subtitle">
        {retailer.displayName} · {retailer.identifierLabel} {observation.externalId}
      </div>
    </div>
  );
}

export function LiveRegion({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {COPY.liveStatus}: {text}
    </div>
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
    if (vsTypical >= 1) historyLine = COPY.belowTypical(Math.round(vsTypical));
    else if (vsTypical <= -1) historyLine = COPY.aboveTypical(Math.round(Math.abs(vsTypical)));
  }

  return (
    <section className="price-summary" aria-label="Today's price">
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

export function InsufficientCard({
  observationCount,
  currentCents,
  currency,
  oldestObservedAt,
}: {
  observationCount: number;
  currentCents: number;
  currency: string;
  oldestObservedAt: string | null;
}): React.JSX.Element {
  const first =
    oldestObservedAt !== null
      ? new Date(oldestObservedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;
  return (
    <section className="learning-card" aria-label={COPY.insufficientTitle}>
      <h2 className="learning-title">{COPY.insufficientTitle}</h2>
      <p className="learning-body">{COPY.insufficientBody(observationCount)}</p>
      <div className="kv">
        <span className="k">{COPY.today}</span>
        <span className="v">{formatCents(currentCents, currency)}</span>
      </div>
      <div className="kv">
        <span className="k">Observed days</span>
        <span className="v">{observationCount}</span>
      </div>
      {first ? (
        <div className="kv">
          <span className="k">First observed</span>
          <span className="v">{first}</span>
        </div>
      ) : null}
    </section>
  );
}

export type ChartWindow = 30 | 90 | 180 | 0;

function filterDaily(daily: HistoryResponse["daily"], windowDays: ChartWindow) {
  if (windowDays === 0 || daily.length === 0) return daily;
  const last = daily[daily.length - 1];
  if (!last) return daily;
  const end = Date.parse(`${last.day}T00:00:00.000Z`);
  const start = end - (windowDays - 1) * 86_400_000;
  return daily.filter((p) => Date.parse(`${p.day}T00:00:00.000Z`) >= start);
}

/** Gap-aware chart: does not interpolate across missing calendar days. */
export function HistoryChart({
  history,
  currentCents,
  recordedLowCents,
  typicalCents = null,
}: {
  history: HistoryResponse;
  currentCents: number;
  recordedLowCents: number | null;
  typicalCents?: number | null;
}): React.JSX.Element | null {
  const [windowDays, setWindowDays] = useState<ChartWindow>(90);
  const points = useMemo(() => filterDaily(history.daily, windowDays), [history.daily, windowDays]);
  const labelId = useId();

  if (history.daily.length === 0) return null;

  const W = 360;
  const H = 120;
  const pad = 8;
  const values = points.map((p) => p.medianPriceCents);
  const extras = [
    currentCents,
    ...(recordedLowCents !== null ? [recordedLowCents] : []),
    ...(typicalCents != null ? [typicalCents] : []),
  ];
  const all = [...values, ...extras];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) * (H - 2 * pad)) / span;

  const segments: string[] = [];
  let segment = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const prev = points[i - 1];
    const gap =
      prev !== undefined &&
      Date.parse(`${p.day}T00:00:00.000Z`) - Date.parse(`${prev.day}T00:00:00.000Z`) >
        86_400_000 * 1.5;
    const cmd = `${segment === "" || gap ? "M" : "L"}${x(i).toFixed(1)},${y(p.medianPriceCents).toFixed(1)}`;
    if (gap && segment) {
      segments.push(segment);
      segment = cmd;
    } else {
      segment = segment ? `${segment} ${cmd}` : cmd;
    }
  }
  if (segment) segments.push(segment);

  const summary = COPY.chartSummary(points.length, formatCents(min), formatCents(max));
  const windows: Array<{ id: ChartWindow; label: string }> = [
    { id: 30, label: COPY.window30 },
    { id: 90, label: COPY.window90 },
    { id: 180, label: COPY.window180 },
    { id: 0, label: COPY.windowAll },
  ];

  return (
    <section className="chart" aria-labelledby={labelId}>
      <div className="chart-toolbar">
        <h3 id={labelId}>{COPY.chartWindow}</h3>
        <div className="chart-windows" role="tablist" aria-label={COPY.chartWindow}>
          {windows.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={windowDays === w.id}
              className={windowDays === w.id ? "window active" : "window"}
              onClick={() => setWindowDays(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary}>
        {typicalCents != null ? (
          <line
            x1={pad}
            x2={W - pad}
            y1={y(typicalCents)}
            y2={y(typicalCents)}
            stroke="var(--muted)"
            strokeDasharray="2 4"
            strokeWidth="1"
          />
        ) : null}
        {recordedLowCents !== null ? (
          <line
            x1={pad}
            x2={W - pad}
            y1={y(recordedLowCents)}
            y2={y(recordedLowCents)}
            stroke="var(--muted)"
            strokeDasharray="4 3"
            strokeWidth="1"
          />
        ) : null}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
        ))}
        {points.length > 0 ? (
          <circle
            cx={x(points.length - 1)}
            cy={y(currentCents)}
            r="4"
            fill="var(--accent)"
            stroke="#fff"
            strokeWidth="1.5"
          />
        ) : null}
        <text x={pad} y={12} fontSize="10" fill="var(--muted)">
          {formatCents(max)}
        </text>
        <text x={pad} y={H - 2} fontSize="10" fill="var(--muted)">
          {formatCents(min)}
        </text>
      </svg>
      <details className="chart-table">
        <summary>Daily prices (accessible table)</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Median</th>
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
          <span className="v">{v === null ? "-" : formatCents(v, currency)}</span>
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

export function ScoreCards({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  const insufficient = analysis.confidence.level === "INSUFFICIENT";
  const cards = [
    { name: COPY.discountIntegrity, ...analysis.discountIntegrity },
    { name: COPY.dealScore, ...analysis.dealScore },
  ];
  return (
    <section className="scores" aria-label="Scores">
      {cards.map((c) => (
        <div className="score-card" key={c.name}>
          <div className="name">{c.name}</div>
          <div className="value">{insufficient || c.score === null ? "-" : `${c.score}/100`}</div>
          <span className={`chip ${tier(c.score)}`}>{c.label}</span>
        </div>
      ))}
    </section>
  );
}

export function Reasons({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  const seen = new Set<string>();
  const reasons = [...analysis.discountIntegrity.reasons, ...analysis.dealScore.reasons]
    .map(humanizeReason)
    .filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
  if (reasons.length === 0) return <></>;
  return (
    <section className="section">
      <h3>{COPY.why}</h3>
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
      <h3>{COPY.confidence}</h3>
      <div className="confidence-level">{COPY.confidenceLabel(analysis.confidence.level)}</div>
      <div className="confidence-meta">
        {COPY.observationsAcross(analysis.stats.observationCount, analysis.stats.coverageDays)}
      </div>
    </section>
  );
}

export function DiagnosticsPanel({
  state,
  open,
}: {
  state: TabState;
  open: boolean;
}): React.JSX.Element | null {
  if (!open) return null;
  const extraction: ExtractionMeta | undefined =
    state.status === "idle" ? undefined : "extraction" in state ? state.extraction : undefined;

  let retailer = "-";
  let externalId = "-";
  if (state.status === "ready" || state.status === "loading") {
    retailer = state.observation.retailer;
    externalId = state.observation.externalId;
  } else if (state.status === "unsupported") {
    retailer = state.retailer ?? "-";
  } else if (state.status === "ambiguous") {
    retailer = state.observation?.retailer ?? "-";
    externalId = state.observation?.externalId ?? "-";
  } else if (state.status === "error" && state.observation) {
    retailer = state.observation.retailer;
    externalId = state.observation.externalId;
  }

  const generation =
    state.status === "ready" || state.status === "loading" || state.status === "error"
      ? String(state.generation ?? "-")
      : "-";

  const rows: Array<[string, string]> = [
    ["Panel status", state.status],
    ["Retailer", retailer],
    ["External ID", externalId],
    ["Adapter", extraction?.adapterVersion ?? "-"],
    ["Identity method", extraction?.identityMethod ?? "-"],
    ["Price method", extraction?.priceMethod ?? "-"],
    ["Reference method", extraction?.referenceMethod ?? "-"],
    ["Price confidence", extraction?.priceConfidence ?? "-"],
    ["Warnings", extraction?.warnings?.length ? extraction.warnings.join("; ") : "-"],
    ["Generation", generation],
  ];

  return (
    <details className="diagnostics" open>
      <summary>{COPY.diagnostics}</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="diag-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function FeedbackBar({
  retailer,
  externalId,
  displayedCents,
  adapterVersion,
}: {
  retailer: string;
  externalId: string;
  displayedCents: number;
  adapterVersion?: string;
}): React.JSX.Element {
  const [done, setDone] = useState<"yes" | "no" | null>(null);
  const report = () => {
    const payload = {
      retailer,
      externalId,
      displayedPriceCents: displayedCents,
      adapterVersion: adapterVersion ?? null,
      at: new Date().toISOString(),
    };
    try {
      const key = "pt:local-feedback";
      const prev = JSON.parse(sessionStorage.getItem(key) ?? "[]") as unknown[];
      prev.push(payload);
      sessionStorage.setItem(key, JSON.stringify(prev.slice(-20)));
    } catch {
      // Best-effort local-only feedback.
    }
    setDone("no");
  };
  return (
    <section className="feedback" aria-label={COPY.feedbackPrompt}>
      <div className="feedback-prompt">{COPY.feedbackPrompt}</div>
      {done === null ? (
        <div className="feedback-actions">
          <button type="button" className="feedback-btn" onClick={() => setDone("yes")}>
            {COPY.feedbackYes}
          </button>
          <button type="button" className="feedback-btn secondary" onClick={report}>
            {COPY.feedbackNo}
          </button>
        </div>
      ) : (
        <p className="feedback-thanks">{COPY.feedbackThanks}</p>
      )}
    </section>
  );
}

export function EmptyStates({
  kind,
  reason,
  message,
  phase,
  onRetry,
}: {
  kind: "idle" | "unsupported" | "loading" | "error" | "ambiguous";
  reason?: string;
  message?: string;
  phase?: "submitting" | "analyzing";
  onRetry?: () => void;
}): React.JSX.Element {
  if (kind === "loading") {
    const label =
      phase === "analyzing"
        ? COPY.loadingAnalyze
        : phase === "submitting"
          ? COPY.loadingSubmit
          : COPY.loading;
    return (
      <div className="skeleton" role="status" aria-live="polite">
        {label}
      </div>
    );
  }
  if (kind === "ambiguous") {
    return (
      <div className="empty">
        <h2 className="empty-title">{COPY.ambiguousTitle}</h2>
        <p>{message ?? COPY.ambiguousBody}</p>
      </div>
    );
  }
  return (
    <div className="empty">
      {kind === "idle" ? <p>{COPY.idle}</p> : null}
      {kind === "unsupported" ? (
        <>
          <p>{COPY.unsupported}</p>
          {reason === "no_price" || reason === "ambiguous_price" ? <p>{COPY.noPrice}</p> : null}
        </>
      ) : null}
      {kind === "error" ? (
        <>
          <p>{message}</p>
          {onRetry ? (
            <button className="retry" type="button" onClick={onRetry}>
              {COPY.retry}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
