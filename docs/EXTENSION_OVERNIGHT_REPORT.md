# Extension overnight report

Date: 2026-09-11  
Branch: `cursor/extension-overnight-sprint-c7e8`  
Scope: extension + retailer-adapters hardening for beta docs/QA  
Out of scope (do not touch in parallel with backend): Prisma schema/migrations,
`observationService`, `analysisService`, scoring math under `packages/scoring`

Baseline audit: [EXTENSION_OVERNIGHT_AUDIT.md](./EXTENSION_OVERNIGHT_AUDIT.md)

## Sprint commits (this branch)

Relative to merge-base with `devin/1789092893-pricetruth-mvp` / post-skills merge
(`797d3bb`):

| SHA | Summary |
| --- | --- |
| `97a4038` | Generation tokens to prevent stale analysis races |
| `695aa35` | `ExtractionMeta` + `ambiguous_price` reason in adapters |
| `db0936c` | Amazon: scope buy-box prices; reject contaminated offers |
| `2e6ea28` | Best Buy: tighten price-block scoping; detect conflicts |
| `521cce4` | Wire extraction meta; reset failure cache on identity change |
| `9421427` | Side panel polish (insufficient, chart windows, diagnostics, …) |
| `ce01122` | Expand retailer extraction fixtures |
| `fdc9df2` | API client hardening, mutation filters, package verify |

Docs commit (this change): `docs(extension): document beta architecture and QA`.

## Implemented tonight (honest)

Treated as **done** in current code (covered by tests and/or packaging gate):

| Area | Audit item | Status |
| --- | --- | --- |
| Generation tokens / stale overwrite | P0 #1 | Done |
| Cancel overlapping navigation pings | P0 #3 | Done |
| Amazon buy-box scoping + conflict → ambiguous | P1 #4/#5 | Done (fixture-backed; live still needs matrix) |
| Best Buy price-block scoping + conflict → ambiguous | P1 #4/#5 | Done (fixture-backed) |
| Extraction confidence + withhold ingest on ambiguous | P1 #5 | Done |
| Identity-change failure-cache reset | P2 #8 | Done |
| Mutation relevance + attributeFilter | P2 #7 | Partially done (still observes body subtree) |
| Formal TabState + ambiguous + error kinds | P3 #9 | Done |
| Insufficient-history dedicated card; hide scores | P3 #10 | Done |
| Chart 30/90/180/ALL + gap-aware polyline | P3 #11 | Done |
| Client reason map | P3 #12 | Done (unknowns pass through cleaned) |
| Diagnostics toggle | P3 #13 | Done |
| API taxonomy, 10s timeout, no retry storms | plan #5 | Done |
| Live region + chart accessible table | P5 partial | Done (dark-mode tokens not pursued) |
| Handler / observer / panel / API tests expanded | P4 | Largely done |
| `verify-package` forbidden-path gate | P8 #27 | Done |
| Docs architecture / QA / perf / report / matrix | P8 #28 | Done in this commit |

## Remaining

### P0

- **Same-URL failure after success can stay sticky (audit P0 #2).**
  `failedUrls` is not cleared on a successful observation for that URL. Sequence
  fail → success → fail again on the same href can suppress the second failure
  and leave a stale `ready` panel. Fix: clear `failedUrls` for the current href
  on successful send (and/or always allow failure after a successful signature).

### P1

- More adversarial fixtures still thin vs audit list (coupon-only, installment,
  used offer, subscription/twister edge cases, smile-only quirks, Comp. Value-only
  Best Buy, marketplace seller badge, reviews-without-price). Several were added;
  daytime matrix should drive the rest.
- Live Amazon/Best Buy confirmation of scoped selectors (fixtures ≠ production DOM).

### P2

- MutationObserver still watches `document.body` subtree; relevance filter helps
  but is heuristic.
- Optional: clear failure cache on successful extract without URL change.

### P3 / UX polish

- Ingest accepted/duplicate still stored on `ready` but not surfaced in UI
  (low priority).
- `pt/set-diagnostics` message type unused (panel writes session key directly).

### P5 a11y

- No `prefers-color-scheme` / dark tokens yet.
- Focus/contrast not systematically audited beyond Retry + live region + chart table.

### P6 / P7

- Bundle size acceptable; keep watching sidepanel growth.
- Privacy posture intact; keep `dangerouslySetInnerHTML` grep clean.

## Conflicts to watch (parallel backend work)

| Risk | Why |
| --- | --- |
| Analysis / history JSON shape changes | Extension parsers require specific fields and reject newer `schemaVersion` / API major. Coordinate before bumping. |
| Confidence gate or score nullability changes | Panel assumes INSUFFICIENT hides numeric scores but still shows price summary / advertised discount. |
| Observation ingest contract | Content still posts `RetailerObservation` as today; do not require new auth cookies (extension uses `credentials: "omit"`). |
| Prisma / scoring refactors | Safe if HTTP contract stable. **Do not merge extension PRs that edit** `observationService`, `analysisService`, or scoring packages "for convenience." |
| History `daily` semantics | Chart assumes one point per calendar day and gap > 1.5 days breaks the line. |

## Suggested next steps (daytime)

1. Fix P0 #2 failure-cache sticky path + regression test.
2. Fill [EXTENSION_REAL_WORLD_TEST_MATRIX.md](./EXTENSION_REAL_WORLD_TEST_MATRIX.md)
   (50 Amazon + 50 Best Buy slots).
3. Promote failing live DOMs into adapter fixtures; land selector fixes with
   commits referenced from the matrix.
4. Re-measure [EXTENSION_PERFORMANCE.md](./EXTENSION_PERFORMANCE.md) after any
   adapter size growth.
