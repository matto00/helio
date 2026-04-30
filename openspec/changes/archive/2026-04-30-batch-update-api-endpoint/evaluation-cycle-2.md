# Evaluation Report — HEL-155 Cycle 2

**Ticket:** HEL-155 — Design and implement batch update API endpoint
**Branch:** feature/batch-update-api-endpoint/HEL-155
**Verdict:** ✅ PASS

---

## Summary

All four required fixes from cycle 1 have been fully addressed. Backend ScalaTest cases 5.1–5.4 are implemented, substantive, and exercising the correct code paths. Frontend tests continue to pass (270/270); ESLint and Prettier are both clean.

---

## Cycle 1 Blockers — Resolved

### 5.1 Happy-path backend test ✅

`ApiRoutesSpec.scala` now contains "batch update applies panelLayout and dashboardAppearance ops and returns updated state". The test creates a real dashboard and panel, sends a multi-op batch, and asserts the response reflects the updated `background`, `gridBackground`, and `layout.lg`. Covers both commit semantics and response shape.

### 5.2 Rollback backend test ✅

"batch update rolls back all ops when one op references a non-existent panel" sets an explicit original layout via `PATCH`, sends a batch where the second op references `"non-existent-panel-id"`, expects `400`, then re-fetches via `GET /api/dashboards` and asserts the layout is still the original. This is a genuine proof of `DBIO.seq(...).transactionally` rollback behavior — the highest-risk path in this feature.

### 5.3 Unknown op → 400 ✅

Uses `Route.seal(routes())` (the correct Pekko HTTP pattern for intercepting rejections) with a raw JSON body containing `"op":"unknownOpType"`. Correctly exercises the `deserializationError` path in the custom `batchOperationFormat.read`.

### 5.4 Empty ops → 400 ✅

Sends `BatchRequest(Vector.empty)` and asserts both the status code and the exact `ErrorResponse("ops must not be empty")` body, covering the route-level guard.

---

## Full Criteria Status

| Area | Status |
|------|--------|
| Backend route (1.1–1.5) | ✅ |
| Schemas (2.1–2.2) | ✅ |
| OpenAPI spec (3.1) | ✅ |
| Frontend service + thunk + PanelGrid (4.1–4.3) | ✅ |
| Backend tests 5.1–5.4 | ✅ |
| Frontend test 5.5 | ✅ |
| ESLint (0 warnings) | ✅ |
| Prettier | ✅ |
| Frontend tests (270/270) | ✅ |

---

## Observations (Non-blocking)

### saveDashboardBatch.fulfilled does not hydrate panelsSlice

`dashboardsSlice.ts:239-243` maps the updated dashboard into `state.items` but discards `action.payload.panels`. For the current sole caller (`PanelGrid`, dispatching `panelLayout` ops) this is correct — layout lives on the dashboard record. If a future caller dispatches `panelAppearance` ops, the panels slice will lag. This is acceptable scope for HEL-155 but warrants a follow-up ticket when panel appearance is wired to the batch endpoint.

### Double lookup in batch route

The route pre-checks existence via `findById` (`DashboardRoutes.scala:117`) before calling `batchUpdate`, which itself also starts with a `headOption` lookup on the same row (`DashboardRepository.scala:244`). Not incorrect (ownership check in the route justifies the first call), but the inner check is redundant. Cosmetic — does not affect correctness.

---

## Decision

**Deliver.** All spec requirements are met, the cycle 1 blocker is resolved, and the quality bar (tests, lint, format) is satisfied.
