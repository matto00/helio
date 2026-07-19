## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All three ticket ACs satisfied: `OAuthRoutes.scala:134` no longer echoes `ex.getMessage`
  (now `log.error(..., ex)` + generic `ErrorResponse("Internal server error")`); `audit.md`
  enumerates every route/service/domain site touched by the `getMessage`/`getLocalizedMessage`
  grep plus a `PSQLException` review, each classified FIX or CONFIRM-SAFE with rationale; a new
  `GoogleOAuthRoutesSpec` test asserts the OAuth 500 body is generic (no raw exception text) and
  that the detail is logged via a logback `ListAppender`.
  - No AC was reinterpreted — the Option C full-sweep scope was an explicit human decision
    recorded in `design.md`'s Planner Notes and `ticket.md`/`workflow-state.md`, not a
    self-expansion by the executor.
- All 39 `tasks.md` items are checked, and each maps to a verified diff hunk (spot-checked every
  file listed in `files-modified.md` against `git diff main...HEAD`; all match the audit note's
  before/after text exactly).
- No scope creep found: every touched file is on the design's enumerated candidate list or the
  audit's "additional sites found by the grep-complete sweep" section (`SparkJobSubmitter`,
  `LocalFileSystem`, `PipelineStepRepository`), each with an explicit reachability trace.
  `DataSourceService` was named in the proposal's Impact section as a candidate but correctly
  left untouched — independently re-grepped it for `getMessage`/`getLocalizedMessage`/
  `PSQLException`: zero hits.
- No regressions: `SourceService`'s four `BadGateway` arms were simplified from double-prefixed
  strings (`"SQL execution failed: SQL execution failed"`-shaped) to pass the now-generic
  connector `err` straight through — verified this is not a silent behavior change since the
  connector's `err` is already the intended client message post-fix.
- No wire-schema/API-contract changes — only error-body **text** on failure paths changed, as
  scoped; `schemas/` untouched, confirmed via `git diff --stat`.
- Planning artifacts (design.md, tasks.md, audit.md) accurately reflect the final implementation;
  `tasks.md`'s deviation note on 6.4 (`SparkJobSubmitter`/`PipelineRunCache` not yet wired to any
  live route per pre-HEL-202) is corroborated by `audit.md`'s reachability trace and independently
  verified via `grep -rn "\.submit(" backend/src/main/scala/com/helio/` (only
  `PipelineRunService.submit` call sites match; `SparkJobSubmitter.submit` is unreferenced).

### Phase 2: Code Review — PASS
Issues: none.

- **CONTRIBUTING.md mechanical compliance**: `npm run check:scala-quality` passes clean (0
  inline-FQN violations across all touched files; every new import — `org.slf4j.LoggerFactory`,
  logback test imports — is a top-of-file import, never inline). 44 pre-existing file-size soft
  warnings reported (informational only per CONTRIBUTING.md, not build-breaking). The largest
  touched file, `PipelineService.scala`, was already at 423 lines (over the ~250 soft budget and
  past the ~400-line "propose a split" trigger) before this change and grew by only ~19 lines to
  442 as a direct result of the required logger + per-branch log calls — a pre-existing condition
  the ticket did not introduce and correctly did not attempt to fix as a drive-by refactor, per
  CONTRIBUTING.md's "keep refactors behavior-preserving" guidance.
- **HEL-299 logger pattern followed** in every file that gained a FIX and lacked a logger:
  `private val log = LoggerFactory.getLogger(getClass)` (or companion-object equivalent),
  `log.error/warn(<context>, ex)` before returning the generic message — matches
  `PipelineRunStreamRoutes`'s existing pattern (verified `log.error(s"...", ex)` call there).
- **Static/curated prefixes preserved, only raw exception tails removed** — verified at every
  site: `"Invalid '<type>' config"` (dropped `: ${ex.getMessage}`), `"SQL execution failed"`,
  `"Request failed"`, `"Could not resolve host '$host'"` (kept caller-supplied hostname, dropped
  resolver exception tail), `"<op> config error"` (5 sites in `PipelineAnalyzeService`),
  `"Pipeline execution failed"`. No case found where a curated message was fully genericized
  when it should have been narrower, or vice versa.
- **DRY**: `SourceService`'s `BadGateway` arms were correctly simplified (not double-wrapped)
  once the connector layer already returns a generic string — this is the DRY-correct outcome,
  not scope creep.
- **Type safety / error handling**: no new escape hatches; `.recover`/`Failure(ex)` arms
  consistently log-then-genericize; the `PanelConfigCodec.safe` split between
  `DeserializationException` (curated, left alone with a documented invariant comment) and
  generic `Throwable` (FIXed) is a correct and well-reasoned classification, independently
  verified by grepping all 53 `deserializationError(...)` call sites under `domain/panels/` —
  none embeds a raw exception message.
- **Tests meaningful**: every new/strengthened test uses a logback `ListAppender` to assert the
  raw secret/exception text *is* logged server-side (not just that the client body lacks it) —
  this would catch a real regression (e.g. someone reverting to `ex.getMessage` client-side, or
  removing the log call). Spot-checked `GoogleOAuthRoutesSpec`, `ApiRoutesSpec`,
  `PanelServiceBatchUpdateErrorSpec`, `PipelineRunRoutesSpec` (SSE + run-history + direct-body,
  covering all three fan-out surfaces), `SparkJobSubmitterSpec` — all assert exact generic
  messages plus explicit `should not include <raw-detail>`, not merely `should include`.
- **No dead code**: no leftover TODO/FIXME; the `SparkJobSubmitter` fix is explicitly justified
  as defense-in-depth for a not-yet-live code path with a spinoff note for HEL-202, not dead
  code left unexplained.
- **No over-engineering**: the design's rejected alternative (a single shared "sanitize on the
  way out" wrapper in `ServiceResponse`) was correctly not implemented; per-site classification
  matches what shipped.
- **Behavior-preserving where expected**: status codes are unchanged everywhere audited; only
  body text changed on failure paths, as scoped.

### Phase 3: UI Review — N/A
Backend-only change (confirmed via `git diff main...HEAD --stat`: no `frontend/**`, no
`schemas/**` changes). `ApiRoutes.scala` changed, but only in two `Failure(ex)` catch arms'
body *text* — no route path, status code, or wire-shape change. Independently grepped
`frontend/src` for the new/old error-message strings (`Pipeline execution failed`,
`Batch update failed`, `SQL execution failed`, `Could not resolve host`, `config decode failed`,
`config error`) — zero hits, so no frontend code branches on the altered text. No UI review
required.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None beyond what's already tracked: the `tasks.md` 6.4 deviation note recommends
  re-verifying `RunStatusResponse.error` end-to-end via an HTTP-level test once HEL-202 wires
  `SparkJobSubmitter.submit` into a live route — appropriately deferred as a spinoff, not
  required for this ticket.

### Verification Evidence (fresh, re-run by evaluator)
- `openspec validate harden-error-response-leaks --strict` → `Change 'harden-error-response-leaks' is valid`
- `cd backend && sbt test` → `Tests: succeeded 1395, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed.`
- `npm run check:scala-quality` → `Scala code-quality check: clean (44 soft warning(s))` (0 inline-FQN errors)
- `grep -rn "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/` → output matches
  `audit.md`'s re-grep confirmation exactly (16 residual lines, all previously classified
  CONFIRM-SAFE or "not a leak site")
- `grep -rn "PSQLException" backend/src/main/scala/com/helio/` → matches audit.md's PSQLException
  review exactly
- Independently spot-checked ~14 production-file diffs against `audit.md`'s per-site before/after
  claims — all matched verbatim
