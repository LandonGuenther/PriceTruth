import { useTabState } from "./useTabState.js";
import { Panel } from "./Panel.js";

export function App(): React.JSX.Element {
  const { tabId, state } = useTabState();
  const onRetry =
    tabId !== undefined
      ? () => void chrome.runtime.sendMessage({ type: "pt/retry", tabId })
      : undefined;
  return <Panel state={state} onRetry={onRetry} />;
}
