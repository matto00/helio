# Evaluation Report — Cycle 5 (evaluation-5.md)

Ticket: HEL-906 (P1.3). Change: `output-routes-api-contracts`.
Reviewed commit `b9bb6169` (on top of cycle 4's `c55ebf88`). Builds on evaluations 1-4.

Headline: **the D3 ratification is done properly** — the compensating-delete pattern is gone
and replaced by a genuine single transaction spanning three repositories, with a rollback
test strengthened to raw SQL so it actually observes the transaction boundary. **AC 3's
mechanism is now real** — a constructor `require` on `SchemaField` that cannot be bypassed,
plus true 400-returning boundary validation and schema `enum`s. Two gaps: the coordinator's
**fixture-based invariant guard is absent** (not mentioned in the executor's report), and
**HEL-931/HEL-932 are named nowhere in the change dir**, which the coordinator required.
One new finding of my own: the transactional path silently moves the pipeline-row insert
from the RLS-enforced app pool to the RLS-bypassing privileged pool, without the
justification comment `DbContext` explicitly demands.

## Phase 1: Spec Review — FAIL

### AC table, re-checked directly against `ticket.md`

| # | Acceptance criterion | C3 | C4 | C5 |
|---|---|---|---|---|
| 1 | Route specs cover **every new route** incl. ACL, **and** the single-call `create_pipeline` transaction rolls back | FAIL | PARTIAL | **PARTIAL** — the transaction clause is now genuinely met (real `.transactionally`, rollback proven by raw-SQL assertion). The "every new route" clause is not: rows, preview, validate-expression, shapes-expand and the paginated lists still do not exist, and task 3.2's `parentStepId` on the *existing* per-step route is still absent. |
| 2 | sum/avg binds; select-produced column bindable; bad slot → 400 | PASS | PASS | **PASS** |
| 3 | Enumerate every producer of a field-type string; assert each emits canonical values | FAIL | FAIL | **PARTIAL** — 3 of the 4 required pieces done, and the mechanism is genuinely structural now. The fixture-based invariant guard is missing. See below. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | PASS | PASS | **PASS** |
| 5 | Retired routes 404 | PASS | PASS | **PASS** |
| 6 | `assertion-status` reports the last run's outcome; alert rules against `targetOutputId` | FAIL | PASS | **PASS** |
| 7 | `check-schema-drift.mjs` green, proposal files untouched | PASS | PASS | **PASS** |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` green; no `@deprecated`/alias/shim | PASS | PASS | **PASS** |
| 9 | Per-node projection exercised by `capabilities?stepId=` | PASS | PASS | **PASS** |

Net: **7 of 9 fully met**, with the two remaining now both PARTIAL rather than one PARTIAL
and one FAIL — real progress, but neither AC 1 nor AC 3 is closed.

### D3 — ratified as option (iii), and done properly

The compensating-delete pattern is **deleted outright**, not left alongside. Verified:

- `PipelineRepository.createAction`, `PipelineStepRepository.insertInternalAction` and
  `OutputRepository.insertInternalAction` are genuine `DBIO`-returning extractions; the
  pre-existing `Future`-returning methods now delegate to them, so there is one definition of
  each insert, not two.
- `PipelineService.createTransactional` composes all three in a single `for`-comprehension
  over `DBIO` and runs it through `PipelineRepository.runTransactionally`, which is
  `ctx.withSystemContext(action.transactionally)` → `privilegedDb.run(action.transactionally)`.
  That is **one `db.run`, one transaction**, spanning three repositories. This is what D3
  asked for.
- The pre-existing simple-create shape is genuinely untouched: `req.steps.isEmpty &&
  req.outputs.isEmpty` still calls the old `pipelineRepo.create` verbatim, and the test
  pinning that is still present.
- The read-only `dataSourceRepo.findByIdOwned` ACL check is deliberately kept outside the
  transaction, with a correct justification (a read does not need to share write atomicity).

**On the mutation-test claim and the executor's caveat.** The claim is sound and I can
confirm the mechanism analytically. The rollback test now asserts
`select count(*) from pipelines where name = 'Rollback on bad step'` **via raw SQL on the
privileged connection** — bypassing `listSummaries`' ACL path entirely, so it observes the
committed row directly. Splitting the composition into two `runTransactionally` calls commits
the pipeline row before the step build runs, and that count becomes 1 — the test fails. The
assertion genuinely exercises the transaction boundary rather than the service's `Either`
plumbing.

**The executor's caveat is accurate and, if anything, strengthens the claim rather than
weakening it.** Removing only the inner `.transactionally` does not reproduce the bug because
`DbContext.withSystemContext` is itself `privilegedDb.run(action.transactionally)` — the
outer wrap is still there. So `runTransactionally`'s own `.transactionally` is **redundant**
(a harmless nested-transaction no-op, outer wins). The executor diagnosed a real property of
the stack rather than hand-waving a failed mutation, and disclosed it instead of quietly
reporting a clean mutation result. That is the right behaviour. Minor cleanup noted below.

### AC 3 — the mechanism is real; one required piece is missing

**What is genuinely done, all verified in the diff:**

1. **Boundary validation is real, not decorative.** `DataFieldType.validateAndCanonicalize`
   canonicalizes known synonyms *then* validates against `fromString`, returning `Left` with
   a message naming all seven valid types. It is wired into `DataSourceService.createStatic`
   and `applyStaticRefresh` as genuine 400s that short-circuit before any write, and they
   collect *every* bad column rather than failing on the first — a caller sees the whole
   problem in one round trip. `PipelineAnalyzeService.inferAggregate`'s groupBy is validated
   too. This closes the `case other => other` passthrough gap that all of cycle 4's five
   point-fixes left open.
2. **The `enum` constraints exist and are wired in.** Two existing schemas gained the
   seven-value `enum`, and two brand-new ones (`static-column-payload`,
   `field-override-payload`) were added for payloads that previously had **no schema at all**.
   I confirmed they are actually picked up: `check-schema-drift` now walks 94 entries (up from
   88) and checks 69 schemas (up from 67), both green.
3. **The structural guard is real and I could not find a bypass.** `SchemaField` is now
   `final case class SchemaField(name, type) { require(DataFieldType.fromString(type).isDefined, ...) }`.
   I checked the obvious escapes: the synthesized companion `apply` calls the primary
   constructor, so it is guarded; `copy()` calls the primary constructor, so it is guarded;
   there are no public mutable fields (it is a `final case class` with `val` params);
   `unapply`/pattern-matching is not construction. The one deliberate path around it is
   `schemaFieldJsonFormat.read`, which canonicalizes legacy synonyms *before* constructing —
   so no invalid `SchemaField` ever exists in memory, and that is documented at the point of
   use. `SchemaFieldStructuralGuardSpec` asserts the `require` directly (canonical values pass;
   `"number"`, `"banana"` and `""` throw; the message names all seven), so removing the
   `require` fails a test rather than only a review.

**Strong corroborating evidence the guard is load-bearing:** turning it on immediately broke
9 pre-existing fixtures across 5 spec files that predated this entire ticket, and it caught a
**6th live producer** — `DataSourceService.applyStaticRefresh`, which I verified previously
had *zero* canonicalization (`col.type` straight into a `DataField`). That is a guard finding
a real bug on its first run, which is the best possible evidence it is not decorative. The
fixture fixes were corrections to canonical values with downstream assertions updated, not
deletions or loosenings — I checked the diff for that specifically.

**What is missing — an explicit, non-negotiable coordinator requirement.** The required
*"test asserting that every field type in the projected schema for a representative fixture
pipeline (use the real scrubbed dump) satisfies `DataFieldType.fromString`"* **does not
exist anywhere in the diff**, and is not mentioned in the executor's report. I searched
directly: `grep -rn 'DataFieldType.fromString' backend/src/test/scala` returns two hits, one
in `DataFieldTypeSpec` (unit coverage of `fromString` itself) and one in a *comment* in
`PipelineCapabilitiesRoutesSpec`. Nothing walks a representative or real-dump fixture
pipeline's projected schema asserting the invariant end-to-end.

My honest assessment of how much this matters, since it should inform priority rather than
just be logged: the structural guard makes the invariant hold **in memory by construction**,
which is in one sense stronger than a fixture test — it covers all 31+ sites, not one
fixture's path. But it does not cover the same thing the fixture test was asked to cover:
end-to-end evidence against *real persisted data*. And there is a concrete residual hole the
fixture test would have surfaced — `schemaFieldJsonFormat.read` only tolerates the four
*known* synonyms, so a persisted row carrying a genuinely unrecognized type (not `"number"`/
`"double"`/`"long"`/`"date"`) still throws `require` and 500s on read. The dev-DB check found
only `"number"`, so this is not known to be live, but the fixture test against the real dump
is exactly what would prove it. This is a real gap, it should not slide, and it is small.

**Dev-DB claim — spot-checked and plausible.** 12 of 141 `data_sources` rows, each listed
with id, name and the offending `field: number` pair. The names are all dev/test artifacts
(skeptic/smoke/demo/probe sources), the query shape is sane, and the count is consistent with
the listing. The executor correctly declined to "fix" it in code, noting it is a data
migration and that it lacked Linear access; the coordinator has filed HEL-932.

### HEL-931 / HEL-932 are named nowhere in the change dir

`grep -rn 'HEL-931\|HEL-932' openspec/changes/output-routes-api-contracts/` returns
**nothing**. The coordinator's instruction to update AC-3's task text and `design.md` to name
HEL-931 as the deferral target for the typed-`DataFieldType`/`SchemaField` refactor is still
owed. This matters beyond bookkeeping: `design.md` D3 also still describes the design as it
was *before* the ratification, and an unamended design doc that contradicts shipped code is
the same confidently-false-documentation failure this ticket already hit in cycle 3. Both
edits should land together.

### Carried obligations — unchanged, recorded, not reframed

- **Task 3.2** — `parentStepId` on the existing `POST /api/pipelines/:id/steps`; step `DELETE`
  splice removed-placement report.
- **CR6** — `PublicDashboardRoutes.scala:51-56` rewire off `findLastRunAtByOutputDataTypeId`;
  drop `outputDataTypeId`/`outputDataTypeName` (tasks 4.3/4.4). **Fifth cycle carried.** The
  `pipeline-list-api` spec delta in this change dir still describes behavior the code lacks.
- **CR8 remainder** — rows, preview, validate-expression, shapes-expand envelope,
  `DataSource.inferredSchema` + `schemas/sources/data-source.schema.json` (task 1.3; note
  cycle 5 created `schemas/sources/` for other files, so the directory now exists), decision-15
  panel layout, lean paginated lists, `config.format` (HEL-876), the two remaining response
  schemas.

## Phase 2: Code Review — PASS

### Gates, all re-run by me in this worktree (fresh evidence)

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` →
  **`Tests: succeeded 3449, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / exit 0.**
  This is my own clean run, not the executor's; 3449 matches the claim.
- `node scripts/check-schema-drift.mjs` → green; 94 schema entries, **69** checked across 48
  protocol files (up from 67 — the two new source schemas are genuinely wired in, not orphaned).
- Proposal-split check → `git diff --stat origin/main...HEAD` on
  `backend/.../DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is
  **empty**. AC 7 holds for the fifth cycle running.
- `npx openspec validate --all` → **340 passed, 0 failed**.
- `npm run check:openspec` → `openspec/ is clean`.
- `npm run check:spec-structure` → 338 canonical specs, 0 issues.
- `node scripts/check-scala-quality.mjs` → **clean** (134 pre-existing soft warnings; none in
  files this cycle touched).
- Frontend gates: not run — **zero `frontend/**` files in the branch diff**, correctly.

### CR-A from evaluation-4 — resolved by deletion

The compensating delete whose discarded result I flagged no longer exists. A real transaction
has no compensation step to fail, so the silent-partial-state hole is structurally gone rather
than patched. Correct resolution.

### New finding — RLS posture change on the transactional path (CR-C)

`PipelineRepository.runTransactionally` uses `ctx.withSystemContext`, i.e. the **privileged
pool, which carries `helio_privileged` (`BYPASSRLS`)**. Tracing what actually changed:

- `PipelineStepRepository.insertInternal` and `OutputRepository.insertInternal` were
  **already** `withSystemContext` before this cycle, so composing them changes nothing for them.
- The **pipeline row insert** did change. `PipelineRepository.create` (the simple path) uses
  `ctx.withUserContext(user.id.value)` — the app pool, with RLS enforced. `createAction` on the
  transactional path now runs under `withSystemContext` — RLS bypassed.

I could not identify an exploitable hole: `dataSourceRepo.findByIdOwned` gates the call, and
`ownerId` is stamped from `user.id`, so a caller cannot create a pipeline they do not own or
over a source they cannot see. So this is **not** a security defect as shipped. But two things
should be fixed:

1. **`DbContext.withSystemContext`'s own documented contract is violated.** Its scaladoc says,
   in terms: *"Every callsite MUST carry an inline comment explaining why bypass is correct."*
   `runTransactionally`'s scaladoc explains the cross-repository *composition* rationale at
   length but never addresses why RLS bypass is correct here. The one convention the codebase
   uses to keep `BYPASSRLS` callsites auditable was skipped.
2. **The same logical operation now has two different RLS postures** depending on whether
   `steps`/`outputs` are empty. That asymmetry is exactly how a real hole gets introduced later
   by someone who reads one path and assumes the other matches. It is worth either using
   `withUserContext` for the composed action (it also takes a `DBIO`, so this appears feasible)
   or documenting explicitly why the privileged pool is required here — most plausibly because
   the two `insertInternalAction`s are `internal`/system-context by design and cannot run under
   the app pool. Either answer is fine; the silence is not.

### Other code observations

- `DataFieldType.CanonicalWireValues` is a good single source for the `require` message. But
  its scaladoc claims it is *"the ONE place ... every `enum` in `schemas/` should ultimately
  derive from"* — and that is **aspirational, not implemented**: the four schema `enum`s are
  hand-written literals, and `check-schema-drift.mjs` only cross-checks *panel-type* enums
  (7 surfaces), not `DataFieldType` ones. An eighth `DataFieldType` case would silently desync
  four schemas from the backend. Either extend the drift check (it already has exactly this
  machinery in `compareSets`) or soften the comment so it does not overstate the guarantee.
- `runTransactionally`'s inner `.transactionally` is redundant given `withSystemContext`
  already wraps. Harmless, but it is the thing that made the executor's first mutation attempt
  a no-op; removing it makes the single transaction boundary obvious to the next reader.
- `DataSourceService.createStatic`'s `.getOrElse(col.type)` after validation is documented as
  unreachable-defensive. That is accurate given the short-circuit above it, and it can no
  longer mask a bug now that `SchemaField`'s `require` would throw on a bad value anyway.
- The `schemaFieldJsonFormat` hand-rolled codec is well-justified (tolerant read for the 12
  known-poisoned rows, canonical write) and documented at the point of use.
- No inline fully-qualified names; no `@deprecated`/alias/shim; no dead code or leftover
  TODO/FIXME introduced.

## Phase 3: UI Review — N/A

Per the ticket's own UI Gate section, P1.3 is backend/contract only. Confirmed by
`git diff --name-only main...HEAD`: the branch touches only `backend/src/**`, `schemas/**`
and `openspec/changes/**`. **Zero `frontend/**` files.** Dev servers were not started and no
browser checks were run. Deliberate N/A, not a silently skipped gate.

## Overall: FAIL

AC 1 and AC 3 are both partial, and CR6 plus most of CR8 remain outstanding. Nothing found
this cycle is a defect in what shipped — the two gaps are a missing required test and missing
required documentation, and the RLS finding is a convention violation rather than a hole.
This was a strong cycle; it simply did not finish the ticket.

## Change Requests

1. **Add the fixture-based invariant guard** (explicit coordinator requirement, currently
   absent): a test that builds a representative fixture pipeline from the real scrubbed dump,
   computes its projected schema, and asserts every field type satisfies
   `DataFieldType.fromString`. Cover the source schema and at least one trunk and one tail
   node so it exercises `analyzeNodes`. While writing it, decide what should happen for a
   persisted type that is neither canonical nor a known synonym — today
   `schemaFieldJsonFormat.read` will throw `require` and 500 — and either widen the tolerant
   read or assert the current behaviour deliberately.
2. **Name HEL-931 and HEL-932 in the change dir**: update AC-3's task text in `tasks.md` to
   record HEL-931 as the deferral target for the typed-`DataFieldType`/`SchemaField` refactor,
   and **amend `design.md` D3** to describe the ratified option-(iii) design rather than the
   pre-ratification one. Reference HEL-932 where the dev-DB finding is recorded.
3. **CR-C — resolve the RLS posture question on `runTransactionally`**: either compose the
   action under `withUserContext` so the transactional path matches the simple path, or add
   the inline justification comment `DbContext.withSystemContext` requires, stating why the
   privileged pool is necessary here. Do not leave the two paths silently divergent.
4. **CR6 (carried, undropped, fifth cycle)**: `PublicDashboardRoutes.scala:51-56` rewire off
   `findLastRunAtByOutputDataTypeId` to `panel → output → pipeline.lastRunAt` (task 4.3), and
   drop `outputDataTypeId`/`outputDataTypeName` from `PipelineRepository`/`PipelineService`
   (task 4.4), with a public-dashboard-route test returning rows for an Output-backed
   placement.
5. **Task 3.2 (carried)**: `parentStepId` on the existing `POST /api/pipelines/:id/steps`, and
   the step `DELETE` splice removed-placement report, with tests for both. Needed to finish
   AC 1's "every new route" clause alongside CR 6 below.
6. **CR8 remainder (carried)**: `GET /api/outputs/:id/rows` (2.4);
   `POST /api/pipelines/:id/preview` with the run-state-unchanged assertion (3.7);
   `POST /api/pipelines/:id/validate-expression?stepId=` (3.9);
   `POST /api/pipeline-shapes/:id/expand` `{steps, outputs?}` envelope + `parentStepId`
   (3.8, BREAKING — update every existing `PipelineShapeRoutes` test);
   `DataSource.inferredSchema` on `DataSourceResponse` (3.10 + task 1.3's
   `schemas/sources/data-source.schema.json`); decision-15 panel layout in the panel-insert
   transaction with a rollback test (2.7); lean paginated `/api/outputs` + `/api/dashboards`
   (2.6); `config.format` (2.3b); `output-capabilities-response`/`preview-outputs-response`
   schemas (rest of 1.1).
7. **Minor**: extend `check-schema-drift.mjs` to cross-check the four `DataFieldType` `enum`s
   against `CanonicalWireValues` (the `compareSets` machinery already exists), or soften
   `CanonicalWireValues`' scaladoc so it does not claim a guarantee that is not enforced.
8. **Minor**: drop `runTransactionally`'s redundant inner `.transactionally`.
9. **Carried from evaluation-4**: de-duplicate `validateOutputFieldMapping` between
   `OutputService` and `PipelineService`; name the `AssertionStatusResponse.dataTypeId` →
   `outputId` wire break in the PR with `frontend/.../dataType.ts` flagged as P1.6's.

## Critical Path for Cycle 6

Per the coordinator's ruling this cycle should focus on CR6 and CR8's remainder, with the two
small required items cleared first so nothing carries a fourth time.

1. **CR 1 and CR 2 — the fixture guard and the HEL-931/HEL-932 + D3 documentation.** Both are
   explicit, non-negotiable coordinator requirements, both are small, and both have now been
   pending across a cycle boundary. Clear them first so they cannot slide again. Together they
   close AC 3.
2. **CR 4 (CR6) — `PublicDashboardRoutes` rewire + `outputDataTypeId` drop.** Carried for five
   cycles and the single item most likely to surprise P1.7, which assumes it is done. It is
   also the last piece keeping the `pipeline-list-api` spec delta inconsistent with the code.
3. **CR 5 (task 3.2) — `parentStepId` on the existing steps route + the DELETE splice report.**
   Small, and it is one of the two things still blocking AC 1's "every new route" clause.
4. **CR 3 (CR-C) — the RLS posture decision.** Small, and worth doing before more code is
   layered on the transactional path.
5. **CR 6 (CR8 remainder).** The bulk. Suggested order by dependency and payoff:
   `validate-expression` (cheapest — `analyzeNodes` already supplies the node schema), then
   `rows`, then `preview`, then `DataSource.inferredSchema` + task 1.3, then the shapes-expand
   envelope (BREAKING, so give it room), then the paginated lists, `config.format`, and the
   panel-layout work. Finishing all of this closes AC 1 at **9/9**.
6. **CR 7, 8, 9 — the minors.** Fold in wherever convenient.

### Note for the human

Cycle 5 is the cleanest cycle of the five. The D3 ratification was implemented as asked, the
old pattern was deleted rather than left beside the new one, the rollback test was
strengthened to raw SQL so it actually observes the boundary, and the AC-3 mechanism is now
genuinely structural — evidenced by it breaking 9 stale fixtures and catching a 6th live
producer the moment it was switched on. The executor also disclosed a mutation that *didn't*
reproduce rather than quietly reporting a clean result, which is the behaviour you want.

Two process notes worth your attention:

- Both outstanding items this cycle are things that were **explicitly required and then not
  done, and not mentioned as not-done** (the fixture guard; naming HEL-931/932 and amending
  D3). Everything else in the report was disclosed accurately. The pattern to watch is not
  dishonesty — it is that requirements arriving as prose conditions alongside a large code
  task are the ones that get dropped. Putting them into `tasks.md` as checklist items would
  make them visible to the same discipline that has been reliably tracking the numbered tasks.
- On scope: AC 1's remaining clause is now mostly CR8's route surface, which is broad but
  low-risk and mechanical. Two cycles is a realistic estimate for CR6 + task 3.2 + CR8. That
  fits the budget of 6 only if cycle 6 is productive; if you would rather bank the work, the
  clean split point is after CR6 and task 3.2 land, leaving CR8's remaining routes as P1.3b.
  Per your standing ruling I am not treating anything as droppable without your decision.

## Non-blocking Suggestions

- `PipelineService.scala` continues to grow; `createTransactional` + `buildStepsAction` +
  `buildOutputsAction` are a natural `PipelineCreationBuilder` extraction before CR8 adds more.
- `OutputService.create` still validates `fieldMapping` before the ACL check (carried from
  evaluation-3); authorization before input validation remains the safer order.
- `CastStep.castValue` still has no arm for canonical `"float"`/`"timestamp"` (carried from
  evaluation-3, now more reachable since `canonicalizeLegacy` actively produces exactly those
  two values from user-written `"double"`/`"date"`). Worth the spinoff.
- Five route specs now each stand up their own `EmbeddedPostgres`; a shared fixture trait would
  measurably cut cycle time for the remaining work.
