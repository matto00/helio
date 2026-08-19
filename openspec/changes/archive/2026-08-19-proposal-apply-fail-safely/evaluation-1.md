## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verification detail:
- All 5 ticket ACs addressed explicitly, none reinterpreted:
  - Root cause traced to specific lines (design.md Context, confirmed against actual pre-fix code:
    `handleInlineCreated`'s delete-and-abort on `fetchError`, plus the independent
    `PipelineRunService.runPipeline`/`InProcessPipelineEngine.loadRows` categorical `rest_api`/`sql`
    rejection).
  - Fix returns `201 Created` (never a raw 502/exception) — confirmed via
    `PipelineApplyProposalRollbackSpec.scala`'s rewritten assertions (`status shouldBe
    StatusCodes.Created`).
  - Source + pipeline retained on an unreachable REST source, `fetchError` surfaced via
    `blockedReason` — confirmed in `PipelineProposalService.scala` diff (`handleInlineCreated`,
    `createPipeline`'s new branch) and exercised by the rewritten "schema-fetch failure" test.
  - Response carries `pipeline`/`source` ids the user can act on — unchanged wire shape, confirmed no
    `schemas/` diff and `npm run check:schemas` passes clean.
  - Regression coverage present and DB-verified (see Phase 2).
- tasks.md 1.1–1.6 and 2.1–2.7 all checked `[x]`, and each was independently verified against the
  actual diff (not just trusted): `ResolvedSource.kind`/`fetchError` fields, `SparkUnsupportedKinds`
  companion-object constant, `handleInlineCreated`'s new `kind` parameter, `recordUnrunnable`,
  `createPipeline`'s new guarded branch (ordered correctly before the unguarded `Right(_)` case), all
  four rewritten/new `PipelineApplyProposalRollbackSpec` tests (healthy-inline-rest, fetch-failure,
  inline-sql, existing-sourceId), the `PipelineRunServiceSpec` `recordUnrunnable` unit test, and a full
  `sbt test` run (task 2.7) — see Phase 2.
- No scope creep: `git diff --name-only main...HEAD` for code files matches `files-modified.md`
  exactly (`PipelineProposalService.scala`, `PipelineRunService.scala`,
  `PipelineApplyProposalRollbackSpec.scala`, `PipelineApplyProposalSpecBase.scala`,
  `PipelineRunServiceSpec.scala`, plus the `openspec/changes/...` planning artifacts). Task 1.6
  (verify `CombinedProposalService`/`CombinedProposalRoutes` need no change) was correctly
  verification-only — confirmed those files are untouched and that `CombinedProposalService.apply`'s
  composition of `pipelineProposalService.apply` still works correctly for the new blocked-but-`Right`
  case (the dashboard phase binds to the pipeline's now-empty-but-real output DataType, consistent
  with the ticket's "lands on a real pipeline" goal).
- No regressions to existing behavior: the three genuinely-still-rollback tests (assert-blocked run,
  addStep failure, cross-tenant sourceId) are byte-for-byte unchanged in the diff; the pre-existing
  `PipelineApplyProposalSpec`'s static-source happy-path test (unchanged, not in this diff) still
  asserts an eager run with `rowCount == 2`, confirming `static`/`csv` is unaffected (task 2.5).
- API contracts: correctly unchanged — D2's rejected alternative (a new wire variant) would have
  needed a schema update; the chosen approach (reuse existing `blocked`/`blockedReason`) does not, and
  `check:schemas` confirms no drift.
- Planning artifacts (design.md D1–D3, tasks.md, spec.md delta) match the implemented behavior exactly
  — cross-checked line-by-line against the diff, no discrepancies found.
- Follow-up ticket HEL-758 (deferred real execution support) independently confirmed to exist in
  Linear (status: Backlog, correctly scoped, correctly cross-references HEL-755) — the round-1 skeptic
  REFUTE finding this was fabricated in an earlier draft is resolved for real, not just claimed.

### Phase 2: Code Review — PASS

Issues: none blocking.

Fresh gate re-runs (independent of the executor's self-report), all green:
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm run check:schemas` — clean (66 protocols checked, 47 files).
- `npm run check:scala-quality` — clean, 0 hard errors; 122 soft (file-size) warnings, all pre-existing
  across the repo (see file-size note below for the two touched files that also appear on this list).
- `npm test` (root jest + `frontend`) — 8 suites/186 tests (helio-mcp) + 218 suites/2342 tests
  (frontend) all passed, matching the executor's claimed counts exactly.
- `cd backend && sbt test` — 3284/3284 tests passed, 210 suites, 0 failures, matching the executor's
  claimed counts exactly.
- `npm run check:openspec` — **fails**, but for exactly and only the expected reason: "change
  `proposal-apply-fail-safely` is complete (13/13) but not archived." This is the sole check that
  fails; nothing else does. Confirms the `-n` bypass was legitimate and correctly scoped — every other
  pre-commit check (lint, format, schemas, scala-quality, tests) was independently re-run fresh here
  and is green, not merely self-reported. The commit body calls out the bypass explicitly per
  CONTRIBUTING.md's AI-collaborator policy.

Code-quality review (CONTRIBUTING.md, mechanical rules):
- **Imports & Qualifiers**: no inline FQNs in any touched file — confirmed both by
  `check:scala-quality` (0 hard errors) and manual read of `PipelineProposalService.scala`/
  `PipelineRunService.scala`'s import blocks (top-of-file, explicit, alphabetized within the group;
  `DataSourceKind` correctly added to the existing `com.helio.domain` import in `PipelineRunService.scala`).
- **ACL triad**: `recordUnrunnable`'s `insertRun`/`updateRunTerminal`/`updateLastRun` calls all go
  through the owner-scoped, `AuthenticatedUser`-taking overloads (`ctx.withUserContext`), matching the
  existing `onBlockedRun` pattern exactly — no privileged/`Internal` variant used where an owner-scoped
  one was appropriate.
- **File-size soft budget [mechanical, but explicitly non-blocking by the check's own design]**:
  `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` was already 408 lines
  before this change (already over the ~400-line "propose a split" prose threshold) and grows to 449
  lines; `PipelineRunService.scala` goes from ~695 to 733 lines. Both are flagged only as *soft*
  warnings by `check-scala-quality.mjs` (`process.exit(1)` never fires for file size — script header
  explicitly documents this as "warn, do not fail"), and the growth here is a small, targeted, in-scope
  addition to a file that was already over budget pre-existing — not something this change introduced.
  Not a blocking violation; see Non-blocking Suggestions.
- **DRY**: `SparkUnsupportedKinds` is added as a single source of truth specifically to avoid a third
  copy of the `rest_api`/`sql` kind list (design.md D2 explicitly reasons about this); `recordUnrunnable`
  mirrors `onBlockedRun`'s existing persistence pattern rather than inventing a new one; the new
  `latestPipelineRun` test helper reuses the existing `ctx.withSystemContext`/`countRows` convention.
- **Readable / no magic values**: blocked-reason strings are constructed clearly and reference the
  actual `resolved.kind`/`fetchError`; the `Right(_) if ... contains(resolved.kind)` guard is commented
  with an explicit "must be checked BEFORE the unguarded case below" note, matching the pre-existing
  convention two cases below it for `runResult.blocked`.
- **Type safety**: `kind: String` on `ResolvedSource` reuses the existing `DataSourceKind`
  string-constant convention already used throughout the domain layer (`DataSource.kind: String`) —
  not a new untyped escape hatch.
- **Error handling**: `fetchError` is threaded, never silently dropped; `recordUnrunnable`'s
  best-effort `insertRun.recoverWith` mirrors the same resilience pattern used at every other
  `pipelineRunRepo` call site in this file (verified: 6+ other call sites use the identical
  `pipelineRunRepo != null` / `recoverWith` guard, so this isn't a new anti-pattern, it's consistency
  with existing style).
- **Tests meaningful, DB-verified**: the rewritten/new `PipelineApplyProposalRollbackSpec` tests assert
  resource counts (not rolled back), the HTTP response's `run.blocked`/`blockedReason`, **and** a
  direct `pipeline_runs` row read via the new `latestPipelineRun` helper — proving the run is durably
  persisted, not just transiently returned (design.md D3's actual concern). The new SQL test
  (`localhost:1`) exercises the real `SqlConnector` (not a stub) and asserts the real
  `"SQL execution failed"` message (confirmed against `SqlConnector.scala:110-113`, which is reached
  via `inferSchema`→`execute`, the actual code path `CreateSourceEnvelope.build` calls — not the
  different `"SQL connection failed"` message `testConnection` would produce, which is a different,
  unused-here method). `PipelineRunServiceSpec`'s new `recordUnrunnable` test asserts both the returned
  `RunResultResponse` and the persisted side effects (`pipeline.lastRunStatus`, the `pipeline_runs` row)
  directly via repository reads, not just the response.
- **No dead code**: `ServiceError.BadGateway` (no longer constructed in `PipelineProposalService.scala`)
  remains actively used at 10+ other call sites across the codebase — not orphaned.
- **No over-engineering**: no new abstractions beyond the single `SparkUnsupportedKinds` constant the
  design explicitly justifies; D4 (pre-validation via `testConnection`) was correctly NOT adopted —
  confirmed no `testConnection`/`ConnectionTest` reference was added to `PipelineProposalService.scala`.
- **Behavior-preserving where expected**: `static`/`csv` eager-run path, `rollbackAll`/
  `rollbackSourceOnly`, and the three unrelated rollback scenarios are all confirmed byte-for-byte
  unchanged in the diff.

### Phase 3: UI Review — N/A

No files matching the Phase 3 triggers changed: `git diff --name-only main...HEAD` contains no
`frontend/**`, no `backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, and no
`openspec/specs/**` (the touched `openspec/changes/proposal-apply-fail-safely/specs/...` path is the
change's own spec-delta staging area, not the canonical archived specs tree). This is a pure
backend-service bug fix with no route/wire-contract changes, consistent with design.md D2's explicit
"no new wire fields, no schema change" decision. Dev servers were not started.

### Overall: PASS

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` (449 lines) and
  `PipelineRunService.scala` (733 lines) are both over CONTRIBUTING.md's ~400-line "propose a split"
  prose threshold (pre-existing before this change, not introduced by it). Worth a follow-up ticket to
  split these — `PipelineRunService.scala` in particular is now approaching 3x the soft budget.
- The outer `describe` block in `PipelineApplyProposalRollbackSpec.scala` is still named `"POST
  /api/pipelines/apply-proposal rollback"`, but half its cases (the four new/rewritten HEL-755 ones) now
  assert the opposite — no rollback happens. A future pass could split these into a differently-named
  `describe` block for clarity, though the file-level doc comment already explains this well.
