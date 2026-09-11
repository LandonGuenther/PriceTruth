import type { TabState } from "../messages.js";
import {
  ConfidenceBlock,
  DiagnosticsPanel,
  EmptyStates,
  Feedback,
  Header,
  HistoryChart,
  LearningCard,
  LiveStatus,
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
  const insufficient =
    state.status === "ready" && state.analysis.confidence.level === "INSUFFICIENT";

  return (
    <div className="panel">
      <Header />
      <LiveStatus state={state} />
      {state.status === "idle" && <EmptyStates kind="idle" />}
      {state.status === "unsupported" && (
        <EmptyStates kind="unsupported" reason={state.reason} />
      )}
      {state.status === "ambiguous" && (
        <EmptyStates kind="ambiguous" message={state.message} />
      )}
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
          {insufficient && <LearningCard analysis={state.analysis} />}
          <HistoryChart
            history={state.history}
            currentCents={state.analysis.currentPriceCents}
            recordedLowCents={state.analysis.stats.recordedLowCents}
          />
          <StatsTable analysis={state.analysis} />
          <ScoreCards analysis={state.analysis} />
          <Reasons analysis={state.analysis} />
          <ConfidenceBlock analysis={state.analysis} />
          <Feedback
            observation={state.observation}
            displayedCents={state.analysis.currentPriceCents}
          />
        </>
      )}
      <DiagnosticsPanel state={state} />
    </div>
  );
}
