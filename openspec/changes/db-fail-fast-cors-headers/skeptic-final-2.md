## Skeptic Report — final gate (round 2 / fold-in, skeptic-final-2.md)

This is a fold-in final-gate review covering the FULL current state of the branch
`bug/db-connection-timeout-cors-headers/HEL-750` (commits `ce64260f` + `67a7ca8c` (archive) +
`edf46722` (fold-in), all reviewed fresh — not just round 2's delta). Round 1 was already
independently CONFIRMed at this gate (`skeptic-final-1.md`); this report re-establishes ground
truth for the whole branch and specifically re-verifies the fold-in scope (companion-object
extraction + disallowed-origin `CorsRejection` handling). Per the calling instructions,
`evaluation-2.md` was deliberately not read — this verdict is derived entirely from my own
independent checks below.

### What I verified (with evidence)

**Ticket / plan artifacts (read fresh):** `ticket.md` (base scope + "Added scope (fold-in,
2026-08-20)" items 3-4 and ACs 3-4), `proposal.md`, `design.md` (Decisions D1-D6, "Added scope"
context), `tasks.md` (all 20 tasks `[x]`), `specs/cors-error-handling/spec.md` delta (`MODIFIED
Requirements`, both round-1 scenarios plus the new "Disallowed-origin request receives a clean,
curated response" scenario).

**Actual diff read in full**, not summarized from `files-modified.md`:
- `git show edf46722 -- backend/src/main/scala/com/helio/api/ApiRoutes.scala` — confirms
  `topLevelExceptionHandler`/`topLevelRejectionHandler` were removed (moved verbatim, doc comments
  included) and replaced with `TopLevelErrorHandlers.*` references; `routes` now reads
  `handleRejections(TopLevelErrorHandlers.corsRejectionHandler) { cors(corsSettings) {
  handleExceptions(...) { handleRejections(...) { traceContext... } } } }` — exactly design.md's D6
  placement (outside `cors()`).
- Read `TopLevelErrorHandlers.scala` in full (94 lines) — the two round-1 handler bodies are
  byte-identical to what was removed from `ApiRoutes.scala` (diffed both sides), and
  `corsRejectionHandler` matches design D6 precisely: `RejectionHandler.newBuilder().handle { case
  r: CorsRejection => ... }.result()`, `403 Forbidden`, `ErrorResponse(s"CORS request rejected:
  ${r.cause.description}")`, `log.warn` (no throwable passed, so no stack trace).
- Confirmed `application.conf` and `DatabaseConnectionTimeoutSpec.scala` are untouched by
  `edf46722` (design's "unchanged this round" claim for HikariCP tuning holds).
- Full cross-round diff scope check (`git diff b35a6980...edf46722 --name-only`, non-openspec
  files): exactly `application.conf`, `ApiRoutes.scala`, `TopLevelErrorHandlers.scala`,
  `ApiRoutesCorsErrorHandlingSpec.scala`, `DatabaseConnectionTimeoutSpec.scala` — no unrelated
  changes, no scope creep.
- `git diff 67a7ca8c..edf46722 --name-status -- openspec/` — confirms the fold-in cleanly
  reopened the just-archived change dir (renames from `archive/2026-08-20-db-fail-fast-cors-headers/`
  back to the active `db-fail-fast-cors-headers/` dir) and correctly dropped the
  `hikaricp-pool-config` spec delta (unchanged this round) while keeping the merged
  `openspec/specs/hikaricp-pool-config/spec.md` (already carries `connectionTimeout = 5 000 ms` in
  both requirements) untouched. No orphaned/duplicate change directories.

**Fresh gate re-runs, executed by me in `WORKTREE_PATH` (not trusted from any prior report):**
- `sbt "testOnly com.helio.api.ApiRoutesCorsErrorHandlingSpec"` → **8/8 passed**, including the 3
  new fold-in tests (disallowed-origin 403/no-CORS-header, no-raw-exception-body, WARN-not-ERROR
  logging via a `ListAppender` capture).
- Full `cd backend && sbt test` → **3342/3342 passed, 212 suites, 0 failed** — independently
  reproduces the executor's/evaluator's claimed count exactly.
- `node scripts/check-scala-quality.mjs` → clean, exit 0 (128 pre-existing soft warnings,
  `ApiRoutes.scala` itself now 691 lines vs. 720 before the extraction — informational-only per
  CONTRIBUTING.md, not a mechanical failure).
- `npm run format:check` → clean.
- `openspec validate db-fail-fast-cors-headers --strict` → `Change 'db-fail-fast-cors-headers' is
  valid`.
- `npm run check:openspec` → flags "complete (20/20) but not archived" — the expected
  pre-Delivery-phase state, same precedent as round 1 and the HEL-757 fold-in; not a defect.
- `grep -n "org\.apache\.pekko\.\|com\.helio\.\|spray\.json\."` on both changed main files
  (excluding `import`/`package` lines) → no hits — no inline-FQN violations (CONTRIBUTING.md).

**Live behavior against the running dev backend on :9089** (confirmed serving current code —
compiled `.class` files for `TopLevelErrorHandlers` postdate the source, and my own curl requests
show up live in `.concertino-backend.log`):
- `curl -H "Origin: http://localhost:6182" .../api/this-route-does-not-exist-xyz` → `401`,
  `Access-Control-Allow-Origin: http://localhost:6182` present, JSON `{"message":"Unauthorized"}`
  — allowed-origin path from round 1 still works (no regression from the fold-in wrapper).
- `curl -H "Origin: http://evil.example.com" .../health` → **`403 Forbidden`**, **no**
  `Access-Control-Allow-Origin` header, body `{"message":"CORS request rejected: invalid origin
  'http://evil.example.com'"}` — this is the exact scenario round 1's own skeptic reproduced as a
  live `500`/plain-text/no-CORS bug (`skeptic-final-1.md`); it is now cleanly closed.
- `grep "ERROR" .concertino-backend.log` → **0 hits in the entire log**, while `grep "WARN"` shows
  `c.helio.api.TopLevelErrorHandlers$ - CORS request rejected: invalid origin
  'http://evil.example.com'` for each of my disallowed-origin requests — confirms AC4 / spec
  scenario 4 ("logged server-side at a level below ERROR, with no stack trace") directly, not just
  via the test suite.
- `curl -H "Origin: http://localhost:6182" .../api/dashboards` (no session) → `401` with
  `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials` — unaffected regression check.
- `curl` with no `Origin` header on `/health` → plain `200`, no CORS header — same-origin/non-CORS
  traffic unaffected by the new outer wrapper.

### Acceptance criteria traced to evidence

1. DB outage fails within seconds, not ~30s → `application.conf:87,131` `connectionTimeout = 5000`
   on both pools; `DatabaseConnectionTimeoutSpec` (round 1, untouched, still green) exercises this
   against a real blackhole socket.
2. Every response from an allowed origin carries CORS headers + clean `ErrorResponse` →
   `ApiRoutesCorsErrorHandlingSpec`'s original 5 tests, still green; independently reproduced live
   above (401/`Access-Control-Allow-Origin` present).
3. Top-level handlers live in a separate companion object, no behavior change →
   `TopLevelErrorHandlers.scala` houses them verbatim; full regression suite (3342/3342) green,
   including every test that exercises these handlers indirectly.
4. Disallowed-`Origin` request gets a clean, curated response, no CORS headers → new
   `corsRejectionHandler`; verified by 3 new automated tests AND independently reproduced live
   (403/no-header/WARN-only-log, above).

All 4 ACs trace to real, independently-reproduced evidence — no AC left uncovered.

### Iron Laws

- **Verification-before-completion**: every gate re-run above is fresh output I read myself, not
  copy-pasted from `evaluation-2.md` (which I deliberately did not read, per the calling
  instructions).
- **Systematic-debugging**: this fold-in item fixes a genuine masking bug (disallowed-origin
  requests hitting Pekko's raw default). The root cause is probe-confirmed at two levels: (a)
  `skeptic-design-2.md` decompiled the resolved `pekko-http-cors`/`pekko-http` jar sources to prove
  `cors()` mints its own `CorsRejection` outside the inner handler scope; (b) round 1's skeptic
  live-reproduced the actual pre-fix bug via curl (`500`/plain-text/no-CORS for a disallowed
  origin). The new tests exercise exactly this path and would have failed against the pre-fix code
  (a disallowed origin would 500 with no `ErrorResponse` shape, not 403) — this is a real regression
  test, not a vacuous one, and I independently confirmed the fixed behavior live in addition to the
  automated coverage.

### Branch/PR state

PR #403 is `OPEN`, `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE` against current `origin/main`
(confirmed via `gh pr view`), and currently carries only round 1's two commits — `edf46722` (the
fold-in) is a local commit not yet pushed. `git merge-tree` against current `origin/main` shows no
conflicts. This is expected mid-Delivery state (push + PR update is a later Delivery step), not a
defect in the change itself.

### Verdict: CONFIRM

The branch, in its full current state (round 1 + fold-in), ships. All 4 ACs trace to
independently-reproduced evidence — both automated (8/8 focused tests, 3342/3342 full backend
suite) and live (direct curl against the running dev backend, log inspection). The fold-in's
companion-object extraction is genuinely behavior-preserving (verbatim handler bodies, full
regression pass) and its `corsRejectionHandler` closes the exact residual gap round 1's own
skeptic live-reproduced, without touching the already-verified allowed-origin behavior. No
placeholders, no scope creep, no contradiction between the planning artifacts and the
implementation, no inline-FQN violations, clean lint/format/openspec-validate. Nothing here
warrants sending it back.

### Non-blocking notes

- `ApiRoutes.scala` is still 691 lines — well above CONTRIBUTING.md's ~250-line soft budget and
  its ~400-line "propose a split" guidance, even after this round's extraction (720 → 692 was the
  narrowly-scoped win the ticket asked for: moving the two handlers it had added, not a general
  file-size remediation). `check:scala-quality` treats this as informational-only, and dozens of
  other files across the codebase are in the same state, so this is pre-existing debt, not a
  regression — but a future ticket to decompose `ApiRoutes.scala` along route-group boundaries
  would be a reasonable next step, separate from this one.
- `edf46722` is not yet pushed to `origin`, and `origin/main` has advanced by one commit
  (`47347a6e`, HEL-727) since this branch's base — no conflicts (`git merge-tree` clean), but the
  Delivery step should push and let CI re-run on the full branch before the actual merge.
