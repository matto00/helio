# Evaluation Report — Cycle 6 (evaluation-6.md) — FINAL CYCLE IN BUDGET

Ticket: HEL-906 (P1.3). Change: `output-routes-api-contracts`.
Reviewed commit `da7183e5` (on top of cycle 5's `b9bb6169`). Builds on evaluations 1-5.

This is the last cycle in the `EXECUTION_CYCLES=6` budget, so the report is written for a
human budget/scope decision: what is genuinely done, what is genuinely outstanding, and a
realistic estimate of the remainder.

Headline: **every item the coordinator required this cycle landed, and each one verified
real.** The fixture guard exists and uses the actual dump through the actual production path;
D3 is properly rewritten; the RLS technical claim is **true**; CR6 is done after five cycles
of carry, and its task-4.4 "already satisfied" claim holds up under my own grep.
**AC 3 is now closed.** The ticket is at **8 of 9 AC**, with AC 1's "every new route" clause
the sole remaining gap — 10 unstarted task items. Verdict is FAIL on that basis alone.

## Phase 1: Spec Review — FAIL

### AC table, re-checked directly against `ticket.md`

| # | Acceptance criterion | C4 | C5 | C6 |
|---|---|---|---|---|
| 1 | Route specs cover **every new route** incl. ACL, **and** the single-call `create_pipeline` transaction rolls back | PARTIAL | PARTIAL | **PARTIAL** — transaction clause fully met. "Every new route" is not: rows, preview, validate-expression, shapes-expand envelope and the paginated lists do not exist, and task 3.2 is unstarted. |
| 2 | sum/avg binds; select-produced column bindable; bad slot → 400 | PASS | PASS | **PASS** |
| 3 | Enumerate every producer of a field-type string; assert each emits canonical values | FAIL | PARTIAL | **PASS** — the fourth and last required piece (fixture guard) landed. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | PASS | PASS | **PASS** |
| 5 | Retired routes 404 | PASS | PASS | **PASS** |
| 6 | `assertion-status` reports the last run's outcome; alert rules against `targetOutputId` | PASS | PASS | **PASS** |
| 7 | `check-schema-drift.mjs` green, proposal files untouched | PASS | PASS | **PASS** |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` green; no `@deprecated`/alias/shim | PASS | PASS | **PASS** |
| 9 | Per-node projection exercised by `capabilities?stepId=` | PASS | PASS | **PASS** |

**Net: 8 of 9 AC fully met. AC 1 is the only one outstanding.**

### 1. Fixture guard — real, and it does what was asked

`SchemaFieldRealDumpInvariantSpec` is not a hand-built fixture dressed up as one. Verified:

- It loads `db/fixtures/hel904-real-dump.sql` — the actual scrubbed dump, confirmed present at
  `backend/src/test/resources/db/fixtures/`, the same file `V94OutputsMigrationSpec` uses.
- It replicates that spec's migrate-to-V93 → load dump → migrate-to-head sequence, so the
  production code path runs against the current post-V94 schema.
- It reads the **real persisted** `data_sources.inferred_schema` and the **real persisted**
  `pipeline_steps` rows (id, parent_step_id, position, op, config) for a real pipeline.
- It calls the **actual `analyzeNodes` production function**, not a reimplementation, and
  asserts `DataFieldType.fromString` is defined for every field of the source schema, the
  trunk root, and every node in the tree walk, with a `withClue` naming the offending field.
- It asserts `rows.size >= 3` and `projected.keySet.size shouldBe rows.size`, so it fails if
  the fixture stops being representative or if the tree walk silently drops nodes.
- I confirmed it actually executes in my own run (`SchemaFieldRealDumpInvariantSpec:` appears
  in the suite output), so it is not a compiled-but-unrun file.

**One honest caveat, which the spec itself half-discloses.** The spec's scaladoc says a
"genuinely poisoned persisted row would be caught here exactly the way it would in
production." That is **not accurate** for the source-schema half: the row is read through
`schemaFieldJsonFormat`, which now canonicalizes known synonyms *and* falls back to
`StringType` for anything unrecognized — so a poisoned row is silently **repaired**, not
caught, and `assertCanonical(sourceSchema, ...)` cannot fail. The spec's own closing
paragraph does concede the related point (that a violation would surface as an exception
inside `analyzeNodes` rather than a failed assertion), so this is an overstatement in one
sentence rather than a fabrication — but given this ticket's history with confidently-false
comments, that sentence should be corrected. The step-projection half of the spec remains
genuinely load-bearing: a producer that failed to canonicalize would throw inside
`analyzeNodes`.

**The tolerant-read change is deliberate and tested, not a silent behavior change.** It
directly addresses the residual hole I named in evaluation-5. The scaladoc states the
decision, the reasoning (an unbounded read path able to 500 on stray persisted data is an
avoidable outage surface), the choice of `StringType` as the most conservative canonical
fallback, and that a loud warning log carrying the raw value preserves operational
visibility. `SchemaFieldJsonFormatTolerantReadSpec` covers all four arms: canonical
pass-through, all three known synonyms, `"banana"` → `"string"`, and `""` → `"string"`.

### 2. HEL-931 / HEL-932 documentation — done, with one small miss

- `tasks.md` names **both**: HEL-932 against the dev-DB finding, and HEL-931 explicitly as the
  deferral target for the compiler-enforced typed-`DataFieldType`/`SchemaField` refactor, with
  an accurate statement of what mechanism *was* shipped instead.
- **`design.md` D3 is properly rewritten.** I read it in full against what shipped: it
  correctly describes option (iii), the `*Action` extraction with the `Future` methods
  delegating so there is one definition of each insert, the single `for`-comprehension through
  `runTransactionally`, the untouched simple-create path, the outright deletion of the
  compensating-delete pattern, the mutation-test evidence, and the RLS-posture note. The stale
  pre-ratification text I flagged last cycle is gone.
- **Small miss:** `grep 'HEL-931\|HEL-932' design.md` returns nothing — the ticket numbers are
  named in `tasks.md` only. D3's substance is correct, so this is a cross-reference gap rather
  than a factual one, but the coordinator asked for design.md specifically.
- **One stale line in D3:** it describes `runTransactionally` as
  `ctx.withSystemContext(action.transactionally)`, but the code in the *same commit* dropped
  the redundant inner `.transactionally` and is now `ctx.withSystemContext(action)`. A
  one-word doc drift introduced by an edit made alongside it.

### 3. RLS posture (CR-C) — the technical claim is true, and the comment is substantive

**I checked the Slick claim rather than accepting it, and it is correct.** A `DBIO` is
executed by a single `Database.run`, which acquires one connection from one pool for the
duration of the action; `.transactionally` scopes a transaction to that one connection. Two
`Database` handles (`db` = app pool, `privilegedDb` = privileged pool) therefore mean two
connections and two independent transactions — spanning them atomically would require XA /
distributed transactions, which Slick does not provide. So "a composed `DBIO` cannot run part
of itself against the app pool and part against the privileged pool within one transaction"
is a true statement about the stack, not an assertion of convenience.

The justification comment at `PipelineRepository.runTransactionally` is real and substantive,
not boilerplate. It names the constraint, and — importantly — it **concedes the posture change
explicitly** ("This IS a real posture change versus the pre-existing simple-create path ...
for the pipeline row specifically") rather than glossing it, then states the two compensating
controls: `ownerId` stamped from the authenticated `user.id` and never caller-supplied, and
the pre-transaction `findByIdOwned` ACL check. The redundant inner `.transactionally` was
dropped, as suggested.

The one nuance the write-up slightly under-states: the alternative was not only "abandon the
single transaction" — the whole chain *could* have run under `withUserContext` if the step and
Output inserts were made app-pool-safe. To its credit, D3's text does acknowledge exactly this
("would require abandoning either the single-transaction property ... or the already-
system-context internal insert methods"), so the trade-off is disclosed, not hidden. I am
satisfied this is a reasoned choice with the required audit trail.

### 4. CR6 — done after five cycles of carry, and the task-4.4 claim survives my own grep

`PublicDashboardRoutes` now resolves `dataAsOf` via `panel → output → pipeline.lastRunAt` for
`OutputPanel` placements, wired through `ApiRoutes.scala` with `outputRepoOpt`/`pipelineRepo`.
The scaladoc is notably honest about something easy to hide: HEL-904 did not merely remove the
old plumbing, it **dropped the `dataAsOf` feature itself** (every response silently fell back
to `None`) — and this cycle restores the feature, not just the wiring. Degradation is graceful:
a deleted Output, an unresolvable pipeline, a pipeline with no successful run, or an
unavailable repo all yield `None` rather than failing the page. `PublicDashboardRoutesSpec`
adds 3 real-DB tests, confirmed executed in my run.

**Task 4.4 — I verified by grep rather than accepting the claim, and it holds.**
`PipelineSummaryResponse` (the `GET /api/pipelines` shape) is
`id, name, sourceDataSourceId, sourceDataSourceName, lastRunStatus, lastRunAt,
lastRunRowCount, ownerId, tag` — **no `outputDataTypeId`/`outputDataTypeName`**, which is
exactly what the task's own verification step asks for. `findLastRunAtByOutputDataTypeId`
exists nowhere in `backend/src/` except four historical comments. The remaining live
`outputDataTypeId`/`outputDataTypeName` identifiers are all on **proposal and workspace wire
shapes** (`PipelineProposalProtocol`, `PipelineProposalService`, `CombinedProposalService`,
`WorkspaceContextProtocol`, `AssistantProposalToolSchemas`), which this ticket explicitly
scopes out to P1.4 — and `WorkspaceContextService.scala:313-314` already carries a comment
saying these are legacy wire field *names* this ticket deliberately does not rename. Claim
verified.

### Bookkeeping — one stale checkbox, under-claiming this time

`tasks.md` item **5.2 is still marked `[ ]`** with the note "NOT implemented this cycle —
single-call `create_pipeline` deferred (CR4)". That is stale: the single-call transaction
rollback test landed in cycle 4 and was strengthened in cycle 5
(`PipelineCreateTransactionalSpec`'s two rollback paths plus the raw-SQL row-count
assertion). Worth noting that this time the ledger **under**-claims rather than over-claims —
the opposite of the cycle-1 error — but it should be corrected so the final task ledger is
accurate for the archive.

## Phase 2: Code Review — PASS

### Gates, all re-run by me in this worktree (fresh evidence)

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` →
  **`Tests: succeeded 3457, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / exit 0.**
  My own clean run. All three new specs confirmed present in the output.
- **+8 delta verified real**: `PublicDashboardRoutesSpec` 3, `SchemaFieldJsonFormatTolerantReadSpec` 4,
  `SchemaFieldRealDumpInvariantSpec` 1 = 8. 3457 − 3449 = 8. No skips or pendings.
- `node scripts/check-schema-drift.mjs` → green, 69 schemas / 48 protocol files.
- Proposal-split check → `git diff --stat origin/main...HEAD` on
  `DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is **empty**. AC 7
  holds for the sixth cycle running.
- `npx openspec validate --all` → **340 passed, 0 failed**.
- `npm run check:openspec` → clean. `npm run check:spec-structure` → 338 specs, 0 issues.
- `node scripts/check-scala-quality.mjs` → **clean** (134 pre-existing soft warnings; none in
  files this cycle touched).
- Frontend gates: not run — **zero `frontend/**` files in the branch diff**, correctly.

### Note on the resumed executor

The coordinator flagged that this cycle's executor was a fresh resume that recovered context
from `workflow-state.md`/`execution-progress.md`/git log rather than a warm continuation. I
looked specifically for the failure modes that usually produces — re-litigating settled
decisions, contradicting earlier cycles' rationale, duplicating existing helpers, or
mis-stating prior work — and found none. It correctly reused `V94OutputsMigrationSpec`'s dump
loading sequence, correctly picked up the exact residual hole evaluation-5 named, and
correctly identified task 4.4 as already-satisfied rather than redoing it. Context recovery
appears to have been clean.

### Code observations

- **N+1 query in `resolveDataAsOf`** (non-blocking, but worth recording): the panel list runs
  `Future.sequence` over per-panel `findByIdInternal` calls — two round trips per `OutputPanel`
  on an unauthenticated public page. For a dashboard with 20 output panels that is 40 queries.
  CLAUDE.md asks for performance by default; a batched `findByIdsInternal` (or a single join
  from panels through outputs to pipelines) would collapse this to one or two queries. Not a
  correctness issue and not a blocker.
- The `Option[Repository]`-degrades-gracefully pattern matches the file's existing convention
  and is documented at the point of use.
- No inline fully-qualified names; no `@deprecated`/alias/shim; no dead code or leftover
  TODO/FIXME introduced.

## Phase 3: UI Review — N/A

Per the ticket's own UI Gate section, P1.3 is backend/contract only. Confirmed by
`git diff --name-only main...HEAD`: the branch touches only `backend/src/**`, `schemas/**`
and `openspec/changes/**`. **Zero `frontend/**` files.** Dev servers were not started and no
browser checks were run. Deliberate N/A across all six cycles, not a silently skipped gate.

## Overall: FAIL

Solely because AC 1's "route specs cover every new route" clause is unmet — 10 task items
never started. Nothing found this cycle is a defect in shipped code; the two documentation
nits and the N+1 are minor. This is a scope-remaining failure, not a quality failure.

---

# FULL TICKET STATUS — for the budget/scope decision

## Fully done and independently verified (8 of 9 AC)

| Area | Status |
|---|---|
| Output CRUD routes + service + schemas (`GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`, `/panels`) | Done, ACL triad tested against a real non-superuser RLS role |
| Two real ACL bugs found and fixed (RLS-blocked update reported as success; non-owner grantee could delete) | Done, both with failable regression guards |
| HEL-877 partial-merge PATCH semantics | Done |
| Per-node (trunk + tail) schema projection `analyzeNodes` | Done |
| `GET /api/pipelines/:id/capabilities?stepId=` | Done, full ACL triad + unknown-stepId 404 |
| HEL-895/638/644/892 absorbed bugs | Done; HEL-892 wired to a real HTTP 400 on the persisted-write path |
| Canonical `DataFieldType` enforcement (AC 3) | **Closed**: 9 producer bugs fixed across cycles, boundary validation with 400s, 4 schema `enum`s, `SchemaField` constructor guard, real-dump fixture guard, tolerant read |
| `GET /api/outputs/:id/assertion-status` + dry-run correctness | Done; dry-run bug found and fixed, contract kept intact |
| Single-call transactional `POST /api/pipelines` | Done as one real Slick transaction across three repositories, mutation-verified |
| Retired-route 404 assertions | Done |
| `PublicDashboardRoutes` rewire + `outputDataTypeId` drop (CR6 / tasks 4.3, 4.4) | Done |
| Schema/openspec/drift/quality gates | Green every cycle; proposal files untouched all six cycles |

## Genuinely outstanding — 10 task items, all under AC 1

| Task | Work | Est. |
|---|---|---|
| 3.9 | `POST /api/pipelines/:id/validate-expression?stepId=` — cheapest; `analyzeNodes` already supplies the node schema | S |
| 2.4 | `GET /api/outputs/:id/rows` (paginated) | S–M |
| 3.10 + 1.3 | `DataSource.inferredSchema` on `DataSourceResponse` + `schemas/sources/data-source.schema.json` (dir now exists) | S–M |
| 3.2 | `parentStepId` on the existing `POST /api/pipelines/:id/steps` + step `DELETE` splice removed-placement report | M |
| 3.7 | `POST /api/pipelines/:id/preview` (per-Output dry run, `?outputId=`, no run-state mutation) | M |
| 2.6 | Lean paginated `GET /api/outputs` + `GET /api/dashboards` (absorbs HEL-722) | M |
| 2.3b | Output `config.format` (HEL-876) | M |
| 3.8 | `POST /api/pipeline-shapes/:id/expand` `{steps, outputs?}` envelope + `parentStepId` — **BREAKING**, updates every existing `PipelineShapeRoutes` test | M–L |
| 2.7 | Decision-15 server-owned panel layout inside the panel-insert transaction, with a rollback test | M–L |
| 1.1 (rest) | `output-capabilities-response` + `preview-outputs-response` schemas | S |

**Realistic estimate: 2 further cycles** at the pace of cycles 4-6, if worked in the order
above. None of it is high-risk; 3.8 is the only breaking change and 2.7 the only one touching
a shared write path.

## Small carried nits (minutes each, not scope)

- Correct the one overstated sentence in `SchemaFieldRealDumpInvariantSpec`'s scaladoc.
- Name HEL-931/HEL-932 in `design.md`; fix D3's stale `action.transactionally` phrasing.
- Flip `tasks.md` 5.2 to `[x]`.
- De-duplicate `validateOutputFieldMapping` between `OutputService` and `PipelineService`.
- `OutputService.create`: validate after the ACL check, not before.
- `check-schema-drift.mjs`: cross-check the four `DataFieldType` enums against
  `CanonicalWireValues` (the `compareSets` machinery already exists), or soften the scaladoc.
- Batch `resolveDataAsOf`'s N+1.
- Spinoff: `CastStep.castValue` has no arm for canonical `"float"`/`"timestamp"`.
- Name in the PR: the `AssertionStatusResponse.dataTypeId` → `outputId` wire break, with
  `frontend/src/features/dataTypes/types/dataType.ts` flagged as P1.6's to update.

## Critical Path (final-cycle, ordered)

1. **Clear the four documentation nits** (fixture-spec sentence, design.md cross-refs + D3
   phrasing, tasks.md 5.2). Minutes, and they make the archive accurate.
2. **3.9 → 2.4 → 3.10+1.3** — the three cheapest routes; closes a third of the gap fast.
3. **3.2** — the last non-CR8 AC-1 item.
4. **3.7, 2.6, 2.3b** — mid-weight, independent, parallelisable.
5. **3.8** (breaking; give it room) and **2.7** (shared write path; needs the rollback test).
6. **1.1's two remaining schemas**, then the minor cleanups.

## Recommendation for the human

The engineering here is sound and the trajectory is good: AC went 3 → 5 → 6 → 7 → 7 → 8 across
six cycles, every gate has been green in my own independent runs every cycle, and the hard
problems are all behind us — the transaction, the RLS posture, the canonical-type bug class
that took four cycles to fully corner, and the five-cycle CR6 carry are all closed. What
remains is ten items of ordinary, low-risk route surface.

My recommendation is to **split rather than extend**: land HEL-906 now at 8/9 AC with the
documentation nits fixed, and move the ten remaining task items into a **P1.3b** ticket with
AC 1's "every new route" clause restated against that ticket. Reasons:

- The branch is already six cycles and ~5,000 lines deep. It is well past the size where a
  single reviewable PR is realistic, and it currently blocks P1.4/P1.5/P1.6, all of which
  depend on the Output surface that is already complete.
- Everything remaining is additive route surface. None of it changes anything already shipped,
  so splitting costs no rework and creates no merge hazard.
- The one genuinely breaking item (3.8's envelope change) is better delivered on its own where
  its blast radius on `PipelineShapeRoutes` tests is visible in isolation.

If you would rather keep it whole, two more cycles is a realistic budget — but per your
standing ruling I have not treated anything as droppable, and the split needs your decision
rather than mine. Either way, HEL-931 and HEL-932 are already filed and should be named in
the PR body.

One process note, repeating evaluation-5's because it held again: this cycle's required items
were delivered **in full** — and they were the ones that had been promoted from prose
conditions into explicit, numbered instructions. The two things that slipped in cycle 5 were
the two that arrived as prose. Whatever HEL-906's remainder becomes, putting each condition
into `tasks.md` as a checkbox is what has reliably made them land.
