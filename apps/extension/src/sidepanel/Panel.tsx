import { useEffect, useState } from "react";
import type { TabState } from "../messages.js";
import { DIAGNOSTICS_KEY } from "../messages.js";
import { COPY } from "./copy.js";
import {
  ConfidenceBlock,
  DiagnosticsPanel,
  EmptyStates,
  FeedbackBar,
  Header,
  HistoryChart,
  InsufficientCard,
  LiveRegion,
  PriceSummary,
  ProductHeading,
  Reasons,
  ScoreCards,
  StatsTable,
} from "./components.js";

function statusAnnouncement(state: TabState): string {
  switch (state.status) {
    case "idle":
      return COPY.idle;
    case "unsupported":
      return COPY.unsupported;
    case "loading":
      return state.phase === "analyzing" ? COPY.loadingAnalyze : COPY.loadingSubmit;
    case "error":
      return state.message;
    case "ambiguous":
      return state.message;
    case "ready":
      return state.analysis.confidence.level === "INSUFFICIENT"
        ? COPY.insufficientTitle
        : `${state.observation.title} analysis ready`;
  }
}

export function Panel({
  state,
  onRetry,
}: {
  state: TabState;
  onRetry?: () => void;
}): React.JSX.Element {
  const [diagnostics, setDiagnostics] = useState(false);

  useEffect(() => {
    const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
    if (!chromeApi?.storage?.session) return;
    let cancelled = false;
    void chromeApi.storage.session.get(DIAGNOSTICS_KEY).then((stored) => {
      if (!cancelled) setDiagnostics(stored[DIAGNOSTICS_KEY] === true);
    });
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "session" || !changes[DIAGNOSTICS_KEY]) return;
      setDiagnostics(changes[DIAGNOSTICS_KEY].newValue === true);
    };
    chromeApi.storage.onChanged.addListener(onChanged as never);
    return () => {
      cancelled = true;
      chromeApi.storage.onChanged.removeListener(onChanged as never);
    };
  }, []);

  const toggleDiagnostics = () => {
    const next = !diagnostics;
    setDiagnostics(next);
    const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
    void chromeApi?.storage?.session?.set({ [DIAGNOSTICS_KEY]: next });
  };

  return (
    <div className="panel">
      <Header tagline={state.status === "idle"} />
      <LiveRegion text={statusAnnouncement(state)} />

      {state.status === "idle" ? <EmptyStates kind="idle" /> : null}

      {state.status === "unsupported" ? (
        <EmptyStates kind="unsupported" reason={state.reason} />
      ) : null}

      {state.status === "ambiguous" ? (
        <>
          {state.observation?.title ? (
            <ProductHeading
              observation={{
                retailer: state.observation.retailer,
                externalId: state.observation.externalId ?? "unknown",
                title: state.observation.title,
              }}
            />
          ) : null}
          <EmptyStates kind="ambiguous" message={state.message} />
        </>
      ) : null}

      {state.status === "loading" ? (
        <>
          <ProductHeading observation={state.observation} />
          <EmptyStates kind="loading" phase={state.phase} />
        </>
      ) : null}

      {state.status === "error" ? (
        <>
          {state.observation ? <ProductHeading observation={state.observation} /> : null}
          <EmptyStates kind="error" message={state.message} onRetry={onRetry} />
        </>
      ) : null}

      {state.status === "ready" ? (
        <>
          <ProductHeading observation={state.observation} />
          <PriceSummary analysis={state.analysis} />
          {state.analysis.confidence.level === "INSUFFICIENT" ? (
            <InsufficientCard
              observationCount={state.analysis.stats.observationCount}
              currentCents={state.analysis.currentPriceCents}
              currency={state.analysis.currency}
              oldestObservedAt={state.analysis.stats.oldestObservedAt}
            />
          ) : null}
          <HistoryChart
            history={state.history}
            currentCents={state.analysis.currentPriceCents}
            recordedLowCents={state.analysis.stats.recordedLowCents}
            typicalCents={state.analysis.typical.cents}
          />
          {state.analysis.confidence.level !== "INSUFFICIENT" ? (
            <>
              <StatsTable analysis={state.analysis} />
              <ScoreCards analysis={state.analysis} />
              <Reasons analysis={state.analysis} />
            </>
          ) : null}
          <ConfidenceBlock analysis={state.analysis} />
          <FeedbackBar
            retailer={state.observation.retailer}
            externalId={state.observation.externalId}
            displayedCents={state.analysis.currentPriceCents}
            adapterVersion={state.extraction?.adapterVersion}
          />
        </>
      ) : null}

      <div className="panel-footer">
        <button type="button" className="linkish" onClick={toggleDiagnostics}>
          {diagnostics ? "Hide diagnostics" : COPY.diagnostics}
        </button>
      </div>
      <DiagnosticsPanel state={state} open={diagnostics} />
    </div>
  );
}
