## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### Environmental note
This worktree's local (gitignored) `scripts/concertino/` rendering is stale — it lacks
`next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh`, which exist in the
main repo checkout at `/home/matt/Development/helio/scripts/concertino/`. These scripts
are purely argument-driven (operate on the `<change-dir>` path passed to them, not on
their own location), so I invoked them by absolute path from the main checkout against
this worktree's change dir — functionally identical to a locally-rendered copy. Flagging
this as a workflow-tooling gap for the orchestrator, not a code defect in the change under
review.

### What I verified (with evidence)

**Ground truth re-established (not trusted from the evaluator's report):**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/cors-error-handling/spec.md`, `specs/hikaricp-pool-config/spec.md`) directly.
- `git log origin/main..HEAD` → exactly one commit (`ce64260f`); `git diff origin/main...HEAD --stat`
  → 14 files, matching `files-modified.md` (the worktree's local `main` ref is stale by 2
  already-merged commits, same review-surface caveat the evaluator correctly documented).
- Read the full `git diff origin/main...HEAD` for `application.conf` and `ApiRoutes.scala` myself
  (not summarized from `files-modified.md`).
- Read both new test files in full: `ApiRoutesCorsErrorHandlingSpec.scala` (196 lines) and
  `DatabaseConnectionTimeoutSpec.scala` (85 lines).

**Acceptance criteria traced to real evidence:**
- **Ticket item 1** (`connectionTimeout` tuned down): `application.conf` diff adds
  `connectionTimeout = 5000` to both `helio.db` and `helio.db.privileged`, with inline rationale
  comments. `DatabaseConnectionTimeoutSpec` exercises the real production call path
  (`JdbcBackend.Database.forConfig("helio.db", config)`) against a TCP-accepting-but-silent
  blackhole socket — a genuine regression test, not a mock of the timeout value. I ran it myself
  (see below): passed, failure landed within the asserted `[3000ms, 15000ms)` bound.
- **Ticket item 2** (`ExceptionHandler`/`RejectionHandler` inside `cors()`): `ApiRoutes.scala:456-505`
  defines `topLevelExceptionHandler`/`topLevelRejectionHandler` and wraps the route tree with
  `handleExceptions(...) { handleRejections(...) { traceContext.withTraceContext { ... } } }`
  immediately inside `cors(corsSettings) { ... }`, before `traceContext.withTraceContext` — exactly
  the documented insertion point. `backend/src/main/scala/com/helio/app/HttpServer.scala:12` +
  `Main.scala:168` confirm `apiRoutes.routes` (the exact `val` modified) is the one `Route` bound to
  the server, so the fix covers the entire application, not a sub-tree.

**Fresh gate re-runs (executed by me in `WORKTREE_PATH`, not trusted from either prior report):**
- `sbt "testOnly com.helio.api.ApiRoutesCorsErrorHandlingSpec com.helio.infrastructure.DatabaseConnectionTimeoutSpec"`
  → `6/6` passed, including the timeout-bound assertion.
- `cd backend && sbt test` (full suite) → `Tests: succeeded 3339, failed 0` / `Suites: completed 212`
  — matches the evaluator's claimed count exactly, independently reproduced.
- `npm run check:scala-quality` → `clean (127 soft warning(s))`, exit 0 — matches.
- `npm run check:schemas` → in sync (66 protocols / 47 files) — matches.
- `npm run check:openspec` → flags "complete (11/11) but not archived" — the expected pre-archive
  state; matches the commit body's stated, precedented reason for the one `-n` pre-commit bypass
  (`git log -1 ce64260f`), and the commit body itself states every other check (lint, format:check,
  check:schemas, check:scala-quality, full backend `sbt test`, full frontend `npm test`) ran clean
  and was not bypassed.
- `grep -rn "ExceptionHandler\|RejectionHandler" backend/src/main/scala/` → one hit outside
  `ApiRoutes.scala`, an unrelated Scaladoc comment in `PipelineService.scala:296` — confirms no
  conflicting registration elsewhere, matching design.md's claim.

**Live behavior, independently reproduced against the running dev backend (not just the test
suite):** Verified the backend process on :9089 was serving current code (compiled `.class` mtime
newer than, and content-consistent with, the unmodified-since-18:47 source file) before curling it.
- `curl -H "Origin: http://localhost:6182" .../api/this-route-does-not-exist-xyz` → `401`,
  `Access-Control-Allow-Origin: http://localhost:6182` present, clean JSON
  `{"message":"Unauthorized"}` body (auth runs ahead of routing for `/api/*`, so this is the
  allowed-origin rejection path landing on a curated JSON body with CORS headers — matches
  scenario 2 of `cors-error-handling/spec.md`).
- `curl` with no `Origin` header on the same path → `401`, same JSON body, no CORS header (correct
  — not a cross-origin request).
- `curl -H "Origin: http://evil.example.com" ...` → `500`, `Content-Type: text/plain`, body
  `"There was an internal server error."`, **no** CORS header. This reproduces the evaluator's
  documented non-blocking gap exactly: `cors()`'s own `CorsRejection` for a disallowed origin fires
  *outside* the new `handleRejections` scope (which sits *inside* `cors()`, per the ticket's explicit
  instruction), so that one path still hits Pekko's raw default. This is structurally inherent to
  where `cors()` mints the rejection, not a defect introduced by this diff — before this change,
  *every* failure path (including allowed-origin ones) had this exact masking; after this change,
  only the disallowed-origin path does. The spec delta's rejection scenario is explicitly scoped to
  "a request from an allowed CORS origin," and the implementation matches that scope precisely — no
  silent narrowing.
- Read `backend/src/main/scala/com/helio/api/AuthDirectives.scala:171-183` (`requireCsrfHeader`) —
  confirms it `complete()`s directly rather than rejecting, so it is provably unaffected by the new
  `RejectionHandler`, corroborating the (correctly non-blocking) framing note from the design-gate
  skeptic report.

**Design-gate carryover check:** Read `skeptic-design-1.md` (CONFIRM) and re-verified its grounding
claims still hold post-implementation (line numbers, the single grep hit, the `HttpServer.bind`
mechanism) — nothing in the executed diff contradicts what was approved at the design gate.

### Verdict: CONFIRM

Both acceptance criteria trace to real, independently-reproduced evidence: the HikariCP
`connectionTimeout` change and its dedicated blackhole-socket regression test, and the
`ExceptionHandler`/`RejectionHandler` registration and its dedicated CORS-header regression tests.
I reproduced the evaluator's full backend test count (3339/3339), the quality/schema/openspec gate
results, and — going beyond the evaluator's own live check — independently curled the running
backend myself (after confirming it was serving current, compiled code) to confirm both the
allowed-origin fix and the correctly-scoped, pre-existing disallowed-origin gap. No contradiction
between the planning artifacts and the implementation; no scope creep; no placeholder/deferred work;
`error-response-safety` is respected by construction (verified by reading the handler and by the
test asserting the response body excludes the raw exception class name and message).

### Non-blocking notes
- Carrying over the evaluator's own suggestion: `ApiRoutes.scala` is now 720 lines, well past
  CONTRIBUTING.md's ~400-line soft-split threshold (pre-existing, grown ~54 net lines by this diff).
  Worth extracting `topLevelExceptionHandler`/`topLevelRejectionHandler` into a small companion
  object in a future pass — informational only, `check:scala-quality` already treats this as
  soft/non-blocking.
- The disallowed-origin `CorsRejection` gap (reproduced above) is correctly out of this ticket's
  scope per the ticket's own text and the spec delta's explicit scenario wording, but is a real,
  live-reproducible residual masking case (ERROR-level stack-trace log spam + plain-text/no-CORS
  response for spoofed-origin/bot traffic). A follow-up ticket to add a dedicated
  `corsRejectionHandler` outside `cors()` for `CorsRejection` specifically would close it.
- Workflow-tooling gap (not this change's fault): this worktree's gitignored `scripts/concertino/`
  rendering is missing `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` that exist in
  the main repo checkout — see Environmental note above. Worth the orchestrator refreshing
  worktree-local script renderings, or always resolving these by absolute main-repo path.
