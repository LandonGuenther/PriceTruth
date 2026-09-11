# API compatibility

## Versions

- **API version:** 1 (`x-pricetruth-api-version` response header; `apiVersion`
  field in every response body). All routes live under `/v1` except
  `/health` and `/readiness`, which are versionless ops endpoints.
- **Observation schema version:** 1 (`x-pricetruth-observation-schema-version`
  response header; `schemaVersion` field in `POST /v1/observations` bodies,
  defined as `OBSERVATION_SCHEMA_VERSION` in `@pricetruth/shared`).

## Evolution policy within v1

- **Additive only.** New response fields may appear at any time; clients must
  tolerate unknown fields. Existing field names, types, error codes, and HTTP
  status codes never change within v1.
- **Deprecation.** A field destined for removal is announced with a
  `Deprecation` response header and a doc note for **at least 2 minor server
  releases or 90 days**, whichever is longer, and is only removed in the next
  API version — never within v1.
- **Versioning.** Breaking changes ship as a new path prefix (`/v2/…`) or a new
  `schemaVersion`; v1 remains served until explicitly sunset.

## Client/server version matrix

| Client → Server                              | Behaviour                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| schemaVersion 1 → v1 server                  | works                                                                      |
| Unknown `schemaVersion` (e.g. 2) → v1 server | 400 `unsupported_schema_version`                                           |
| Older client → newer v1 server               | works (additive fields ignorable)                                          |
| Newer client → older v1 server               | works; new optional request fields ignored; response may lack newer fields |

## Request-id

`x-request-id` is echoed on every response. A client-supplied value is used
only if it matches `^[A-Za-z0-9._-]{1,128}$`; otherwise a fresh UUID is
generated (never echo attacker-controlled header bytes).
