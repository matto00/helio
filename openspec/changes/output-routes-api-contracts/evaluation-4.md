# Evaluation Report — Cycle 4 (evaluation-4.md)

Ticket: HEL-906 (P1.3). Change: `output-routes-api-contracts`.
Reviewed commit `c55ebf88` (on top of cycle 3's `39512347`). Builds on evaluations 1-3.

Headline: **CR1 and CR3 are fully and correctly done — AC 6 is closed.** CR2 fixed all five
named producers with a genuinely structural *enumeration*, but per the coordinator's explicit
ruling it is **not structurally closed**: neither of the two required mechanisms exists
(no guard test, no boundary rejection). CR4 was started and works, but it implements
**exactly the pattern design.md D3 explicitly rejected**, and its compensating delete has a
real silent-partial-state hole. The D3 conflict is a decision for the human, not for me or
the executor — see "Decision required" below.

## Phase 1: Spec Review — FAIL

### AC table, re-checked directly against `ticket.md`

| # | Acceptance criterion | C2 | C3 | C4 |
|---|---|---|---|---|
| 1 | Route specs for every new route incl. ACL; `create_pipeline` transaction rolls back | FAIL | FAIL | **PARTIAL** — `POST /api/pipelines` single-call now exists with 5 tests incl. two rollback paths. But the rollback is compensating-delete, not the transaction D3 specifies (see Decision required), the compensating delete can silently leave partial state (CR-A below), and task 3.2 (`parentStepId` on the *existing* per-step route, step-DELETE splice report), preview, validate-expression and shapes-expand still have no routes. |
| 2 | sum/avg binds; select-produced column bindable; bad slot → 400 | PARTIAL | PASS | **PASS** |
| 3 | Enumerate **every** producer of a field-type string; assert each emits canonical values | FAIL | FAIL | **FAIL** — 5 more real bugs found and fixed via a genuine construction-site enumeration (a real methodological improvement), but neither structural mechanism the coordinator required is present. See "AC 3" below. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | PASS | PASS | **PASS** |
| 5 | `/api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query` 404 | PASS | PASS | **PASS** |
| 6 | `assertion-status` reports the **last run's** outcome; alert rules against `targetOutputId` | FAIL | FAIL | **PASS** — dry-run bug fixed, both doc copies now true, real regression test. See below. |
| 7 | `check-schema-drift.mjs` green, proposal files untouched | PASS | PASS | **PASS** |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` green; no `@deprecated`/alias/shim | PASS | PASS | **PASS** |
| 9 | Per-node projection exercised by `capabilities?stepId=` | PASS | PASS | **PASS** |

Net: **7 of 9 met** (up from 6), 1 partial, 1 failed.

### AC 6 — closed. Both doc copies verified, fix is real

- **The fix is real.** `OutputService.scala:214` changed from `runs.headOption` to
  `runs.find(_.status != "dry_run")`.
- **Both copies of the false claim were handled, and handled the right way round.** The Scala
  doc comment (`OutputService.scala:191-205`) is rewritten and is now *accurate* — it names
  `insertDryRunInternal`, states that dry runs write a real row into the same table, and says
  in terms that the filter is "load-bearing, not defensive dead code". The published
  `schemas/outputs/output-assertion-status.schema.json` description was **correctly left
  untouched**: it already said "latest NON-DRY run … a dry run is never considered", which was
  false before and is true now. That is exactly what evaluation-3 asked for ("do not weaken
  them to match the buggy behavior") — the code was brought up to the contract, not the
  contract down to the code. Confirmed the schema file is absent from the cycle-4 diff.
- **The regression test is genuinely failable.** It seeds a real run (passing) then a dry run
  (failing) via `insertDryRunInternal` — the actual production insert path, not a hand-rolled
  row — with `Instant.now()` at call time so the dry run sorts first under
  `listByPipelineInternal`'s `startedAt desc`. Pre-fix, `.headOption` returns that dry run,
  `failedCount` is 1, and the test's `invalid shouldBe false` fails. I verified this
  analytically rather than by mutating the worktree (my role is read-only); the chain —
  helper uses the real insert, ordering is `startedAt.desc`, the assertion is on the same
  `stepId` with `severity = "error"`, `passed = false` — is airtight and leaves no arm where
  the old code could still pass.

### CR3 — done and accurate

`PipelineCapabilitiesRoutesSpec`'s header now carries an explicit RLS-vacuity note. I checked
it for accuracy, not just presence: it correctly states the suite uses the same superuser
connection for both pools with no `SET ROLE`, correctly distinguishes that
`findByIdShared`'s ACL *is* a real app-level `resource_permissions` predicate (so the ACL
assertions remain meaningful), correctly says the suite proves nothing about Postgres RLS,
and correctly points at `OutputRoutesSpec`'s `helio_app_test_output_routes` role as the
contrast. Nothing overstated.

### AC 3 — the five bugs are fixed; the AC is **not** structurally closed

**Credit where due, because the method genuinely improved.** The executor abandoned
string-grepping for a construction-site enumeration — the thing evaluation-3 asked for — and
it worked: it found five real bugs, three of which no previous cycle (including my own
evaluation-3 sweep) had named. I verified each fix in the diff:
`PipelineAnalyzeService.inferAggregate`'s groupBy (`:396`), `PipelineService`'s inline
static-source dry-analyze (`:590`), `DataSourceService.createStatic`'s inline columns
(`:121`), `DataSourceService.createCsv`'s `overrides` branch (`:171`), and
`SchemaInferenceFacade.toSchemaFields`' override branch (`:30`). The logic was promoted to a
single `DataFieldType.canonicalizeLegacy` (`model.scala:611-627`) with an accurate scaladoc.
Six new tests cover the new sites.

**But on the coordinator's two specific questions, the answers are both no.** I checked each
directly rather than inferring:

1. **Is there a guard test that fails if a `SchemaField` is constructed with a
   non-canonical type bypassing the helper? — No.** `grep -rn 'canonicalizeLegacy'
   backend/src/test/scala` returns exactly one hit, and it is a *comment* inside
   `PipelineAnalyzeServiceSpec.scala:353`, not an assertion. No test enumerates construction
   sites; no test would fail if a sixth site were added tomorrow with a raw string.
2. **Does the create path reject a non-canonical type at the boundary? — No, it only
   normalizes.** `DataSourceService.createStatic` calls `canonicalizeLegacy` and persists the
   result; `canonicalizeLegacy`'s own final arm is `case other => other`, documented as "any
   other string (including … a genuinely unrecognized one) passes through unchanged — this is
   normalization of known synonyms, not full validation". So a client posting
   `{"name":"amount","type":"bogus"}` still persists `"bogus"` into
   `data_sources.inferred_schema`, and that column is still silently dropped by every
   `DataFieldType.fromString`-gated surface. There is no `enum` constraint either: there is
   still **no `schemas/sources/` directory at all** (task 1.3 remains unstarted), and the new
   `create-pipeline-*.schema.json` files add no field-type enum.

Also worth noting: `SchemaField` is still `final case class SchemaField(name: String,
`type`: String)` (`PipelineAnalyzeService.scala:14`) — no typed `DataFieldType` field, no
private constructor, no smart-constructor factory. Both of the coordinator's offered options
(a) and (b) are unimplemented.

**So, plainly, as the coordinator asked me to state it:** a shared `canonicalizeLegacy` that
31 call sites must remember to invoke is not structurally different from a shared string
check reviewers must remember to run. It fixes the five known sites; it does not make a sixth
site impossible, and it does not make one *loud*. Per the coordinator's explicit ruling,
**AC 3 is not yet closed**, notwithstanding that all five named bugs are genuinely fixed.

I'd add one finding of my own that reinforces this: the five sites were found by enumerating
`SchemaField(`, but `canonicalizeLegacy`'s pass-through-unknown-strings design means the
*boundary* class of bug (garbage in, garbage persisted) is untouched by any of the five
fixes. Rejection at `DataSourceService` plus an `enum` in the source schema is the only one
of the proposed measures that closes that, and it is also the cheapest.

### Carried obligations — recorded, not reframed

The executor documented these as carried rather than re-scoping them, which is correct and
matches the coordinator's ruling. Restating so they stay visible:

- **Task 3.2** — `parentStepId` on the existing `POST /api/pipelines/:id/steps`, and the step
  `DELETE` splice removed-placement report. Distinct from CR4's in-request `parentStepId`
  resolution, which does not cover the standalone route.
- **CR6** — `PublicDashboardRoutes.scala:51-56` rewire off `findLastRunAtByOutputDataTypeId`,
  and dropping `outputDataTypeId`/`outputDataTypeName` (tasks 4.3/4.4). Fully outstanding for
  a fourth cycle; the `pipeline-list-api` spec delta in this change dir still describes
  behavior the code does not have.
- **Rest of CR8** — rows, preview, validate-expression, shapes-expand envelope,
  `DataSource.inferredSchema` + `schemas/sources/`, decision-15 panel layout, lean paginated
  lists, `config.format` (HEL-876), the two remaining response schemas.

None may be converted to a deferral, follow-up ticket, or corrected AC text without the
human's decision.

## Phase 2: Code Review — PASS

### Gates, all re-run by me in this worktree (fresh evidence)

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` →
  **`Tests: succeeded 3441, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / exit 0.**
- Delta verified real: +10 claimed, and the diff adds exactly 10 new `in {` cases
  (`PipelineCreateTransactionalSpec` 5, `OutputRoutesSpec` 1,
  `PipelineAnalyzeProposalRoutesSpec` 1, `PipelineAnalyzeServiceSpec` 1,
  `DataSourceServiceSpec` 1, `SchemaInferenceFacadeSpec` 1). 3441 − 3431 = 10. Not a flake.
- `node scripts/check-schema-drift.mjs` → in sync, now **67** schemas (up from 64 — the three
  new `create-pipeline-*` files) across 48 protocol files. Green.
- Proposal-split check → `git diff --stat origin/main...HEAD` on
  `backend/.../DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is
  **empty**. Note for the record: a `grep -i proposal` over the diff's filenames now also
  matches `PipelineAnalyzeProposalRoutesSpec.scala` — that is a *test spec for the pipeline
  analyze-proposal route*, not either of the two files the drift check couples. AC 7 holds
  for the fourth cycle running.
- `npx openspec validate --all` → **340 passed, 0 failed**.
- `npm run check:openspec` → `openspec/ is clean`.
- `npm run check:spec-structure` → 338 canonical specs, 0 issues.
- `node scripts/check-scala-quality.mjs` → **clean** (134 pre-existing soft warnings; none in
  files this cycle touched).
- Frontend gates: not run — **zero `frontend/**` files in the branch diff**, correctly.

### CR4 — implementation review

The functional shape is good: `clientId`-based forward references for both `parentStepId` and
`nodeStepClientId`, resolved only against *earlier* entries (so cycles and forward references
are structurally impossible), duplicate-`clientId` rejection, step-type and Output-kind
validation, `fieldMapping` validation reused, sequential `loop` that short-circuits on the
first `Left`. The pre-existing simple-create shape is genuinely preserved — `req.steps.isEmpty
&& req.outputs.isEmpty` returns exactly the old value, and there is a test pinning it. The
five tests are real, including one that asserts an *already-created* step is gone after a
later Output fails, and one that finds the row by unique tag rather than trusting a name
absence.

**CR-A — the compensating delete's result is discarded (the real defect here).**
`PipelineService.scala:127-129`:

```scala
case Left(err) =>
  pipelineRepo.delete(PipelineId(summary.id), user).map(_ => Left(err))
```

Two failure modes, neither handled and neither tested:

- `pipelineRepo.delete` returns a value indicating it deleted nothing (wrong owner, row
  already gone, RLS no-op) — `.map(_ => ...)` **discards it**. The caller receives the
  original 400 while a pipeline row plus every step/Output created before the failure remains
  visible. This is the precise "partial pipeline left visible" risk, and it is silent: no log,
  no alert, no audit entry.
- `pipelineRepo.delete` fails with an exception — `.map` propagates the failure, so the caller
  now gets a 500 *instead of* the original, accurate 400, **and** the partial pipeline
  survives. The real cause is lost twice over.

This is fixable independently of the D3 question and should be fixed either way: check the
delete's result, log loudly (`log.error`) when compensation fails, `recover` so the original
error still surfaces, and add a test that injects a failing compensation and asserts the
original error is returned and the failure is logged. Note this hole does not exist in a real
`.transactionally` implementation, which is part of why D3 chose one.

**CR-B — duplicated `validateOutputFieldMapping`.** `PipelineService.scala:216-232` is a
near-verbatim copy of `OutputService.validateFieldMapping`. The scaladoc argues the coupling
cost of sharing exceeds the duplication cost. That is a defensible call and it is disclosed
rather than silent, so I am not blocking on it — but it is now the second copy of a
validation rule that HEL-892 exists to enforce, and the two will drift the first time a slot
rule changes. A small shared object (or moving the validator onto `OutputBindingSpec`, where
`validateFieldMapping` already lives) would cost less than the comment defending the copy.

### Other code observations

- `canonicalizeLegacy`'s scaladoc is honest about being normalization and not validation, and
  explicitly names `fromString` as the source of truth. Good.
- `PipelineAnalyzeService.canonicalizeLegacyType` is now a one-line delegate to the shared
  helper rather than a second definition — correct de-duplication.
- The `outputRepo == null` arm in `buildOutput` returns `InternalError` rather than silently
  skipping the Output — correct, and the scaladoc says so.
- The three new schemas are well-formed, `additionalProperties: false`, and the
  `create-pipeline-request` description correctly documents the additive/backwards-compatible
  semantics.
- No inline fully-qualified names; no `@deprecated`/alias/shim; no dead code or leftover
  TODO/FIXME introduced.

## Phase 3: UI Review — N/A

Per the ticket's own UI Gate section, P1.3 is backend/contract only. Confirmed by
`git diff --name-only main...HEAD`: the branch touches only `backend/src/**`, `schemas/**`
and `openspec/changes/**`. **Zero `frontend/**` files.** Dev servers were not started and no
browser checks were run. Deliberate N/A, not a silently skipped gate.

## DECISION REQUIRED FROM THE HUMAN — design.md D3 vs. CR4's implementation

I am flagging this rather than ruling on it, because it is a change to a design decision this
run's own design gate already confirmed, and that is not mine or the executor's call.

**D3 says, verbatim:** *"Single-call `create_pipeline` is one `db.run(transaction { ... })`
block in `PipelineService`, **not a saga/compensating-transaction pattern**. … a single Slick
transaction gives atomic rollback for free with none of a saga's complexity. Alternative
(sequential calls with manual compensation) **rejected as unnecessary** given everything is
one DB."*

**What shipped is the rejected alternative**: sequential repository calls followed by a
compensating `pipelineRepo.delete`. So this is a direct contradiction of a confirmed design
decision — not a within-design implementation detail.

**In the executor's favour, and I verified both claims:**

- The technical obstacle is real. `DbContext` exposes only `withUserContext(userId)(action:
  DBIO[R])` and `withSystemContext(action: DBIO[R])`, each of which runs and commits its own
  action. Every repository method calls one of them internally. There is no API for composing
  one transaction across `PipelineRepository` + `PipelineStepRepository` +
  `OutputRepository`, so D3 as literally written requires either new `DbContext` plumbing or
  restructuring three repositories to expose `DBIO`-returning variants. D3 does not appear to
  have accounted for this.
- The cited precedent is genuine, not invented. `PipelineProposalService` really does
  implement a documented compensating-rollback pattern (`rollbackAll` / `rollbackSourceOnly` /
  `rollback`, with an explicit ordering rationale) for the identical atomic-multi-resource-
  creation problem.
- The disclosure was proper: the choice is argued in a scaladoc at the point of use, not
  slipped in silently.

**My assessment**, offered as input to the decision and not as the decision:

- Behaviourally, the ticket's AC 1 wording ("rolling back on a failing step or Output") is
  satisfied by the shipped code *in the paths that are tested* — the cascade on
  `pipeline_steps.pipeline_id` / `outputs.pipeline_id` does make one delete remove everything.
- The gap D3 was protecting against is exactly CR-A: a compensating rollback has a failure
  mode a transaction does not, and this implementation currently ignores it silently.
- So the three coherent options are: **(i)** ratify the deviation and amend D3, requiring
  CR-A fixed first (cheapest, and consistent with existing codebase precedent); **(ii)** hold
  D3 and pay for the `DbContext`/repository plumbing to make one real transaction possible
  (most faithful, largest change, touches shared infrastructure used by everything else);
  **(iii)** hold D3 narrowly by moving just these three inserts behind one `DBIO` composed in
  a single `withUserContext` call, without a general refactor.
- If I had to recommend one: **(i) with CR-A fixed as a precondition**, because the precedent
  already exists in this codebase, and (ii) expands blast radius well beyond this ticket. But
  this is a design-authority call and it should be made deliberately, with D3 amended in
  writing either way so the next reader is not misled — the same failure mode as cycle 3's
  false dry-run comment, one level up.

Until this is decided, I am treating CR4 as **in progress**, not as done-with-a-deviation.

## Change Requests

1. **CR-A — fix the compensating delete's silent-partial-state hole** (blocking regardless of
   how the D3 question is decided). At `PipelineService.scala:127-129`: inspect the delete's
   result, `log.error` when compensation fails (including the pipeline id and the original
   error), `recover` so the caller still receives the original `ServiceError` rather than a
   500, and add a test that forces a failing compensation and asserts both behaviours.
2. **Close AC 3 structurally** (per the coordinator's ruling; the five point-fixes stay):
   (a) **Reject at the boundary** — `DataSourceService.createStatic`/`createCsv` should return
   a `400` naming the seven canonical values for a type string that is neither canonical nor a
   known synonym, instead of persisting it. (b) **Add the `enum` constraint** to the column
   `type` field in the source-request schemas — this needs `schemas/sources/` to exist, which
   is task 1.3 anyway, so do them together. (c) **Add the guard** — either route all
   `SchemaField` construction through a validating factory and add a test that fails when a
   raw-string construction appears outside it, or give `SchemaField` a typed `DataFieldType`
   field so the compiler enumerates producers. (c) is the one that makes a sixth site
   impossible rather than merely fixed; (a)+(b) are the cheapest and close the
   garbage-in-garbage-persisted class that none of the five fixes touch.
3. **CR-B — de-duplicate `validateOutputFieldMapping`** by moving it next to
   `OutputBindingSpec.validateFieldMapping`, so HEL-892's rule has one definition.
4. **Finish CR4** per whatever the D3 decision is, and amend `design.md` D3 in writing to
   match the outcome.
5. **Task 3.2 (carried):** `parentStepId` on the existing `POST /api/pipelines/:id/steps`, and
   the step `DELETE` splice removed-placement report, with tests for both.
6. **CR6 (carried, undropped):** `PublicDashboardRoutes` rewire + `outputDataTypeId`/
   `outputDataTypeName` drop (tasks 4.3/4.4), with a public-dashboard-route test returning
   rows for an Output-backed placement.
7. **CR8 remainder (carried):** `GET /api/outputs/:id/rows` (2.4);
   `POST /api/pipelines/:id/preview` with the run-state-unchanged assertion (3.7);
   `POST /api/pipelines/:id/validate-expression?stepId=` (3.9);
   `POST /api/pipeline-shapes/:id/expand` `{steps, outputs?}` envelope + `parentStepId`
   (3.8, BREAKING — update every existing `PipelineShapeRoutes` test);
   `DataSource.inferredSchema` on `DataSourceResponse` (3.10 + schema 1.3, pairs with CR2b);
   decision-15 panel layout in the panel-insert transaction with a rollback test (2.7);
   lean paginated `/api/outputs` + `/api/dashboards` (2.6); `config.format` (2.3b);
   `output-capabilities-response`/`preview-outputs-response` schemas (rest of 1.1).
8. **Name in the PR:** the `AssertionStatusResponse.dataTypeId` → `outputId` wire break, and
   `frontend/src/features/dataTypes/types/dataType.ts` as P1.6's to update.

## Critical Path for Cycle 5

1. **Get the D3 decision from the human first.** It is the only item that can invalidate work
   done in cycle 5, and it costs one question. Do not start restructuring `DbContext` or
   amending D3 speculatively.
2. **CR-A — the compensating-delete hole.** Small, blocking, and independent of the D3
   outcome: even if D3 is amended to ratify compensating rollback, this must be fixed; if D3
   is held, the code is replaced anyway and the test still guards the behaviour. Do it now.
3. **CR 2 (a)+(b) — boundary rejection + the `enum`, bundled with task 1.3
   (`schemas/sources/data-source.schema.json`).** These three are the same piece of work and
   between them close the persisted-garbage class that the five point-fixes do not.
4. **CR 2 (c) — the guard test or the typed field.** The item that actually makes AC 3
   structurally closed. Prefer the typed `DataFieldType` on `SchemaField` if the blast radius
   is tolerable (the compiler then enumerates producers permanently); fall back to the
   factory-plus-guard-test if it is not. With 3 and 4 done, AC 3 closes and the count reaches
   **8/9**.
5. **Finish CR4** per the D3 decision, then **task 3.2** — together these close AC 1 and take
   it to **9/9**.
6. **CR6**, then **CR3 (de-dup)**, then **CR8's remainder**. CR6 has now been carried for four
   cycles and is the item most likely to surprise P1.7.

### Note for the human

Cycle 4 is the strongest cycle so far: AC 6 closed properly with the contract left intact and
the code raised to meet it, the RLS doc note is accurate, the AC-3 method genuinely changed
from grepping to enumeration and immediately found three bugs nobody had named, and the
gates are green. AC count 6 → 7.

Two things need your input rather than another cycle of iteration:

- **D3.** The design gate confirmed one thing and the implementation does another, for
  reasons that are real and were disclosed. Whichever way you rule, D3 should be amended in
  writing — an unamended design doc that contradicts shipped code is the same
  confidently-false-documentation failure this ticket has already hit once.
- **AC 3's stopping condition.** Four cycles have each found new instances of this one bug
  class (2 in cycle 2, 3 in cycle 3, 5 in cycle 4) and each fix has been a point fix plus a
  better search. Your requirement for a compiler- or test-enforced guard is, on this
  evidence, the right one — but it is worth deciding explicitly whether the typed-field
  refactor is in scope for HEL-906 or belongs in its own ticket, because it touches
  `SchemaField`'s 31 construction sites across the backend and is not really P1.3 work.

On sizing, unchanged from evaluation-3: CR4's completion plus task 3.2, CR6 and CR8's
remainder is realistically 2-3 more cycles. The budget of 6 accommodates that. The natural
split point, if you want one, is after AC 1 and AC 3 close (9/9), leaving CR6 + CR8 as a
P1.3b — but per your ruling I am not treating anything as droppable.

## Non-blocking Suggestions

- `PipelineService.scala` is now ~800 lines and `OutputService.scala` ~220, both growing each
  cycle. `buildStepsAndOutputs` and its two nested builders are a natural extraction
  (`PipelineCreationBuilder`) before CR4's completion adds more.
- `OutputService.create` still runs `validateFieldMapping` before
  `accessChecker.requireAccess` (carried from evaluation-3); authorization before input
  validation remains the safer order, and `PipelineService.buildOutput` now has the same
  ordering by inheritance.
- `CastStep.castValue` still has no arm for the canonical `"float"`/`"timestamp"` (carried
  from evaluation-3) — now more visible, since `canonicalizeLegacy` actively converts
  user-written `"double"`/`"date"` into exactly the two values `castValue` does not handle at
  runtime. Worth a spinoff before someone hits the schema-says-float/value-is-string
  divergence.
- The route specs each stand up their own `EmbeddedPostgres`; there are now five such suites
  in this change. A shared fixture trait would measurably cut cycle time for the 2-3 cycles
  still to come.
