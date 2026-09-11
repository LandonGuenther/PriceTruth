import { PRODUCT_NAME, RETAILERS, formatCents } from "@pricetruth/shared";
import type { AnalysisResponse, HistoryResponse } from "@pricetruth/shared";
import type { RetailerObservation } from "@pricetruth/shared";
import { COPY } from "./copy.js";

export function Header(): React.JSX.Element {
  return <div className="header">{PRODUCT_NAME}</div>;
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
    storeLine = `${Math.round(advertised)}% OFF · Was ${formatCents(analysis.referencePriceCents, currency)}`;
  }

  let historyLine: string = COPY.typicalRecentPrice;
  if (vsTypical !== null) {
    if (vsTypical >= 1) historyLine = COPY.belowTypical(vsTypical);
    else if (vsTypical <= -1) historyLine = COPY.aboveTypical(Math.abs(vsTypical));
  }

  return (
    <div>
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
    </div>
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
  const points = history.daily;
  if (points.length === 0) return null;

  const W = 360;
  const H = 120;
  const pad = 8;
  const values = points.map((p) => p.medianPriceCents);
  const all = [...values, currentCents, ...(recordedLowCents !== null ? [recordedLowCents] : [])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) * (H - 2 * pad)) / span;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.medianPriceCents).toFixed(1)}`)
    .join(" ");

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Price history">
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
          stroke="#fff"
          strokeWidth="1.5"
        />
        <text x={pad} y={12} fontSize="10" fill="var(--muted)">
          {formatCents(max)}
        </text>
        <text x={pad} y={H - 2} fontSize="10" fill="var(--muted)">
          {formatCents(min)}
        </text>
      </svg>
    </div>
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
    <div>
      {rows.map(([k, v]) => (
        <div className="kv" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v === null ? "—" : formatCents(v, currency)}</span>
        </div>
      ))}
    </div>
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
    <div className="scores">
      {cards.map((c) => (
        <div className="score-card" key={c.name}>
          <div className="name">{c.name}</div>
          <div className="value">{insufficient || c.score === null ? "—" : `${c.score}/100`}</div>
          <span className={`chip ${tier(c.score)}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Reasons({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  const seen = new Set<string>();
  const reasons = [...analysis.discountIntegrity.reasons, ...analysis.dealScore.reasons].filter(
    (r) => (seen.has(r) ? false : (seen.add(r), true)),
  );
  return (
    <div className="section">
      <h3>{COPY.why}</h3>
      <ul className="reasons">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

export function ConfidenceBlock({ analysis }: { analysis: AnalysisResponse }): React.JSX.Element {
  return (
    <div className="section">
      <h3>{COPY.confidence}</h3>
      <div style={{ fontWeight: 600 }}>{COPY.confidenceLabel(analysis.confidence.level)}</div>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        {COPY.observationsAcross(analysis.stats.observationCount, analysis.stats.coverageDays)}
      </div>
    </div>
  );
}

export function EmptyStates({
  kind,
  reason,
  message,
  onRetry,
}: {
  kind: "idle" | "unsupported" | "loading" | "error";
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
      {kind === "error" && (
        <>
          <p>{message}</p>
          {onRetry && (
            <button className="retry" onClick={onRetry}>
              {COPY.retry}
            </button>
          )}
        </>
      )}
    </div>
  );
}
