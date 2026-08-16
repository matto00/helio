## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (not from evaluator's narrative):**
- Read `ticket.md`, `proposal.md`, `design.md` (196 lines, 8 decisions + Decision 8a), `tasks.md` (20
  items), and all 9 spec deltas directly from disk.
- `git diff main...HEAD --stat` (32 files, +1907/-15) and full diffs of every backend file changed.
- Read `evaluation-1.md` only as a claims list, then independently re-derived each claim from the diff
  and by re-running commands myself (not trusting its pasted output).

**AC1 (blocked run preserves prior DataType rows/schema):** `PipelineRunService.scala`'s
`onBlockedRun` (new, lines ~407-430) skips `schemaUpsert`/`rowsUpsert`/`binaryRefsUpsert` entirely —
confirmed by reading the diff hunk and the surrounding method bodies. `PipelineRunServiceSpec`'s new
"does not update the DataType schema or rows when blocked..." test asserts `afterDt.fields ==
priorDt.fields`, `afterDt.version == priorDt.version`, and `dataTypeRowRepo.listRows(...) ==
priorRows` against a real Postgres-backed DB (embedded-postgres, not mocks). Ran it — passes.

**AC2 (warn-only run unaffected):** `blockingFailures = assertionResults.filter(r => r.severity ==
"error" && !r.passed)` (verified in the diff) — a warn-severity failure never enters this set, so
`onUnblockedRunSuccess` runs. Confirmed the diff of that branch is a byte-identical extraction of the
pre-change body (`git diff` shows only the signature/`yield ()`→`yield None` lines touched, every
schemaUpsert/rowsUpsert/binaryRefsUpsert/alertEvaluation/updateMeta/updateRun/assertionsInsert line is
unchanged context). New test "completes normally and updates the DataType when only a warn-severity
assertion fails" passes.

**AC3 (blocked run discoverable via run-history):** `onBlockedRun` sets terminal status `"failed"` with
`errorLog = Some(summary)` from the new `summarizeBlockingFailures` helper (verified: joins
`kind`/`field`/`message`, e.g. `"Run blocked: N error-severity assertion(s) failed — ..."`).
`HookRoutesSpec`'s new test round-trips through `GET /api/pipelines/:id/run-history` and asserts
`errorLog` contains `"rowCountMax"` and does NOT contain `"Pipeline execution failed"`. Passes.

**AC4 (no migration unless new status introduced):** `git diff main...HEAD --name-only | grep -i
migration` → no matches (verified myself). `"failed"` is reused, not a new status — matches Decision 1.

**AC5 (sbt test passes, no FQNs):** Ran the full backend suite myself:
`cd backend && sbt -batch test` → **3002/3002 passed, 0 failed** (fresh run, 131s). Also ran the 4
directly-relevant spec files in isolation (34/34 passed). Grepped every added line in
`backend/src/main/scala/**/*.scala` for an inline FQN pattern (`com\.helio\.[A-Za-z]+\.[A-Za-z]+\(`) —
zero matches. Ran `node scripts/check-scala-quality.mjs` myself — exit 0, clean (109 pre-existing
soft file-size warnings only, informational).

**Scope-widened call sites (the orchestrator specifically flagged these as the highest-risk area) —
all 4 independently confirmed in the actual diff, not just design.md's claims:**
1. `PipelineRunService.onRunSuccess`: return type `Future[Unit]` → `Future[Option[String]]`; dispatches
   to `onBlockedRun`/`onUnblockedRunSuccess`; `executeRun` captures the result into
   `RunResultResponse(blocked = ..., blockedReason = ...)`, wrapping `onDryRunSuccess.map(_ => None)`.
2. `PipelineProtocol.scala`: `RunResultResponse` gains `blocked: Boolean = false` /
   `blockedReason: Option[String] = None`; `runResultResponseFormat` bumped `jsonFormat5` → `jsonFormat7`.
3. `BoundPanelService.runPipeline`: new `case Right(r) if r.blocked =>` guard, correctly ordered
   *before* the unguarded `case Right(_) =>` (verified by reading the surrounding pattern-match block
   directly — Scala match order matters and it's right), reusing the existing `cleanup(...)` path.
4. `PipelineProposalService`'s `apply` (confirmed NOT named `applyProposal` — read the method signature
   at line ~310): new `case Right(runResult) if runResult.blocked =>` guard, also correctly ordered
   before the unguarded `case Right(runResult) =>`, reusing `rollbackAll(...)`.
5. `HookTriggerService.submitNewRun`: now reports `status = if (result.blocked) "failed" else
   "succeeded"`; stale comment asserting "succeeded is the only possible Right status" corrected.

**Exhaustive `.submit(` audit re-verified myself:** `grep -rln "\.submit(" backend/src/main/scala/`
→ exactly 5 call sites, matching design.md's claimed audit exactly: `PipelineRunSubmitRoutes` (route
passes `Either` straight through — correctly untouched, and correctly means `blocked` reaches the wire
for direct callers), `BoundPanelService`/`PipelineProposalService` (fixed, #3/#4 above),
`PipelineSchedulerService` (read the surrounding code myself — discards the `Either` via
`.flatMap { _ => ... }` before scheduling the next tick, correctly untouched), `HookTriggerService`
(fixed, #5 above). No 6th call site exists.

**Spec deltas (all 9 read in full):** 8 `MODIFIED Requirements` (`pipeline-run-execution`,
`pipeline-run-sse`, `alert-evaluation-engine`, `datatype-row-snapshot`, `pipeline-list-api`,
`bound-panel-composition`, `pipeline-proposal-apply`, `external-run-hooks`) + 1 `ADDED`
(`pipeline-assert-fail-policy`) — each carves out the blocked-run exception from a previously
unconditional claim, each with a scenario that maps to a real new test I found and ran. No inconsistency
between spec text and code behavior found (e.g. `alertEvaluation` genuinely is only invoked inside
`onUnblockedRunSuccess`, matching the new `alert-evaluation-engine` scenario).

**Tests are substantive, not shallow:** All 8 new tests (5 in `PipelineRunServiceSpec`, 1 each in
`BoundPanelRoutesSpec`/`PipelineApplyProposalRollbackSpec`/`HookRoutesSpec`) assert on real persisted
DB state (row snapshots, DataType version, resource counts before/after, `pipeline_run_assertions`
rows) via a real embedded Postgres, not mocked returns — each would catch a real regression if the
blocked branch ran a write it shouldn't or skipped one it should.

**Gates independently re-run (not just trusted from the evaluator's paste):**
- `cd backend && sbt -batch test` → 3002/3002 passed (fresh run).
- `node scripts/check-scala-quality.mjs` → exit 0, clean.
- `node scripts/check-schema-drift.mjs` → exit 0, clean (57 schemas checked).
- `node scripts/check-openspec-hygiene.mjs` → exit 1, but *only* for "change complete (20/20) but not
  archived" — matches the commit message's stated pre-commit-bypass reason exactly (archiving is a
  distinct, later workflow phase, not part of this commit).
- No new Flyway migration confirmed via `git diff --name-only | grep -i migration` (empty).

**UI / design judgment:** N/A. `git diff --name-only main...HEAD | grep -E '^frontend/'` → zero
matches. This is a backend-only change; `RunResultResponse.blocked`/`blockedReason` and the
hook-response schema `description` string have no frontend consumer. Confirmed no `frontend/**` paths
in the diff myself — Phase 4 correctly does not apply.

**Non-blocking documentation drift noted (not a code defect):** `proposal.md`'s "Impact" section
(line 75) still says `onRunSuccess`'s return type changes "`Future[Unit]` → `Future[Boolean]`", but
`design.md` Decision 8 (the authoritative, later-round decision) and the actual code both use
`Future[Option[String]]`. The code and design.md agree with each other and with tasks.md; only
proposal.md's Impact summary is stale from before Decision 8 was finalized at the design gate's third
round. Cosmetic — does not affect shippability.

**Environmental note (not a code defect, disclosed for transparency):** This worktree's gitignored
`scripts/concertino/` directory was missing `next-report-number.sh`/`persist-evidence.sh`/
`emit-event.sh` (present in the main checkout, evidently added there after this worktree was set up).
I copied those three generic, git-root-resolving utility scripts from the main checkout into the
worktree to complete my own reporting protocol — no reviewed code or worktree git state was touched.

### Verdict: CONFIRM

All 5 ticket acceptance criteria are traced to real, passing, DB-state-asserting tests. All 4
scope-widened call sites (the specific risk this final-gate review was asked to scrutinize) are
correctly implemented with correct pattern-match ordering, verified by reading the code directly, not
by trusting design.md's or the evaluator's account of it. The exhaustive `.submit(` call-site audit is
verified accurate (exactly 5 sites, exactly 3 fixed, 2 correctly left alone with a substantiated
reason each). All 9 spec deltas are present, internally consistent with the code, and each maps to a
real test. Full backend suite (3002/3002) and all quality/hygiene gates independently re-run and green
(openspec-hygiene's one failure is the expected, disclosed archival-only reason). No UI surface exists
for this change, so Phase 4 does not apply. This ships.

### Non-blocking notes
- `proposal.md`'s Impact section still cites the pre-Decision-8 return type
  (`Future[Boolean]` instead of the actual/final `Future[Option[String]]`) — worth a one-line fix
  whenever this change directory is next touched, but does not affect the shipped code.
- Evaluator's own suggestion (worth repeating): `PipelineProposalService.scala` crossed
  CONTRIBUTING.md's ~400-line "propose a split" trigger point (399→408) as a direct result of this
  change's `+9` lines — informational only, not a blocker.
- design.md Decision 7's closing observation (one "run outcome" concept duplicated across 5 spec
  capabilities) is a legitimate follow-up-ticket candidate, independent of this change.
