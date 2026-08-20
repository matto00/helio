## Evaluation Report — Cycle 1 (evaluation-1.md)

### Review-surface note
`git diff main...HEAD` in this worktree is misleading: the worktree's local `main`
ref is stale (2 commits behind `origin/main` — missing already-merged HEL-757 #400
and HEL-758 #401). The actual scope of this ticket is the single commit
`ce64260f`, confirmed via `git log origin/main..HEAD` (one commit) and
`git diff origin/main...HEAD --stat` (14 files, exactly matching
`files-modified.md`). All review below is scoped to that diff.

### Phase 1: Spec Review — PASS
Issues: none blocking.
- Ticket item 1 (HikariCP `connectionTimeout = 5000` on both `helio.db` and
  `helio.db.privileged`) — implemented exactly, with inline rationale comments
  mirroring the existing tuning-comment style.
- Ticket item 2 (`ExceptionHandler`/`RejectionHandler` registered inside
  `cors(corsSettings) { ... }`) — implemented exactly at the documented
  insertion point (`ApiRoutes.scala:456-505`), before `traceContext.withTraceContext`.
- All 11 tasks marked `[x]` in `tasks.md` match what was actually implemented —
  verified each against the diff and the two new spec files.
- No scope creep — diff touches only `application.conf`, `ApiRoutes.scala`, two
  new test files, and the change's own openspec artifacts.
- No regression to existing behavior — `ApiRoutesCorsErrorHandlingSpec` explicitly
  regression-tests an existing successful response and an existing curated 404
  (`ErrorResponse("Dashboard not found")`) to confirm both are unaffected; full
  `sbt test` (3339/3339) confirms no other suite broke.
- No API contract change — reuses the existing `ErrorResponse(message: String)`
  shape; `check:schemas` passes clean (66 protocols, 47 files).
- Planning artifacts (proposal/design/tasks/spec deltas) accurately reflect the
  final implementation; `files-modified.md` is accurate.

One noteworthy but non-blocking finding (see Phase 3): the spec delta's rejection
scenario is explicitly scoped to "a request from an allowed CORS origin," and the
implementation matches that scope precisely — it does not silently narrow or widen
what was written. See Phase 3 for the observed edge-case gap this scoping leaves.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Fresh gate re-runs (all executed by me in `WORKTREE_PATH`, not trusted from the
executor's report):**
- `cd backend && sbt test` → `3339/3339` passed, `0` failed, `212` suites completed
  (matches the executor's claimed count).
- `npm run check:scala-quality` → `Scala code-quality check: clean (127 soft
  warning(s))`, exit 0. No inline-FQN hard violations in the diff (imports for
  `spray.json._`, `ContentTypes`/`HttpEntity`/`HttpResponse`, `ExceptionHandler`/
  `RejectionHandler` are all proper top-of-file imports).
- `npm run check:schemas` → in sync, no drift.
- `npm run check:openspec` → flags "complete (11/11) but not archived," exactly
  matching the executor's stated (and repo-precedented, see commit b35a6980/HEL-757)
  reason for the `-n` pre-commit bypass on this one check only. No other check was
  bypassed per the commit body.
- No `frontend/**` files changed — frontend gates (`lint`/`format:check`/`test`/
  `build`) correctly not applicable.

**CONTRIBUTING.md compliance:**
- Imports & Qualifiers: clean — no inline FQNs introduced (`grep`-verified).
- File-size soft budget: `ApiRoutes.scala` is now 720 lines (`ApiRoutes.scala:1-720`),
  already well past the ~400-line "propose a split" threshold *before* this diff
  and grown further by ~54 net lines. `check:scala-quality` correctly reports this
  as a **soft/informational** warning only (not a hard gate failure), so this does
  not fail Phase 2, but see Non-blocking Suggestions.
- `log` (existing `LoggerFactory` logger, `ApiRoutes.scala:127`) is reused correctly
  in the new `ExceptionHandler` rather than introducing a second logger.
- `RejectionHandler.default.mapRejectionResponse` (`ApiRoutes.scala:499-503`)
  preserves each rejection's original status code and message text, only rewrapping
  the body from `text/plain` into the JSON `ErrorResponse` shape — matches D4's
  intent even though the literal builder syntax differs slightly from the design's
  suggested `RejectionHandler.newBuilder().withFallback(...)` (skeptic's own
  design-gate report flagged this exact construction as "implied rather than
  spelled out," non-blocking).
- `error-response-safety` invariant respected by construction: the new
  `ExceptionHandler` never touches `ex.getMessage`/`getLocalizedMessage` in the
  response, only in the server-side log line.

**DRY / Readable / Modular / Type safety / Security / Error handling:** no issues.
Handlers are small, single-purpose, well-commented, and placed at the one call
site design.md specifies. No dead code, no leftover TODO/FIXME. Not over-engineered
— a plain `ExceptionHandler`/`RejectionHandler` pair, no premature abstraction.

**Tests meaningful:** `ApiRoutesCorsErrorHandlingSpec` (196 lines) exercises a real
unhandled-exception path via a poisoned `UserSessionRepository` stub (reproducing
the incident's actual failure shape — a synchronous throw escaping route
evaluation, not a contrived `Future.failed`), a real rejection path (unmatched
route), and regression-covers the existing success/curated-error paths.
`DatabaseConnectionTimeoutSpec` (85 lines) exercises the real
`Database.forConfig("helio.db", config)` production call path against a
TCP-accepting-but-silent "blackhole" socket and asserts the failure lands in
`[3000ms, 15000ms)` — a real regression test for the ~30s-hang defect, not a
mock. Both would catch a real regression if either handler were removed or the
`connectionTimeout` reverted.

### Phase 3: UI Review — PASS
Trigger: `backend/src/main/scala/com/helio/api/ApiRoutes.scala` changed.

Servers started via `scripts/concertino/start-servers.sh` /
`assert-phase.sh servers` → `PASS servers` (backend :9089, frontend :6182).

- **Happy path**: loaded the dashboard app end-to-end (dashboard list, panel
  render, sidebar nav) — `GET /api/auth/me`, `/api/dashboards`, `/api/dashboards/
  :id/panels`, `/api/types/:id/rows` all `200`, zero console errors.
- **Unhappy/error path (live, against the running backend, not just the test
  suite)**: `curl` with `Origin: http://localhost:6182` (an allowed origin) against
  a non-existent route → `401` with `Access-Control-Allow-Origin` present and a
  clean JSON `{"message":"Unauthorized"}` body (auth runs ahead of routing here);
  with a valid session cookie this becomes the tested `404` scenario. Requests with
  no `Origin` header behave identically minus the CORS header (expected — not a
  cross-origin request). Matches the ticket's real incident shape and the spec's
  scenarios.
- **No console errors** across the tested flow; verified via
  `browser_console_messages`.
- **Breakpoints** (1440 / 768 checked via screenshot): layout renders correctly at
  both; expected, since no `frontend/**` files changed at all — zero UI-layout
  risk from this diff.
- **Interactive elements / keyboard**: unaffected — no new frontend surface was
  added by this change.

**One live-verified gap, judged non-blocking (see Non-blocking Suggestions)**: a
request carrying an explicitly *disallowed* `Origin` header (e.g.
`http://evil.example.com`) still reproduces the exact original masking bug —
`500 Internal Server Error`, `Content-Type: text/plain`, body
`"There was an internal server error."`, **no** CORS headers — and the backend
log shows `Unhandled rejection: CorsRejection(InvalidOrigin(...))` /
`RuntimeException: Unhandled rejection...` at `ERROR` with a full stack trace.
Root cause: `cors()` itself raises `CorsRejection` when the `Origin` doesn't match
the allowlist, and it does so as the *outermost* directive — before the new
`handleExceptions`/`handleRejections` block, which sits *inside* `cors()` per the
ticket's explicit instruction ("inside the cors() wrapper, not outside it"). That
placement is structurally correct for the ticket's actual incident (a route-level
failure from a legitimate, allowed-origin browser session) and matches the spec
delta's scenario text verbatim ("a request from an allowed CORS origin"/"no Origin
header" cases are unaffected and correctly handled) — but a disallowed-origin
request (bot/scanner traffic spoofing an `Origin` header, not something a real
browser session would ever trigger against an allowed-origin frontend) still hits
Pekko's raw default handling. Not attaching CORS headers to a disallowed origin is
correct on the merits; the residual issue is the ERROR-level stack-trace log spam
and the plain-text (not `ErrorResponse` JSON) body for that one path.

### Overall: PASS

### Non-blocking Suggestions
- `ApiRoutes.scala` is now 720 lines, well past CONTRIBUTING.md's ~400-line
  "propose a split in the PR description" threshold (soft/informational only —
  does not block `check:scala-quality`). Consider extracting
  `topLevelExceptionHandler`/`topLevelRejectionHandler` (and their doc comments,
  `ApiRoutes.scala:456-505`) into a small companion object
  (e.g. `com.helio.api.TopLevelErrorHandlers`) in a future pass, since neither
  handler needs access to any of `ApiRoutes`'s constructor-injected repositories.
- Live-verified gap: a request with an explicitly disallowed `Origin` header still
  produces Pekko's raw `500`/plain-text/no-CORS-header default response and logs a
  full stack trace at `ERROR` (see Phase 3). Worth a small spinoff ticket to add
  `CorsDirectives`'s own `corsRejectionHandler` (or equivalent) *outside* `cors()`
  specifically for `CorsRejection`, so that path also gets a clean, quiet, curated
  response instead of the pre-existing masking behavior this ticket otherwise
  eliminates. Not required for this ticket's stated AC, which explicitly scopes the
  rejection scenario to "a request from an allowed CORS origin."
