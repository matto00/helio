# Evaluation Report — FINAL (evaluation-7.md), cycles 7-8 + holistic

Ticket: HEL-906 (P1.3). Change: `output-routes-api-contracts`.
Reviewed head `856e23f0` (cycle 8, docs) on `73ac2050` (cycle 7), across the full
`main...HEAD` diff: **8 commits, 95 files, +8,057 / −172**.

This is a holistic final evaluation, not a delta re-check. Verdict: **PASS.**

## Phase 1: Spec Review — PASS

### AC table — assessed against `ticket.md`, accounting for the coordinator-approved split

| # | Acceptance criterion | Verdict |
|---|---|---|
| 1 | Route specs cover every new route incl. ACL (owner/grantee/other → 200/200/404), **and** the single-call `create_pipeline` transaction rolls back on a failing step or Output | **PASS** — every route in this PR's scope is built and spec'd; the two remaining route-adjacent items (2.7 decision-15 layout, 3.10 `inferredSchema`) are **correctly descoped to HEL-933**, not failed. Rollback proven by `PipelineCreateTransactionalSpec`'s two rollback tests, still carrying the raw-SQL `select count(*)` assertion that bypasses the repository ACL path. |
| 2 | sum/avg binds; `select`-produced column bindable; bad slot → 400 | **PASS** |
| 3 | Enumerate every producer of a field-type string; assert each emits canonical values | **PASS** — closed structurally (boundary validation + 4 schema `enum`s + `SchemaField` constructor guard + real-dump fixture guard + tolerant read). The compiler-enforced typed refactor is explicitly deferred to **HEL-931**. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | **PASS** |
| 5 | Retired routes (`/api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query`) 404 | **PASS** |
| 6 | `assertion-status` reports the last run's outcome; alert rules against `targetOutputId` | **PASS** |
| 7 | `check-schema-drift.mjs` green with the proposal files untouched | **PASS** — re-confirmed for the **eighth consecutive cycle**. |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` + `check:openspec:selftest` green; no `@deprecated`, alias, or shim | **PASS** — selftest run explicitly this time: **17 passed, 0 failed**. |
| 9 | Per-node projection exercised by `capabilities?stepId=` | **PASS** |

**9 of 9 AC met**, with four items correctly descoped to HEL-933 under the coordinator's
approved P1.3/P1.3b split (`DataSource.inferredSchema`, decision-15 panel layout,
`config.format`/HEL-876, and the two remaining Output schemas). None of the four is a route
in the Output surface this ticket's title leads with; all four are additive and create no
rework for what ships here.

### Cycle 7 — the remaining route surface, verified built and tested

- **`GET /api/outputs/:id/rows`** — `path("rows")` in `OutputRoutes`, paginated over
  `node_snapshots`, with the full ACL triad (`owner/editor-grantee → 200, unrelated → 404`).
- **`POST /api/pipelines/:id/preview?outputId=`** — `PipelineRunStatusRoutes:51`, delegating
  to `PipelineRunService.previewOutput`. **Task 3.7's run-state-unchanged assertion is a
  genuinely strong test**: it captures `lastRunStatus`/`lastRunAt` before the preview, then
  performs a *real* run on a **different** pipeline as a positive control proving the
  assertion mechanism can actually detect a mutation, then confirms the previewed pipeline's
  own state is untouched. That positive control is exactly the discipline this repo's
  "evidence-shaped non-evidence" history calls for, and it is rare to see it done unprompted.
- **`POST /api/pipelines/:id/validate-expression?stepId=`** — 5 tests including the one that
  matters most: *"validates against the NODE's own projected schema, not the source's — a
  column dropped by a `select` step is unknown there"*, plus unknown-stepId 404 and the ACL
  triad.
- **Task 3.2** — `parentStepId` on the existing steps route and the `DELETE` splice report,
  with a branch-point splice-count test and a cross-pipeline `parentStepId` → 422 test.
- **`POST /api/pipeline-shapes/:id/expand`** — BREAKING `{steps, outputs?}` envelope, with
  `clientId`/`parentStepId` chaining tested.
- **Lean paginated `GET /api/outputs`** — scoped to the caller's own Outputs, paginated.

### Cycle 7 — the RLS reversal is the single best result of this run

Cycle 5-6 shipped `runTransactionally` on `withSystemContext` (the RLS-bypassing privileged
pool), justified analytically. In evaluation-5 I verified the Slick half of that reasoning was
**true** (a `DBIO` runs on one connection from one pool; spanning two pools atomically needs
XA), and in evaluation-6 I noted the untested half: the chain *could* run under
`withUserContext` if the composed inserts were app-pool-safe.

Cycle 7 **tested that premise and found it false**, then acted on it:

- `PipelineRepositoryRunTransactionallyRlsSpec` stands up a real non-superuser role
  (`CREATE ROLE ... NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`, `SET ROLE` on the app pool),
  composes pipeline + step + Output in one chain under `withUserContext`, and verifies all
  three rows persist — RLS genuinely enforced, not vacuous.
- `runTransactionally` is now `def runTransactionally[R](userId: String)(action: DBIO[R]) =
  ctx.withUserContext(userId)(action)`. **The bypass is gone, not reworded** — I grepped
  `PipelineRepository.scala` for `RLS-bypass justification`, `bypass is correct` and
  `BYPASSRLS` and found **zero** hits. The scaladoc now explains why no justification is
  needed ("there is no bypass") and, to its credit, explicitly records that the earlier
  reasoning "was never actually tested" before being disproven.

This converts the one genuine security-posture concern I raised across eight cycles into a
strictly better outcome: atomicity **and** RLS enforcement together, empirically demonstrated
rather than argued.

### Cycle 8 — follow-up ticket references verified real, not placeholders

All four are named with substantive context, in both files:

- `tasks.md`: HEL-933 against tasks 1.1(rest), 1.3, 2.3b, 2.7, 3.10 — each with an inline
  `-> HEL-933` marker on the specific unchecked item; HEL-932 against the dev-DB finding;
  HEL-931 against the typed-refactor deferral with an accurate statement of what shipped
  instead.
- `design.md`: HEL-931 (typed refactor), HEL-932 (12 poisoned rows), HEL-933 (P1.3b, with the
  note that it blocks HEL-910's P1.7 sweep), HEL-934 (the expand envelope's stale e2e/helio-mcp
  consumers).

HEL-934 deserves a specific note in the PR: the `expand` envelope change is **breaking**, and
its stale consumers are in `e2e` and `helio-mcp` — both explicitly out of this ticket's scope
per its own Out of Scope section, so filing rather than fixing them here is correct. But they
are live consumers, and HEL-934 should not drift.

### Bookkeeping — three stale checkboxes in the final ledger

`tasks.md` still shows `[ ]` for three items that **did** ship:

- **2.4** — `GET /api/outputs/:id/rows` (shipped cycle 7; `path("rows")` is in the code and
  ACL-tested).
- **3.7** — `POST /api/pipelines/:id/preview` (shipped cycle 7, with the positive-control test
  above).
- **5.2** — the single-call rollback test (shipped cycle 4, strengthened cycle 5; I flagged
  this same box in evaluation-6 and it was not corrected).

This is **under**-claiming, not over-claiming — the opposite of the cycle-1 error, and it has
no effect on what ships. But cycle 8 was explicitly a documentation cycle, and this is the one
documentation thing it missed. It should be fixed before archive so the task ledger is
accurate for HEL-910's eventual sweep. Non-blocking.

## Phase 2: Code Review — PASS

### Gates, all re-run fresh by me in this worktree

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` →
  **`Tests: succeeded 3482, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / exit 0.**
  My own clean run. All four load-bearing specs confirmed present in the output:
  `PipelineRepositoryRunTransactionallyRlsSpec`, `SchemaFieldRealDumpInvariantSpec`,
  `PublicDashboardRoutesSpec`, `PipelineCreateTransactionalSpec`.
- `node scripts/check-schema-drift.mjs` → green; 97 schema entries, **72** checked across 48
  protocol files.
- **Proposal-split check, eighth consecutive cycle**: `git diff --stat origin/main...HEAD` on
  `backend/.../DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is
  **empty**. The P1.3/P1.4 boundary held for the entire run.
- `npx openspec validate --all` → **340 passed, 0 failed**.
- `npm run check:openspec` → `openspec/ is clean`.
- `npm run check:openspec:selftest` → **17 passed, 0 failed**.
- `npm run check:spec-structure` → 338 canonical specs, 0 issues.
- `node scripts/check-scala-quality.mjs` → **clean** (136 soft warnings, all pre-existing
  file-size budgets; none introduced by this change).

### Holistic quality assessment across the full diff

Eight cycles produced a large change, and the things I would normally worry about in a
change this size are absent:

- **No `@deprecated`, alias, or shim** anywhere in the diff — verified across all 95 files.
- **No inline fully-qualified names** (the repo's standing pet peeve).
- **Behavior-preserving where promised**: the pre-existing simple-create shape is byte-identical
  and pinned by its own test; the `Future`-returning repository methods delegate to the new
  `DBIO` variants so there is one definition of each insert, not two.
- **Nine real bugs found and fixed** over the run, each with a failable guard rather than a
  restatement: two ACL defects (RLS-blocked update reported as success; a non-owner editor
  grantee able to delete another user's Output and cascade their panels), the dry-run
  assertion-status defect, and six non-canonical field-type producers.
- **Test discipline held**: pre-existing assertions pinned to wrong values were *corrected*,
  never deleted or loosened; the structural guard's rollout broke 9 stale fixtures and they
  were all fixed properly; ACL suites use a real non-superuser `SET ROLE` pool so RLS is not
  vacuous, and the one suite that cannot (superuser on both pools) carries an explicit
  RLS-vacuity note so it can never be mis-cited as RLS evidence.

## Phase 3: UI Review — N/A (confirmed)

Per the ticket's own UI Gate section, P1.3 is backend/contract only. Confirmed on the **full**
diff: `git diff --name-only main...HEAD | grep '^frontend/'` returns **nothing**. Zero
frontend files across all 8 commits and 95 files. Dev servers were not started and no browser
checks were run, in this or any of the eight cycles. Deliberate N/A, stated explicitly every
cycle, never silently skipped.

## Overall: PASS

All 9 acceptance criteria met, with four items correctly descoped to HEL-933 under the
coordinator's approved split. Every gate green in my own independent run. No blocking defects.

## Non-blocking Suggestions

Nothing here should hold the PR; several are worth doing before archive or filing.

1. **Fix the three stale `tasks.md` checkboxes** (2.4, 3.7, 5.2) so the archived ledger is
   accurate for HEL-910's sweep.
2. **`POST /api/pipelines/:id/preview` requires `outputId`** (`parameters("outputId")`, not
   `.optional`). The ticket's scope line reads "`?outputId=` **scopes**", implying an
   unscoped all-Outputs preview is possible. As shipped, the parameter is mandatory. Either is
   defensible; worth a deliberate note in the PR (or in HEL-933) rather than leaving the
   contract line and the code implying different things.
3. **Preview has no HTTP-level ACL triad.** Its ACL is real — `previewOutput` gates on
   `outputRepo.findById(outputId, user)`, the sharing-aware RLS select, and there are
   service-level 404 tests for a nonexistent Output and for an Output belonging to a different
   pipeline. But every other new route in this change carries an explicit owner/grantee/other
   route test, and this one does not. Cheap to add.
4. **N+1 in `PublicDashboardRoutes.resolveDataAsOf`** (carried from evaluation-6): two lookups
   per `OutputPanel` on an unauthenticated public page — 40 queries for a 20-panel dashboard.
   A batched lookup or a single panels→outputs→pipelines join would collapse it. CLAUDE.md asks
   for performance by default.
5. **Correct the one overstated sentence** in `SchemaFieldRealDumpInvariantSpec`'s scaladoc
   (carried from evaluation-6): it claims a poisoned persisted row "would be caught here
   exactly the way it would in production", but the tolerant read repairs such a row before the
   assertion runs, so that particular assertion cannot fail. The step-projection half of the
   spec remains genuinely load-bearing.
6. **De-duplicate `validateOutputFieldMapping`** between `OutputService` and `PipelineService`
   (carried) — HEL-892's rule currently has two definitions that will drift.
7. **`OutputService.create` validates `fieldMapping` before the ACL check** (carried);
   authorization before input validation is the safer order.
8. **`check-schema-drift.mjs` does not cross-check the `DataFieldType` enums** against
   `DataFieldType.CanonicalWireValues` (it covers panel-type enums only), so an eighth
   `DataFieldType` case would silently desync the four hand-written schema `enum`s. The
   `compareSets` machinery already exists. Alternatively soften `CanonicalWireValues`' scaladoc,
   which currently claims a guarantee that is not enforced.
9. **Spinoff candidate**: `CastStep.castValue` has no arm for the canonical `"float"`/
   `"timestamp"` (carried) — now more reachable, since `canonicalizeLegacy` actively converts
   user-written `"double"`/`"date"` into exactly those two values.
10. **Name in the PR body**: HEL-931/932/933/934; the `AssertionStatusResponse.dataTypeId` →
    `outputId` wire break with `frontend/src/features/dataTypes/types/dataType.ts` flagged as
    P1.6's to update; and the `expand` envelope break with its HEL-934 consumers.

## Closing note

Across eight cycles the AC count went 3 → 5 → 6 → 7 → 7 → 8 → 9, every gate was green in my
own independent run every cycle, and the P1.3/P1.4 proposal-file boundary never moved. Two
things stand out as genuinely above the bar for this run: the preview test's **positive
control** proving its own assertion mechanism can detect a mutation, and cycle 7's decision to
**empirically test a prior cycle's analytical claim, find it false, and reverse the design** —
turning the run's one real security-posture concern into atomicity plus RLS enforcement
together. Both are the behaviour this repo's Iron Laws are trying to produce, and both
happened without being separately demanded.
