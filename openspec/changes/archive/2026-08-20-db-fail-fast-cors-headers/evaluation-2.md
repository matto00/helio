## Evaluation Report — Cycle 2 (evaluation-2.md)

### Scope note
This cycle is a fold-in, not a change-request fix on round 1. The user answered
"fold-in" to two follow-up items round 1's evaluation-1.md and the final-gate
skeptic (skeptic-final-1.md) surfaced as non-blocking suggestions; the design gate
was re-run (skeptic-design-2.md, CONFIRM) before implementation. This review covers
the delta between round 1's shipped commit (`ce64260f`) and the current `HEAD`
(`edf46722`), i.e. `git diff ce64260f...HEAD` — the archive/un-archive commit
(`67a7ca8c`) in between is pure file-move (change dir → archive → change dir,
reopened for the fold-in) plus canonical-spec sync and carries no code changes.

### Phase 1: Spec Review — PASS
Issues: none.
- `ticket.md`'s "Added scope (fold-in, 2026-08-20)" items 3-4 and the two new ACs are
  both addressed explicitly, matching `tasks.md` task groups 4-6 (all `[x]`).
- No AC silently reinterpreted — AC3 ("top-level handlers live in a separate
  companion object, no behavior change") and AC4 ("disallowed Origin → clean curated
  response, no CORS headers, no ERROR-level stack trace") are both implemented
  literally, verified against live behavior (see Phase 3).
- `tasks.md`: 20/20 marked done; each of task groups 4-6 verified against the actual
  diff (`TopLevelErrorHandlers.scala` new file, `ApiRoutes.scala` wiring change, 3 new
  tests in `ApiRoutesCorsErrorHandlingSpec.scala`).
- No scope creep — diff is exactly the extraction + the one new handler + the openspec
  artifacts; nothing outside the two triaged fold-in items.
- No regression to round-1 behavior — regression-verified both by the 3 pre-existing
  round-1 tests re-running green and by live `curl` against allowed-origin/no-Origin
  requests (see Phase 3), matching task 6.3's explicit regression-pass requirement.
- No API contract change — `check:schemas` still in sync (66/47).
- Spec delta (`specs/cors-error-handling/spec.md`) accurately reflects the final
  implementation: the new `MODIFIED Requirements` paragraph and "Disallowed-origin
  request receives a clean, curated response" scenario match the shipped
  `403 Forbidden` / no-CORS-header / `WARN`-no-stack-trace behavior exactly, verified
  live.

### Phase 2: Code Review — PASS
Issues: none.

**Fresh gate re-runs (executed by me, not trusted from the executor's report):**
- `cd backend && sbt test` → `3342/3342` passed (3 more than round 1's 3339, matching
  the 3 new tests), `0` failed, `212` suites — independently reproduces the executor's
  claimed count.
- `npm run check:scala-quality` → `clean (128 soft warning(s))`, exit 0. No inline-FQN
  violations in either changed file (`ApiRoutes.scala`, new `TopLevelErrorHandlers.scala`)
  or the test file's new logback/slf4j/`CollectionConverters` imports — all top-of-file.
- `npm run check:schemas` → in sync, no drift.
- `npm run check:openspec` → flags "complete (20/20) but not archived," matching the
  same precedented `-n` bypass reason as round 1 (archiving is a later Delivery-phase
  step). No other check bypassed per the commit body.
- Only `backend/**` files changed — frontend gates correctly not applicable.

**CONTRIBUTING.md compliance:**
- `ApiRoutes.scala`: 691 lines (was 719/720 after round 1) — net reduction of ~29
  lines from the extraction, though still above the ~250-line soft budget (pre-existing
  debt, informational only per `check:scala-quality`).
- `TopLevelErrorHandlers.scala`: 94 lines, well under budget.
- Imports cleaned up correctly in `ApiRoutes.scala`: `ContentTypes`/`HttpEntity`/
  `HttpResponse`/`ExceptionHandler`/`RejectionHandler`/`spray.json._` all removed
  (verified — `grep` confirms none remain used or imported); no leftover dead imports.
- `TopLevelErrorHandlers` is a plain `object ... extends Directives with JsonProtocols`
  with its own `LoggerFactory` logger — matches design.md D5's stated rationale (no
  `ApiRoutes`-constructor dependency needed) and is a genuine independently-testable/
  reusable unit, not a premature abstraction (it directly serves the file-size-split
  goal, has 3 real call sites, and is exercised by its own dedicated test file).
- `ApiRoutes` still `extends Directives` (`ApiRoutes.scala:123`), so `handleRejections`/
  `handleExceptions`/`cors` remain available at the call site without new imports.
- **Behavior-preserving extraction verified, not just claimed**: diffed
  `topLevelExceptionHandler`/`topLevelRejectionHandler`'s body text between round 1's
  shipped version and the new `TopLevelErrorHandlers.scala` — moved verbatim (doc
  comments included), only the enclosing `private val` → `val` visibility change (needed
  since they're now referenced cross-file) and `log` becoming object-local rather than
  `ApiRoutes`'s instance logger. No logic changed.
- D6 (`corsRejectionHandler`, `TopLevelErrorHandlers.scala:89-93`) matches its stated
  design: `403 Forbidden`, `ErrorResponse(s"CORS request rejected: ...")`, `WARN`-level,
  no stack trace, deliberately no CORS header. `CorsRejection#cause.description` is
  confirmed (both by the design-gate skeptic's jar-source read and by the live response
  body observed in Phase 3) to only echo the request's own `Origin` value back — no
  `error-response-safety` violation.
- Placement (`handleRejections(TopLevelErrorHandlers.corsRejectionHandler) { cors(corsSettings) { ... } }`,
  wrapping `cors()` from the outside) is the only placement that can intercept a
  `CorsRejection`, since `cors()` itself raises it ahead of everything nested inside —
  confirmed both structurally (reading the diff) and behaviorally (live curl, see
  Phase 3).

**Tests meaningful:** the 3 new tests in `ApiRoutesCorsErrorHandlingSpec.scala` are not
redundant with round 1's coverage — they specifically target the new outer wrapper
(disallowed-Origin → `403`, no CORS header, curated body with no raw exception/stack
text) plus a `logback` `ListAppender` assertion that the rejection logs at `WARN` with
no throwable and that no `ERROR`-level event occurs — a real, would-catch-a-regression
test for the log-level requirement, not just the response shape. The pre-existing 5
round-1 tests re-running unchanged and green is the regression-coverage evidence for
task 6.3.

**No dead code, no over-engineering.** The extraction is minimal and targeted; no new
premature abstraction layers introduced.

### Phase 3: UI Review — PASS
Trigger: `ApiRoutes.scala`/`TopLevelErrorHandlers.scala` changed.

**Important environmental step taken**: the dev backend left running from Cycle 1 was
stale (still serving round-1-only code — `sbt run` is not hot-reloading). Verified this
directly (disallowed-origin curl against the pre-restart process still reproduced the
old `500`/plain-text/no-CORS bug), then killed the stale `sbt run` process tree and
re-ran `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` → `PASS servers`,
confirming the backend was rebuilt and serving the Cycle-2 commit before drawing any
conclusions from live behavior.

- **Happy path**: reloaded the dashboard app end-to-end against the restarted backend —
  `GET /api/auth/me`, `/api/dashboards`, `/api/dashboards/:id/panels`, `/api/types/:id/rows`
  all `200`, zero console errors.
- **The fold-in fix, live-verified end-to-end**:
  - `curl -H "Origin: http://evil.example.com" .../health` → **`403 Forbidden`**,
    `Content-Type: application/json`,
    `{"message":"CORS request rejected: invalid origin 'http://evil.example.com'"}`,
    **no** `Access-Control-Allow-Origin` header. Backend log shows
    `WARN ... TopLevelErrorHandlers$ - CORS request rejected: invalid origin ...` with
    **no** stack trace and no `ERROR`-level entry — closes exactly the gap flagged in
    evaluation-1.md/skeptic-final-1.md.
  - Same check against an `OPTIONS` preflight with a disallowed origin → same clean
    `403` (not just simple `GET`s).
  - Regression-checked: allowed-origin request to a non-existent route → still `401`
    with `Access-Control-Allow-Origin` present, curated JSON body (round-1 behavior
    unchanged); no-`Origin`-header request → still unaffected; allowed-origin `OPTIONS`
    preflight → still `200` with the full CORS header set. All match round 1's
    already-verified behavior.
- **No console errors** across the tested flow.
- **Breakpoints**: not re-checked this cycle (no `frontend/**` files changed in either
  round; already confirmed zero layout risk and clean rendering at 1440/768 in
  evaluation-1.md — nothing in this diff can affect frontend layout).
- **Interactive elements/keyboard**: unaffected — no frontend surface touched.

### Overall: PASS

### Non-blocking Suggestions
- None new this cycle. `ApiRoutes.scala` (691 lines) and `TopLevelErrorHandlers.scala`
  (94 lines) both remain within `check:scala-quality`'s informational-only soft-budget
  reporting; no further split needed for this ticket's scope.
