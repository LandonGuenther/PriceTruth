import type { TabState } from "../messages.js";
import { COPY } from "./copy.js";
import {
  ConfidenceBlock,
  EmptyStates,
  Header,
  HistoryChart,
  PriceSummary,
  ProductHeading,
  Reasons,
  ScoreCards,
  StatsTable,
} from "./components.js";

export function Panel({
  state,
  onRetry,
}: {
  state: TabState;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <div className="panel">
      <Header />
      {state.status === "idle" && <EmptyStates kind="idle" />}
      {state.status === "unsupported" && <EmptyStates kind="unsupported" reason={state.reason} />}
      {state.status === "ambiguous" && <EmptyStates kind="ambiguous" message={state.message} />}
      {state.status === "loading" && (
        <>
          <ProductHeading observation={state.observation} />
          <EmptyStates kind="loading" />
        </>
      )}
      {state.status === "error" && (
        <>
          {state.observation && <ProductHeading observation={state.observation} />}
          <EmptyStates kind="error" message={state.message} onRetry={onRetry} />
        </>
      )}
      {state.status === "ready" && (
        <>
          <ProductHeading observation={state.observation} />
          <PriceSummary analysis={state.analysis} />
          {state.analysis.confidence.level === "INSUFFICIENT" && (
            <div className="notice">
              {COPY.insufficientNotice(state.analysis.stats.observationCount)}
            </div>
          )}
          <HistoryChart
            history={state.history}
            currentCents={state.analysis.currentPriceCents}
            recordedLowCents={state.analysis.stats.recordedLowCents}
          />
          <StatsTable analysis={state.analysis} />
          <ScoreCards analysis={state.analysis} />
          <Reasons analysis={state.analysis} />
          <ConfidenceBlock analysis={state.analysis} />
        </>
      )}
    </div>
  );
}
