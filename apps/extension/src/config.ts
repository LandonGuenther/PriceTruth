/**
 * Build-time API base URL for the extension.
 *
 * Dev default is localhost. Production packaging (`pnpm package`) must set
 * `VITE_API_BASE_URL` to a non-localhost origin - see
 * `scripts/assert-production-api-url.ts`. Local `build` / `write-manifest`
 * may still use the localhost default.
 */
export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:3000";
