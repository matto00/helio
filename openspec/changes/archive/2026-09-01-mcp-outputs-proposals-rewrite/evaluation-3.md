## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed `git diff bafca550~1..HEAD` (commit `bafca550`) on top of
`evaluation-1.md` (6 change requests, all closed in cycle 2) and
`evaluation-2.md` (1 change request, addressed here).

### Gates — re-run independently by me

| Gate | Result |
| --- | --- |
| Backend `sbt -batch 'set Test/parallelExecution := false' test` | **3520/3520, 235 suites, 0 failures** (+1 vs cycle 2 = the new boundary test) |
| helio-mcp jest (corrected scoped command) | **18/18 suites, 182/182 tests** |
| Frontend `cd frontend && npm test` | **275 suites / 2969 tests pass** |
| `npm run lint` / `format:check` / `typecheck` | pass |
| `node scripts/check-schema-drift.mjs` | pass (73 schemas / 48 protocol files) |
| `npm --prefix frontend run build` | pass |

Gate-scanned-what-I-think check (not just "it was green"): I grepped the sbt
log for the new case by name — `sbt3.log:2611`
`- should reject an over-length tag on dashboard create with a curated 400, not
a raw DB-constraint 500` — so the test genuinely executed in the run that
reported 0 failures, rather than being silently skipped or filtered out.

### Phase 1: Spec Review — PASS

`evaluation-2.md`'s single change request is closed, and both non-blocking
notes were picked up:

- **The tag gate is real and correctly placed.**
  `DashboardRoutes.scala:47-64` now runs `RequestValidation.validateTag(request.tag)`
  and returns a curated `400 + ErrorResponse(msg)` on `Left` before
  `dashboardService.create` is ever called. The route layer (rather than the
  service) is a defensible choice, and the comment states the reason honestly:
  `DashboardService.create` returns `Future[(Dashboard, Boolean)]` with no
  `Either`/`ServiceError` convention, so gating inside the service would have
  meant widening that signature through `DashboardProposalService`,
  `PatchSetApplyForward`, and every other caller for one field. It also matches
  the curated-400 pattern this same file already applies to `offset`.
- **I verified the route gate actually covers every reachable path**, since a
  route-layer guard is structurally weaker than a service-layer one. Grepping
  every `CreateDashboardInput(` construction in `backend/src/main`: only
  `DashboardRoutes.scala:57` passes a tag at all;
  `DashboardProposalService.scala:82` and `PatchSetApplyForward.scala:51` both
  omit it and take the `None` default. `DashboardSnapshotRepository`'s two
  direct `Dashboard(...)` constructions (import/duplicate) likewise don't set
  it. So there is no production path today that reaches the DB `CHECK` unguarded.
- **The new test exercises the REST boundary, not the MCP client.**
  `ApiRoutesSpec.scala:264-274` issues
  `Post("/api/dashboards", CreateDashboardRequest(Some("Operations"), None, Some("a" * 201))) ~> routes()`
  — the real Pekko route DSL with a marshalled entity. Two things make it
  meaningful rather than incidental: it asserts `StatusCodes.BadRequest`
  *and* pins the body to `"tag must be at most 200 characters"`
  (`RequestValidation`'s exact text), so a coincidental 400 from auth or
  unmarshalling would not satisfy it; and without the gate the request reaches
  V95's `CHECK (length(tag) <= 200)` and surfaces as a 500, so the test is
  genuinely failable by removing the fix. The header comment correctly explains
  why the MCP client cannot substitute here — `write.ts:351`'s
  `z.string().min(1).max(200)` structurally cannot express the over-length input.
- **The `outputs.tag` audit claim checks out, and is in fact stronger than
  claimed.** Every `insertInternal`/`insertInternalAction` call site relies on
  the `tag: Option[String] = None` default —
  `PipelineService.scala:299`, `OutputService.scala:104`, `DemoData.scala:54`;
  nothing REST- or MCP-exposed sets it. Independently: `V94__outputs_model.sql:91`
  declares `tag TEXT NULL` with **no length CHECK at all**, so even a reachable
  path could not produce the DB-constraint-500 failure class this was auditing
  for. The negative result is correct on both counts.
- **Non-blocking notes closed.** `create-dashboard-request.schema.json`'s `tag`
  description now spells out the `ifExists` interaction (an existing matched
  dashboard keeps its own tag; the request `tag` applies only on the
  fresh-insert branch). `TeardownOutcome.dashboardsDeleted`'s dead default is
  removed, with the one construction site named in the comment.

### Phase 2: Code Review — PASS

The diff is small, focused, and behavior-preserving outside the one intended
gate. The `RequestValidation` import is used; the `Left`/`Right` shape matches
the sibling services; no new duplication (the canonical helper is reused rather
than re-implementing a 200-char check); the added test is a real boundary test
with a pinned message. No dead code, no TODO/FIXME, no scope creep beyond the
requested fix and the two non-blocking pickups.

Dev-DB hygiene re-checked independently:
`select count(*) filter (where tag is not null), count(*) from dashboards`
→ **0 tagged of 533** — no residue from this cycle's runs either.

### Phase 3: UI Review — N/A

**Stated explicitly, not skipped.** The ticket declares the UI gate N/A
(backend/MCP only). This cycle touched no frontend source at all — the only
frontend-relevant surface is the dashboard-create request schema, covered by
schema-drift, 2969 green frontend tests, and a clean production build. No dev
servers were started.

### Overall: PASS

All three phases clear. Cycle 1's six change requests and cycle 2's single
change request are all closed with fresh, independently re-run evidence.

### Non-blocking Suggestions

- The tag gate lives at the route layer, so it protects the HTTP boundary but
  not the service API. It's airtight today (I checked every caller), but if a
  future caller passes a caller-supplied tag through `CreateDashboardInput`
  from somewhere other than `DashboardRoutes`, it bypasses the guard and gets
  the raw 500 back. If `DashboardService` ever grows an `Either`/`ServiceError`
  return, moving the gate inward would be the more durable home. Not worth the
  ripple now.
- `outputs.tag` (V94, not this ticket) is effectively a dead column: no call
  site sets it, and the MCP `teardown_resources` description correctly tells
  agents that Outputs cascade with their pipeline rather than carrying a tag of
  their own. Worth a line in HEL-910's final sweep — either wire it up or drop
  it — rather than leaving a column nothing writes.
- Carry-over, still worth recording in `ticket.md` for P1.5–P1.7: root
  `npm test` is vacuous for both helio-mcp (inside a worktree) and the frontend
  (root `jest.config.cjs` excludes `/frontend/` outright). `cd frontend &&
  npm test` is the only real frontend evidence.
