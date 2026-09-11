import type { TrustClass } from "@pricetruth/shared";

const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedObservationTime {
  effectiveAt: Date;
  clientSkewSeconds: number | null;
  /** Set when the client-reported time is unacceptable; caller rejects. */
  rejectReason?: string;
}

/**
 * Time provenance policy (pure, no I/O).
 * - CLIENT_REPORTED: the client clock is untrusted — `effectiveAt` is the
 *   server receipt time, client skew is recorded for monitoring, and a wildly
 *   wrong clientObservedAt (>10min future / >7d old) yields `rejectReason`.
 * - SERVER_FETCHED / VERIFIED / TEST: the reporter is trusted — `effectiveAt`
 *   is the reported time when present, else receipt time.
 */
export function resolveObservationTime(input: {
  trustClass: TrustClass;
  clientObservedAt: Date | null;
  receivedAt: Date;
}): ResolvedObservationTime {
  const { trustClass, clientObservedAt, receivedAt } = input;

  if (trustClass === "CLIENT_REPORTED") {
    if (clientObservedAt !== null) {
      const skewMs = clientObservedAt.getTime() - receivedAt.getTime();
      if (skewMs > MAX_FUTURE_MS) {
        return {
          effectiveAt: receivedAt,
          clientSkewSeconds: null,
          rejectReason: "observedAt is more than 10 minutes in the future",
        };
      }
      if (skewMs < -MAX_AGE_MS) {
        return {
          effectiveAt: receivedAt,
          clientSkewSeconds: null,
          rejectReason: "observedAt is older than 7 days",
        };
      }
      return { effectiveAt: receivedAt, clientSkewSeconds: Math.round(skewMs / 1000) };
    }
    return { effectiveAt: receivedAt, clientSkewSeconds: null };
  }

  return {
    effectiveAt: clientObservedAt ?? receivedAt,
    clientSkewSeconds: null,
  };
}
