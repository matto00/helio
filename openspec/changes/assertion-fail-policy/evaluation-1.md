## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ticket ACs verified against the actual diff (not just design.md's claims):
  1. Blocked run does not overwrite output DataType rows/schema — `PipelineRunServiceSpec` new test
     asserts `afterDt.fields == priorDt.fields`, `afterDt.version == priorDt.version`, and
     `dataTypeRowRepo.listRows(...)` unchanged. PASS.
  2. Warn-only run updates DataType normally, warning still recorded (severity `"warn"`, `passed=false`
     row persisted) — new test confirms. PASS.
  3. Blocked run's terminal status (`"failed"`) + `errorLog` discoverable via run-history — confirmed via
     `PipelineRunServiceSpec` (`runs.head.errorLog` contains rule kind, not the generic
     `"Pipeline execution failed"` placeholder) and `HookRoutesSpec`'s new test, which round-trips through
     `GET /api/pipelines/:id/run-history`. PASS.
  4. No new `pipeline_runs.status` value introduced (reuses `"failed"`) → no Flyway migration added —
     confirmed: `git diff --name-only main...HEAD | grep -i migration` returns nothing. PASS.
  5. `sbt test` passes (3002/3002, independently re-run — see Phase 2); `check:scala-quality` (no inline
     FQNs) clean. PASS.
- Tasks.md: all 20 items checked and each one traced to a real diff hunk — task 3.1's "verbatim move, not
  a rewrite" claim for the unblocked branch was independently verified: `onUnblockedRunSuccess`'s body
  (schemaUpsert/rowsUpsert/binaryRefsUpsert/alertEvaluation/updateMeta/updateRun/assertionsInsert, in that
  order) is byte-identical to the pre-change `onRunSuccess` body except the `yield ()` → `yield None`
  return-type adaptation. No hidden behavior change in the happy path.
- No scope creep: the three additional callers (`BoundPanelService`, `PipelineProposalService`,
  `HookTriggerService`) are the explicitly human-authorized scope-widening from design.md Decision 8/8a,
  not unauthorized extra work — verified all 5 `.submit(` call sites via
  `grep -rln "\.submit(" backend/src/main/scala/`, matching design.md's own audit exactly:
  `PipelineRunSubmitRoutes` (untouched, correct — direct route passes the Either straight through),
  `BoundPanelService`/`PipelineProposalService` (fixed with rollback), `PipelineSchedulerService`
  (untouched, correct — discards the Either via `.flatMap { _ => ... }` before scheduling the next tick),
  `HookTriggerService` (fixed, status-only, no rollback).
- `PipelineProposalService`'s changed method is confirmed to be `apply` (line 79), not `applyProposal` —
  the tasks.md 4.4 correction is accurate.
- Regression check: `PipelineSchedulerService.scala` and `PipelineRunSubmitRoutes.scala` diffs are empty
  (`git diff --stat` for both returns nothing) — confirmed untouched as design.md required.
- All 9 spec deltas (`alert-evaluation-engine`, `bound-panel-composition`, `datatype-row-snapshot`,
  `external-run-hooks`, `pipeline-assert-fail-policy` [new], `pipeline-list-api`,
  `pipeline-proposal-apply`, `pipeline-run-execution`, `pipeline-run-sse`) read cleanly, each carving out
  the blocked-run exception from a previously-unconditional requirement, each with a scenario that maps to
  a real new test. `combined-proposal-apply` correctly received no delta (composes `PipelineProposalService`'s
  Either unchanged, per design.md).
- Wire contract: `RunResultResponse` gains `blocked: Boolean = false` / `blockedReason: Option[String] =
  None`, `runResultResponseFormat` bumped `jsonFormat5` → `jsonFormat7` — both new fields are
  default-valued case-class parameters, so existing positional-with-defaults construction and
  spray-json's default-field decoding are unaffected; no regression to existing callers. `schemas/hook-run-response.schema.json`'s
  `description` field was genuinely updated (diff confirmed) to describe the new `"failed"` status
  value — not just claimed in files-modified.md.
- Planning artifacts (proposal.md/design.md/tasks.md) accurately reflect the final implemented behavior;
  no drift found between design.md's decisions and the actual diff.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (independently re-run in `WORKTREE_PATH`, no `CLEAN_WORKTREE` set)**:
- Changed files are 100% `backend/**` + `openspec/**`/`schemas/**` (verified via
  `git diff --name-only main...HEAD` — zero `frontend/**` paths), so only the backend gate applies.
- `cd backend && sbt test` → **3002/3002 passed, 0 failed**, `[success]` in 130s. Matches the executor's
  reported figure exactly, from a fresh independent run.
- Bonus (not strictly in scope for backend-only changes, but cheap and directly touches a file this diff
  modifies): `node scripts/check-schema-drift.mjs` → clean (57 schemas checked). `node
  scripts/check-scala-quality.mjs` → clean (no inline-FQN violations; 109 pre-existing soft file-size
  warnings, informational-only per the script's own documented behavior).

**Standards read**: `CONTRIBUTING.md` (binding). `DESIGN.md` not applicable — zero `frontend/**` files
changed.

**Canonical code-quality compliance**: No mechanical violations found.
- Imports & qualifiers: `check:scala-quality` ran clean over the changed files — no inline FQNs
  (`com.helio.X`, `spray.json.X`, etc.) in any new code. Spot-checked `PipelineRunService.scala`'s new
  `onBlockedRun`/`onUnblockedRunSuccess`/`summarizeBlockingFailures` and the 4 caller-site diffs directly;
  all types used (`AssertionResult`, `RunStatusEvent`, `ServiceError.UnprocessableEntity`) come from
  existing top-of-file imports, none newly inlined.
- File-size soft budgets (CONTRIBUTING.md:24, informational-only per `check:scala-quality`'s own
  documented behavior): `PipelineRunService.scala` grew 524→605 lines (already 274 lines over the
  ~250-line soft budget pre-change — the executor's "pre-existing oversized file this change added to"
  framing is accurate; this change did not newly trip any budget it wasn't already well past).
  `PipelineProposalService.scala` grew 399→408 lines. This one is a more precise case: it was already 149
  lines over the ~250-line soft budget before this change (399 > 250), so "pre-existing oversized file"
  is fair on that primary metric — but it's worth noting for the record that this specific change is what
  tipped it over CONTRIBUTING.md's separate, harder ~400-line "propose a split" trigger point (399→408).
  Both files' warnings are informational-only per the tool itself ("File-size warnings ... are
  informational only") and the additions here are minimal (+81 / +9 lines) and directly necessary for the
  ticket (two new private methods with real doc comments, one new guard clause) — not drive-by growth.
  Non-blocking; noted below as a suggestion.
- No FQN violations (AC5 requirement) — confirmed via the mechanical check above.

**DRY**: `summarizeBlockingFailures` is computed once and its result threaded through both `errorLog` and
`RunResultResponse.blockedReason` (via `onRunSuccess`'s `Future[Option[String]]` return value) — no
second computation anywhere, exactly as design.md Decision 8 specifies. The three caller-site guards
(`BoundPanelService`/`PipelineProposalService`/`HookTriggerService`) each reuse their existing
cleanup/rollback path rather than introducing a new one.

**Readable**: Clear naming (`onBlockedRun`/`onUnblockedRunSuccess`/`summarizeBlockingFailures`,
`blockingFailures`), no magic values — status string `"failed"` and severity string `"error"` both match
pre-existing conventions used elsewhere in the same file. Doc comments on every new/changed method cite
the specific design.md decision they implement, aiding future maintainers.

**Modular**: The blocked/unblocked split into two private methods (rather than one large `if` inside
`onRunSuccess`) is a clean decomposition — each method's job is singular and the dispatcher (`onRunSuccess`)
is now a 4-line pure routing function.

**Type safety**: `Future[Option[String]]` return type change is fully typed through the call chain
(`executeRun`'s `followUp` binding, `onDryRunSuccess`'s `.map(_ => None)` wrap); no `Any`/untyped escape
hatches introduced.

**Security**: No new external input surface. `errorLog`/`blockedReason` content is built from the
assertion rule's own `kind`/`field`/`message` (already-trusted, server-generated fields per HEL-509), not
raw user input threaded through unescaped — consistent with the HEL-311 discipline design.md cites.

**Error handling**: Blocked-run branch mirrors the existing exception-failure branch's `rowCount = None`
convention rather than inventing a new convention; `alertEvaluation`'s existing `recoverWith` isolation
(logged, never fails the run) is untouched since it's simply not invoked for a blocked run.

**Tests meaningful**: 5 new `PipelineRunServiceSpec` cases directly assert on persisted DB state (schema/
rows/version/errorLog/assertion-result rows), not just return values — each would catch a real regression
if the blocked branch accidentally ran a write it shouldn't, or skipped one it should run. The 3 new
route-level specs (`BoundPanelRoutesSpec`, `PipelineApplyProposalRollbackSpec`, `HookRoutesSpec`) exercise
the 3 newly-wired callers end-to-end (HTTP → service → DB), checking both the response shape and the
post-call resource-count/DataType-snapshot invariant. Fixture design (`rowCountMax` dataset-level rule) is
sound — deterministic and independent of the column-level fixtures used elsewhere in the file.

**No dead code**: no unused imports, no leftover TODO/FIXME in the diff; `sbt test`'s compile step (the
same run used for Phase 2's gate) produced no unused-import/unused-value warnings for any changed file.

**No over-engineering**: The `Future[Option[String]]` return-value approach (vs. e.g. a second DB
round-trip lookup) is exactly the scoped, minimal fix design.md Decision 8 argues for and no more.

**Behavior-preserving where expected**: The unblocked path (`onUnblockedRunSuccess`) is a verbatim move of
the pre-change method body — confirmed above under Phase 1.

**Pre-commit bypass characterization**: verified accurate. Running `node scripts/check-openspec-hygiene.mjs`
directly reproduces exactly the failure the commit message cites: `change "assertion-fail-policy" is
complete (20/20) but not archived — run \`openspec archive assertion-fail-policy\`` — the identical
tasks-100%-but-not-yet-archived pattern the epic's prior two tickets hit (archiving is a distinct,
later workflow phase). No other check was bypassed; lint/format:check/schema-drift/scala-quality/sbt
test all independently reproduced clean above.

### Phase 3: UI Review — N/A (confirmed, not skipped)
Issues: none.

This is a backend-only ticket. `git diff --name-only main...HEAD | grep -E '^frontend/'` returns zero
files. The only file in this diff matching a Phase-3 trigger glob is `schemas/hook-run-response.schema.json`
(matches `schemas/**`), and that edit is a `description` string-only change (no property/type/shape
change) — so I did not skip Phase 3 outright, I ran it and confirmed no observable UI impact:
- Started dev servers via `scripts/concertino/start-servers.sh` (port 6002/8909) and
  `scripts/concertino/assert-phase.sh servers` → `PASS servers`.
- Loaded `http://localhost:6002/` and `http://localhost:6002/pipelines`: both render normally
  (Dashboards page, Data Pipelines nav link), zero console errors or warnings on either page.
- No frontend code path reads `RunResultResponse.blocked`/`blockedReason` or the hook-response
  `description` field, so there is no UI surface this change could have altered — consistent with the
  ticket's own "Impact" section ("No new API route, no frontend changes").

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` (399→408 lines): this change
  is what tipped the file over CONTRIBUTING.md's ~400-line "propose a split in the PR description" trigger
  point (not just the softer 250-line budget it was already past). Worth a one-line note in a future PR
  touching this file, or a proactive split, rather than continuing to add to it silently.
- design.md Decision 7's own closing note ("a single 'run outcome' concept is currently documented in at
  least five places") is worth turning into its own follow-up ticket, independent of this one — the
  spec-delta duplication this ticket had to reproduce across `pipeline-run-execution`,
  `pipeline-run-sse`, `alert-evaluation-engine`, `datatype-row-snapshot`, and `pipeline-list-api` is a real
  maintenance cost the design doc already flagged.
