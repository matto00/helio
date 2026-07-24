# HEL-480: Connection-test endpoint + UI pattern

**Linear URL:** https://linear.app/helioapp/issue/HEL-480/connection-test-endpoint-ui-pattern
**Priority:** High
**Epic:** HEL-429 "Connector Framework Hardening" (v1.9 Data Connectors) — 5th ticket
**Assignee:** Matthew Orr

## Context

There is no way to validate a connector's config/credentials before committing to a full create + fetch. Today the only feedback is the create-time fetch-error envelope. The SPI (HEL-449) adds `testConnection`; this ticket exposes it over HTTP and gives the frontend a reusable "Test connection" affordance so warehouse/OAuth connectors (which are slow/expensive to fully fetch) can be validated cheaply.

## Scope

- Backend: a connection-test route (e.g. `POST /api/sources/test` accepting the same discriminated `type` + `config` payload the create routes use — see `api/routes/SourceRoutes.scala` dispatch) that calls `Connector.testConnection` and returns `{ ok: true }` or `{ ok: false, error }` using the same curated-message hygiene as the fetch-error envelope (HEL-468). Wire into `ApiRoutes.scala`.
- Frontend: a reusable "Test connection" button + status affordance usable by every source form (`frontend/src/features/sources/ui/*SourceForm.tsx`, `AddSourceModal.tsx`); add the service call in `frontend/src/features/sources/services/dataSourceService.ts` and slice state in `sourcesSlice.ts`. Follow DESIGN.md tokens/components.
- Credentials in the test payload are never echoed back in the response.

## Acceptance criteria

- The endpoint returns a normalized ok/error result for SQL and REST (the two SPI implementers available at this point); no raw driver/exception text or credential in the error.
- The frontend affordance shows pending/success/error states and is shared (not duplicated per form).
- Read-only enforcement still applies (a SQL test with DDL/DML is rejected by `SqlConnector.checkQuery`).
- Backend route test + a frontend test for the shared component.
- Backward-compatible: purely additive route + UI.

## Out of scope

- Per-connector wiring for connectors not yet built (they adopt the shared endpoint/affordance when added).

## Dependencies

- Blocked by HEL-449 (Connector SPI `testConnection`). Uses the message hygiene from HEL-468.

## Epic batch context (from orchestrator brief)

Fifth ticket of the HEL-429 "Connector Framework Hardening" epic. Branched from `origin/main` containing all four predecessors:
- HEL-449 Connector SPI — `d6fe6a45`
- HEL-473 schema-inference facade — `ca65465d`
- HEL-468 uniform fetch-error envelope — `6dbcf4cd`
- HEL-460 secret redaction seam — `5da8c5ad`

**Predecessor reading (required before planning):**
- `backend/src/main/scala/com/helio/domain/Connector.scala` — the `Connector[Config]` trait. Its `testConnection(config)(implicit ec)` method is what this ticket exposes over HTTP — it already exists, built by HEL-449 specifically for this ticket. Trait-level doc comment carries five contract blocks; short names, never FQNs, is the house style there.
- `backend/src/main/scala/com/helio/services/{SchemaInferenceFacade,CreateSourceEnvelope,SecretField}.scala` — three helper/seam precedents. Follow their layering: helpers live in `services/`, not `domain/`.
- `openspec/specs/{connector-spi,schema-inference-facade,fetch-error-envelope,connector-secret-redaction}/spec.md`
- `openspec/changes/archive/2026-07-24-connector-spi-shared-trait/design.md` — "Sibling ownership map" defines what HEL-480 owns.

**`testConnection`'s existing semantics (verify against code, preserve — do not expand scope of work done):**
- SQL: opens and closes a JDBC connection WITHOUT executing the query. There is a test asserting this using a deliberately invalid query (`"NOT VALID SQL AT ALL"`) that would throw if it were ever run.
- REST: reuses the auth/header/URI pipeline via `buildRequest` but inspects only the response status, skipping body parsing.
- Preserve these semantics; don't make the endpoint execute more work than `testConnection` already does.

One sibling remains after this: HEL-484 (connector registry + capability metadata). Do not pull its scope forward.

## THIS IS THE FIRST TICKET IN THE BATCH WITH FRONTEND WORK

The previous four were backend-only, so the UI review phase was N/A throughout. It applies here.
- `DESIGN.md` is binding for all `frontend/` work — tokens, spacing/type scales, shared components, UI state patterns. Read it.
- Use canonical shared components rather than bespoke ones. `InlineError` is the established validation/error display component (HEL-416 precedent).
- The evaluator's Phase 3 (live UI review via Playwright) applies — budget for dev servers actually running.
- **Known hazard:** parallel Playwright sessions have previously dropped stray screenshot PNGs at the repo root. Write screenshots into the worktree (e.g. under the change's openspec directory), not the repo root, and confirm `git status` is clean at delivery.

## Repo-specific gotchas

- **spray-json omits `Option = None` from the wire entirely** (not `null`). Highly likely to matter here — a connection-test result will plausibly carry an optional error/detail field, and the frontend must handle *absent*, not just null. Normalize absent→null at the service boundary and write regression tests constructing fixtures with the key OMITTED. This has bitten the codebase four times; HEL-613 tracks the general problem. On HEL-416 the identical bug produced a literal "Invalid Date" in the UI and was caught only by live Playwright, not by Jest fixtures that used explicit nulls.
- **Secrets must never reach a response.** HEL-460 just shipped the redaction seam — a connection-test endpoint takes connector config as input, so make sure no error message, log line, or response echoes a credential back. Any response payload carrying config must go through `SecretRedaction.redact`. Test by asserting the raw secret is **absent** from serialized JSON, not merely that a mask is present.
- **No inline fully-qualified names** — hard CONTRIBUTING.md rule, including inside doc comments.
- **Every enforceable claim needs a mechanism.** All five design gates in this batch REFUTEd at least once on assertions nothing verified (an unspecified ExecutionContext, a `SHALL` with no task, a soft "code-review-level" check, a stale artifact describing a rejected approach, an AC clause with no enforcement). If the design says something is guaranteed, a test or type must fail when it stops being true. Expect the skeptic to probe exactly this.
- Existing test suites must pass unmodified. Do not edit a test to accommodate new code; if one genuinely needs changing, stop and report why.
- Pre-existing, do NOT fix: HEL-615 (`bumpVersion` inert), the CSV `InferredField`→`DataField` duplication in `DataSourceService`, and HEL-616 (no log-redaction guard — just filed).
- Trivial bugs inline; non-trivial → report as spinoff candidates, don't fix in scope.
- Executors run `sbt test` + the full npm gate chain before declaring done. `check:openspec` tripping on complete-but-unarchived is expected pre-Delivery — `git commit -n` with the reason disclosed in the commit body is established precedent.
