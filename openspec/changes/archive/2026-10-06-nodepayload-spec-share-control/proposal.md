## Why

`NodePayloadWiringSpec` (HEL-1276) proves a share token gets `401` on the public node-payload path, but never proves
that token is valid. A broken token (wrong hash, wrong dashboard, wrong encoding) would produce the same `401`, so the
assertion cannot distinguish "the payload path refuses share tokens" from "the token never worked". It also hand-rolls
the SHA-256 that `TokenHashing.sha256Hex` owns, so it can drift from the production hashing it is meant to match.

## What Changes

- The spec hashes the seeded share token with `TokenHashing.sha256Hex` instead of an inline `MessageDigest` digest.
- The spec adds a positive control: the same share token gets `200` on public
  `GET /api/dashboards/:d/panels/:p/history?token=` through the full `ApiRoutes` tree, on a dashboard where the token
  is the ONLY access path (anonymous baseline denied), so the `200` is attributable to the token.
- The existing `401` assertions on the payload path are kept, and the public-grant case is kept as well.
- The positive control is shown red under a token-breaking mutation and green without it (evidence recorded).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — test-only; no spec-level behavior changes (`skip_specs: true`).

## Non-goals

- No production code change. If the positive control fails against unmodified product code, that is escalated as a
  product bug rather than worked around.
- No change to other specs that hand-roll SHA-256 (noted as a possible follow-up only).
- No CI/workflow, Playwright, or `.gitignore` changes.

## Impact

- `backend/src/test/scala/com/helio/api/NodePayloadWiringSpec.scala` only.
