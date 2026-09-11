import {
  detectCondition,
  GTIN_FAMILY,
  MODEL_FAMILY,
  mpnMatchKey,
  normalizeBrand,
  type NormalizedIdentifier,
} from "./identifiers.js";

export const MATCH_ENGINE_VERSION = "1.0.0";

export type MatchLevel = "EXACT" | "HIGH" | "REVIEW" | "UNRESOLVED" | "CONFLICT";

export interface CandidateListing {
  identifiers: NormalizedIdentifier[];
  brand?: string;
  title: string;
}

export interface ExistingProduct {
  productId: string;
  identifiers: NormalizedIdentifier[];
  brand?: string;
  title: string;
}

export interface MatchDecision {
  level: MatchLevel;
  productId: string | null;
  /** Neutral machine-readable codes, e.g. `gtin_exact:00012345678905`. */
  reasons: string[];
}

/** Auto-link policy: EXACT and HIGH only. */
export function shouldAutoLink(level: MatchLevel): boolean {
  return level === "EXACT" || level === "HIGH";
}

function gtinValues(ids: NormalizedIdentifier[]): NormalizedIdentifier[] {
  return ids.filter((i) => GTIN_FAMILY.has(i.type));
}

function modelKeys(ids: NormalizedIdentifier[]): string[] {
  return ids.filter((i) => MODEL_FAMILY.has(i.type)).map((i) => mpnMatchKey(i.value));
}

/**
 * Deterministic match evaluation. Title similarity is never a signal.
 * Product-side identifiers are assumed already normalized/validated at write.
 */
export function evaluateMatch(
  candidate: CandidateListing,
  existingProducts: ExistingProduct[],
): MatchDecision {
  const reasons: string[] = [];
  const candCondition = detectCondition(candidate.title);

  // Rule 1: known-and-different conditions exclude a product outright.
  const eligible = existingProducts.filter((p) => {
    const pc = detectCondition(p.title);
    if (candCondition !== "UNKNOWN" && pc !== "UNKNOWN" && candCondition !== pc) {
      reasons.push("condition_mismatch");
      return false;
    }
    return true;
  });

  const candGtins = gtinValues(candidate.identifiers);
  const candModelKeys = modelKeys(candidate.identifiers);
  const candBrand = candidate.brand ? normalizeBrand(candidate.brand) : null;

  const gtinMatches = new Map<string, string>(); // productId -> normalized gtin
  const modelMatches = new Map<string, string>(); // productId -> match key
  const weakReasons = new Set<string>();

  for (const p of eligible) {
    const pGtins = new Set(gtinValues(p.identifiers).map((i) => i.value));
    const pModelKeys = new Set(modelKeys(p.identifiers));

    for (const g of candGtins) {
      if (!pGtins.has(g.value)) continue;
      if (g.valid) {
        gtinMatches.set(p.productId, g.value);
      } else {
        weakReasons.add(`gtin_invalid:${g.value}`);
      }
    }

    const sharedKey = candModelKeys.find((k) => pModelKeys.has(k));
    if (!sharedKey) continue;
    const pBrand = p.brand ? normalizeBrand(p.brand) : null;
    if (candBrand && pBrand && candBrand === pBrand) {
      modelMatches.set(p.productId, sharedKey);
    } else {
      weakReasons.add(`model_only:${sharedKey}`);
    }
  }

  // Rule 3: GTIN says A, brand+model says B (A≠B) → CONFLICT.
  const gtinIds = [...gtinMatches.keys()];
  const modelIds = [...modelMatches.keys()];
  const conflict =
    gtinIds.length > 0 &&
    modelIds.some((id) => !gtinMatches.has(id)) &&
    !modelIds.every((id) => gtinMatches.has(id));
  if (conflict) {
    const all = [
      ...gtinIds.map((id) => `gtin_exact:${gtinMatches.get(id)}`),
      ...modelIds
        .filter((id) => !gtinMatches.has(id))
        .map((id) => `brand_model_exact:${modelMatches.get(id)}`),
    ];
    return { level: "CONFLICT", productId: null, reasons: all };
  }

  // Rule 4: exactly one GTIN match → EXACT.
  if (gtinIds.length === 1) {
    return {
      level: "EXACT",
      productId: gtinIds[0]!,
      reasons: [...reasons, `gtin_exact:${gtinMatches.get(gtinIds[0]!)}`],
    };
  }
  if (gtinIds.length > 1) {
    // Multiple products claim the same GTIN — data conflict, human review.
    return {
      level: "REVIEW",
      productId: null,
      reasons: [...reasons, ...gtinIds.map((id) => `gtin_ambiguous:${gtinMatches.get(id)}`)],
    };
  }

  // Rule 5: exactly one brand+model match, no GTIN evidence → HIGH.
  if (modelIds.length === 1) {
    return {
      level: "HIGH",
      productId: modelIds[0]!,
      reasons: [...reasons, `brand_model_exact:${modelMatches.get(modelIds[0]!)}`],
    };
  }
  if (modelIds.length > 1) {
    return {
      level: "REVIEW",
      productId: null,
      reasons: [
        ...reasons,
        ...modelIds.map((id) => `brand_model_ambiguous:${modelMatches.get(id)}`),
      ],
    };
  }

  // Rule 6: weak signals — equal-but-invalid GTIN, or model equal without brand.
  if (weakReasons.size > 0) {
    return { level: "REVIEW", productId: null, reasons: [...reasons, ...weakReasons] };
  }

  // Rules 7–8: title similarity never links; nothing else → UNRESOLVED.
  return { level: "UNRESOLVED", productId: null, reasons };
}
