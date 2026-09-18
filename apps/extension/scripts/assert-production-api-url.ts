/**
 * Gate for `pnpm package`: production zips must target a real API origin.
 * Local builds (`write-manifest` / `vite build`) may still use localhost.
 */
export function assertProductionApiUrl(url: string | undefined | null): string {
  if (url === undefined || url === null || String(url).trim() === "") {
    throw new Error(
      "VITE_API_BASE_URL is required for packaging a production extension. " +
        "Set it to the deployed API origin (localhost is not allowed).",
    );
  }
  const trimmed = String(url).trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`VITE_API_BASE_URL is not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `VITE_API_BASE_URL must be an https URL for production packaging (got ${trimmed})`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    throw new Error(
      `VITE_API_BASE_URL must not point at localhost for production packaging (got ${trimmed}). ` +
        "Set it to the deployed API origin.",
    );
  }
  return trimmed;
}
