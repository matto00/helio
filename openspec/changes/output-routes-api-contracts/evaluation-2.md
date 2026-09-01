# Evaluation Report — Cycle 2 (evaluation-2.md)

Ticket: HEL-906 (P1.3). Change: `output-routes-api-contracts`.
Reviewed commit `64ddd88d` (on top of cycle 1's `4348bb1b`). Builds on `evaluation-1.md`.

Headline: **substantial, high-quality progress — CR1, CR2, CR7, CR9, CR10 and both
non-blocking suggestions are genuinely done, and the three claimed field-type bugs are real
fixes with real guards.** Still FAIL: AC 1 and AC 6 remain unmet (CR4/CR5/CR6 deferred by
design), AC 2 is only partly met, and **AC 3's producer sweep is demonstrably incomplete — I
found a fourth non-canonical producer of the exact same bug class that the sweep missed**
(details below, with file:line).

## Phase 1: Spec Review — FAIL

### AC table, re-checked directly against `ticket.md`

| # | Acceptance criterion | Cycle 1 | Cycle 2 |
|---|---|---|---|
| 1 | Route specs for every new route incl. ACL, and `create_pipeline` rollback | FAIL | **FAIL** — capabilities now has a full ACL triad + 404 spec; Output CRUD already did. But `create_pipeline` (single-call transaction) does not exist, so there is no rollback test; `parentStepId` on step create, step-DELETE splice report, preview, validate-expression and shapes-expand still have no routes and no specs. |
| 2 | Metric Output over `sum`/`avg` binds; `select`-produced numeric column bindable; bad slot name → **400** with valid slot list | FAIL | **PARTIAL** — clauses 1 and 2 fully met at the HTTP layer (real repros, see Phase 2). Clause 3 (HEL-892) is met only as **domain logic** (`OutputBindingSpec.validateFieldMapping` + `OutputBindingSpecSpec`); no route returns a 400, because no live route accepts a `fieldMapping` payload yet. The AC says "is a 400". |
| 3 | Enumerate **every** producer of a field-type string by grep; assert each emits canonical values | FAIL | **FAIL** — three producers found and fixed (real), but the sweep was scoped to `PipelineAnalyzeService` only and **missed a fourth live producer**. See "AC 3 gap" below. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | PASS | **PASS** |
| 5 | `/api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query` return 404 | PARTIAL | **PASS** — `ApiRoutesSpec` now asserts the absence directly (4 cases). The `POST /api/panels/bound` case asserts 405 rather than 404, with a correct and honestly-stated explanation: `PanelIdSegment` is an unconstrained `Segment`, so `"bound"` matches as a bogus panel id and only the method fails. Either status proves no `BoundPanelRoutes` exists; accepted. |
| 6 | `GET /api/outputs/:id/assertion-status`; alert rules against `targetOutputId` | FAIL | **FAIL** — not implemented (CR5, deferred). |
| 7 | `check-schema-drift.mjs` green, proposal files untouched | PASS | **PASS** — re-verified independently. |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` + selftest green; no `@deprecated`/alias/shim | PASS | **PASS** — re-verified independently. |
| 9 | `PipelineAnalyzeService` per-node projection, exercised by `capabilities?stepId=` | FAIL | **PASS** — both halves real and genuinely exercised end-to-end (Phase 2). |

Net: **5 of 9 met** (up from 3), 1 partial, 3 failed.

### AC 3 gap — a fourth non-canonical producer the sweep missed

`tasks.md` 3.5 claims "*every* field-type-string producer" was grepped, qualifying it to
"in `PipelineAnalyzeService`". AC 3 is not scoped that way, and the narrower scope let a
live instance of the identical bug through:

- `ExpressionEvaluator.inferTypeOf` (`ExpressionEvaluator.scala:459`, `:470`, and the
  `Call` arm below it) returns the non-canonical string **`"number"`**.
- `PipelineAnalyzeService.inferCompute` (`PipelineAnalyzeService.scala:361-364`) uses that
  return value **verbatim as a `SchemaField.type`**:
  `val outputType = ExpressionEvaluator.inferType(expression, fieldTypes).getOrElse(wireType)`
  → `inputSchema :+ SchemaField(name = column, `type` = outputType)`.
- Consequence, identical to the HEL-895/638 bug this cycle fixed: `buildNodeCapabilities`
  (`PipelineService.scala:238`) filters `columns` through `DataFieldType.fromString`, which
  returns `None` for `"number"`. **A `compute` step's derived numeric column is silently
  dropped from `columns` and is never eligible for a metric/chart `value` slot.** A user who
  computes `$revenue - $cost` cannot bind a metric to it.
- The `getOrElse(wireType)` fallback makes it worse, not better: the documented wire config
  shape is literally `{"column":"tax","expression":"$amount * 0.1","type":"number"}`
  (`PipelineAnalyzeService.scala:339` and `PipelineAnalyzeServiceSpec.scala:290,303`), so
  the fallback path emits `"number"` too.

This is not a hypothetical: it is the same defect, in the same consumer, reachable from the
route this cycle shipped. AC 3 exists precisely to catch it, and the sweep as performed did
not. (I also note `DemoData.scala:44` seeds `SchemaField("amount", "number")` — a fixture,
not a producer, but it means the seeded demo pipeline's `amount` column is non-bindable
under the new capabilities route. Worth fixing in the same pass.)

### Bookkeeping accuracy — much improved, one residual overstatement

- Cycle 1's incorrect "task 2.4 is tested" claim (which I flagged) is **fixed**: three real
  `GET /api/outputs/:id/panels` HTTP cases now exist (owner/grantee/other + empty result).
  Good-faith correction, verified.
- The HEL-892 framing is **honest**: both `tasks.md` 3.6 and the `OutputBindingSpec`
  scaladoc say in terms that it is "**NOT yet wired to a live HTTP route** … domain-logic
  coverage only, not an HTTP 400 regression test". No smuggled claim. It still doesn't
  satisfy the AC, but it is not misrepresented.
- Residual: `tasks.md` 3.5 is marked `[x]` while AC 3's own wording ("every producer") is
  not satisfied — see the gap above. It should go back to `[ ]` or be re-scoped explicitly.
- CR4/CR5/CR6/most-of-CR8 deferrals are documented in `execution-progress.md` under an
  explicit cycle-2 section; I cross-checked each against the diff and found no case where
  something claimed-deferred was actually done, or vice versa.

## Phase 2: Code Review — PASS

### Gates, all re-run by me in this worktree (fresh evidence)

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` →
  **`Tests: succeeded 3421, failed 0` / `All tests passed` / exit 0.**
- **Delta verified as real, not a flake.** The claim is +21 over cycle 1's 3400. Counting
  added test cases in the cycle-2 diff: `ApiRoutesSpec` +4, `OutputRoutesSpec` +3,
  `PipelineCapabilitiesRoutesSpec` +6, `PipelineAnalyzeServiceSpec` +5 `in {` lines of which
  2 are renames of existing cases (so +3 new), `OutputBindingSpecSpec` +5. 4+3+6+3+5 = **21**,
  matching 3421−3400 exactly. Every added case is a new assertion, none are skipped/pending.
- `node scripts/check-schema-drift.mjs` → in sync (64 schemas / **48** protocol files, up
  from 47 — the new `NodeCapabilitiesProtocol`). Green.
- Proposal-split check → `git diff --stat origin/main...HEAD` on
  `backend/.../DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is
  **empty**; the only `proposal`-matching path in the whole branch diff is this change's own
  `proposal.md`. AC 7 holds.
- `npx openspec validate --all` → **340 passed, 0 failed**.
- `npm run check:spec-structure` → 338 canonical specs, 0 issues.
- `npm run check:openspec` → `openspec/ is clean`.
- `node scripts/check-scala-quality.mjs` → **clean** (134 pre-existing soft warnings; none
  in files this cycle touched).
- Frontend gates: not run — **zero `frontend/**` files in the branch diff**, correctly.

### The three field-type fixes — verified real, not evidence-shaped

I confirmed the canonical set independently from `model.scala`'s `DataFieldType`:
`StringType, IntegerType, FloatType, BooleanType, TimestampType, StringBodyType,
BinaryRefType` — seven values. `"number"` and `"date"` are indeed not among them, and
`DataFieldType.fromString` returns `None` for both, so the "silently dropped column"
mechanism the executor describes is exactly right.

1. **`aggResultType` `sum`/`avg`: `"number"` → `"float"`** (`PipelineAnalyzeService.scala:744`).
   Real, and guarded end-to-end rather than by a same-spec twin: the guard is an **HTTP
   route test** (`PipelineCapabilitiesRoutesSpec`, "a metric Output binds over a sum/avg
   aggregate (HEL-895/638 repro)") that inserts a real `aggregate` step into a real pipeline,
   calls `GET /capabilities?stepId=`, and asserts `columns` *contains* `"total"`, that its
   `dataType` is `"float"`, that `metric.bindable` is `true`, **and** that
   `eligibleColumns("value")` contains `"total"`. Reverting the fix makes the column vanish
   from `columns` and flips `bindable` to false — three independent assertions go red. This
   is a genuine repro of the user-visible symptom, not a restatement of the constant.
2. **`inferWindow` `running_sum`: `"number"` → `"float"`** (`:572`). Guarded by
   `PipelineAnalyzeServiceSpec` "window — appends outputColumn with canonical float type for
   running_sum". Weaker than #1 (unit-level, asserts the constant), but it is the direct
   output of the producer and would fail on revert.
3. **`inferDateBucket`: `"date"` → `"timestamp"`** (`:513`). Same shape as #2, two guards
   (overwrite case and append case).
   For #2 and #3 the executor did **not** delete or `pending`-out the pre-existing
   assertions that pinned the old wrong values — it *updated* them to the corrected value
   (visible in the diff at `PipelineAnalyzeServiceSpec.scala:367,590,607,684`). That is the
   right call and it is the thing I would have flagged had it gone the other way.

### CR1 (per-node projection) — real

`PipelineAnalyzeService.analyzeNodes` (`:86-140`) is a genuine `parentStepId`-tree walk
(`groupBy(_.parentStepId)`, recursive `walk`, each node's `inputSchema` taken from its own
parent's `outputSchema`), not `analyze`'s linear chain re-labelled. The guard I asked for is
present and correctly shaped: the tail's projection is asserted to be a *different value*
(`Vector(order_id, amount)` vs the 3-column `baseSchema`) **and** `should not equal
trunkProjection` — a same-shape assertion would have proved nothing, and this isn't one. A
second case asserts `tail.inputSchema == trunk.outputSchema` **and** `should not equal
baseSchema`, which is the property that actually distinguishes a tree walk from a chain.
The scaladoc's explanation of why it deliberately does *not* replicate
`InProcessPipelineEngine`'s `InvalidGraph` structural validation is sound and correctly
identifies where that responsibility lives.

### CR2 (capabilities-at-node) — real, one defect

`PipelineService.capabilitiesAtNode` (`:203-235`) correctly resolves `stepId = None` to the
source schema, 404s an unresolvable `stepId` rather than silently falling back to the source
(explicitly documented, and tested), filters disabled steps, and reuses
`PanelCapabilityColumnResponse`/`PanelCapabilityResponse` verbatim rather than cloning
parallel wire types. Route wiring in `PipelineRoutes` is correctly placed *before* the
`path(PipelineIdSegment)` catch-all. Six route tests including the ACL triad.

**Defect (Change Request 1 below):** the source schema is read with
`dataSourceRepo.findByIdOwned(pipeline.sourceDataSourceId, user)` and
`.getOrElse(Vector.empty)` (`PipelineService.scala:211`). For an **editor grantee** of a
shared pipeline whose *data source* is owned by someone else, `findByIdOwned` returns `None`,
so `sourceSchema` silently becomes empty and the grantee gets a **200 with zero columns and
every kind `bindable = false`** — a wrong answer dressed as a successful one. The ACL-triad
test does not catch this because the grantee case asserts only `status shouldBe OK` and
never inspects the body. In mitigation this is the *pre-existing* idiom — `analyze` at
`:157` does exactly the same thing — so it is an inherited latent gap rather than one
introduced here, and it is arguably out of this ticket's scope. But P1.6's frontend will
consume this route for shared pipelines, so it should not ship silently.

### Other code observations

- Both stale comments I flagged in cycle 1 are fixed: `OutputRoutes`'s inaccurate "mounted
  twice" claim is corrected, and the dead `ApiRoutes.scala:184-187` placeholder is removed
  (the `-4` lines in the `ApiRoutes` diff).
- My non-blocking `updateOwned` empty-body suggestion was taken **and regression-tested**
  ("404 an empty-body (no fields to update) PATCH from a non-owner grantee, not a 200
  no-op"). Verified in the diff at `OutputRepository.scala`.
- `PipelineCapabilitiesRoutesSpec` uses `new DbContext(db, db)` — superuser on both pools,
  so **RLS is vacuous in this spec**. That is defensible here and the spec's header comment
  says why: this route's ACL is app-level (`pipelineRepo.findByIdShared`), not RLS. It is
  *not* the same class of guarantee `OutputRoutesSpec` gets from its real non-superuser
  `SET ROLE` pool, though, and the header should say that explicitly so a later reader
  doesn't cite this spec as RLS evidence.
- No inline fully-qualified names; no `@deprecated`/alias/shim; no dead code or leftover
  TODO/FIXME; no untyped escape hatches. `validateFieldMapping` correctly reports *every*
  unknown key rather than the first, and is tested for exactly that.
- HEL-910 sweep (CR10) re-run and recorded in `execution-progress.md`; I spot-checked it and
  found no new in-scope hits.

## Phase 3: UI Review — N/A

Stated explicitly, per the ticket's own UI Gate section: P1.3 is backend/contract only.
Confirmed by `git diff --name-only main...HEAD` — the branch touches only
`backend/src/**`, `schemas/outputs/**` and `openspec/changes/**`. **Zero `frontend/**`
files.** Dev servers were not started and no browser checks were run. Deliberate N/A, not a
silently skipped gate.

## Overall: FAIL

AC 1, AC 3 and AC 6 unmet; AC 2 partial. The cycle-2 work itself is high quality and I found
no defect in it beyond CR 1 below — the FAIL is about remaining ticket surface, plus the one
substantive AC-3 sweep gap.

## Change Requests

1. **Close the AC-3 producer gap (new — do this first, it is cheap and it is a live bug).**
   Fix `ExpressionEvaluator.inferTypeOf` (`ExpressionEvaluator.scala:459`, `:470`, and the
   `Call` arm) to emit `"float"` instead of `"number"`, or map at the
   `PipelineAnalyzeService.inferCompute` boundary (`:361-364`) — the boundary is the safer
   choice if `inferType`'s `"number"` has non-schema consumers; check both call sites before
   deciding. Update the `getOrElse(wireType)` fallback and the documented config shape at
   `:339`. Regression test in the same shape as the sum/avg one that already works: a real
   `compute` step over a numeric expression, `GET /capabilities?stepId=`, assert the derived
   column appears in `columns` with `dataType = "float"` and is in
   `eligibleColumns("value")`. Then **re-run the sweep repo-wide, not just within
   `PipelineAnalyzeService`**, and record the enumeration in `execution-progress.md` so AC 3
   is auditable. Also fix `DemoData.scala:44`'s seeded `"number"`.
2. **Un-tick `tasks.md` 3.5** (or re-scope its wording) until CR 1 lands — as written it
   claims an enumeration that demonstrably missed a producer.
3. **Fix the grantee source-schema hole** in `PipelineService.capabilitiesAtNode:211`: use a
   sharing-aware source lookup (or resolve the schema through the already-access-checked
   pipeline) instead of `findByIdOwned(...).getOrElse(Vector.empty)`, so an editor grantee
   gets the real projection rather than a vacuous empty one. Strengthen the ACL-triad test's
   grantee case to assert the **body** (non-empty `columns`, `metric.bindable = true`), not
   just the 200. If you conclude this is genuinely out of scope because `analyze:157` has
   the same shape, say so explicitly in the PR and file a spinoff — do not leave it silent.
4. **CR4 (carried): single-call transactional `POST /api/pipelines`** (task 3.1) — inline
   source | `sourceId`, `steps[]` with `parentStepId`, `outputs[]`, one Slick transaction,
   with rollback tests for a failing step *and* a failing Output. Plus task 3.2
   (`parentStepId` on step create; splice removed-placement count on step DELETE) and the
   task 1.2 schemas. Closes the rest of AC 1.
5. **CR5 (carried): `GET /api/outputs/:id/assertion-status`** (task 2.5) including the
   alert-rule create/read path against `targetOutputId`. Closes AC 6.
6. **CR6 (carried): `PublicDashboardRoutes.scala:51-56` rewire** off
   `findLastRunAtByOutputDataTypeId` to `panel → output → pipeline.lastRunAt` (task 4.3), and
   **drop `outputDataTypeId`/`outputDataTypeName`** from the `PipelineRepository`/
   `PipelineService` create/list path (task 4.4). The `pipeline-list-api` spec delta already
   in this change dir still describes behavior the code does not have.
7. **Wire HEL-892 to a real 400** so AC 2's third clause is met at the HTTP layer. This is
   blocked on there being a route that accepts a `fieldMapping` — most naturally
   `POST/PATCH /api/outputs/:id` validating `config.fieldMapping` against the Output's kind.
   That is a small addition to routes that already exist and would close AC 2 without
   waiting for CR4.
8. **CR8 remainder (carried):** `GET /api/outputs/:id/rows` (2.4);
   `POST /api/pipelines/:id/preview` with the "run state unchanged" assertion (3.7);
   `POST /api/pipelines/:id/validate-expression?stepId=` (3.9 — now cheap, `analyzeNodes`
   gives it the node schema directly); `POST /api/pipeline-shapes/:id/expand` `{steps,
   outputs?}` envelope + `parentStepId` (3.8, BREAKING — update every existing
   `PipelineShapeRoutes` test); `DataSource.inferredSchema` on `DataSourceResponse`
   (3.10 + schema 1.3); decision-15 server-owned panel layout append in the panel-insert
   transaction with a rollback test (2.7); lean paginated `/api/outputs` + `/api/dashboards`
   (2.6); `config.format` for HEL-876 (2.3b); the
   `output-capabilities-response`/`preview-outputs-response` schemas (rest of 1.1).
9. **Minor:** extend `PipelineCapabilitiesRoutesSpec`'s header comment to state that its
   `DbContext(db, db)` is superuser-on-both-pools and therefore proves nothing about RLS —
   so the spec is never later mis-cited as RLS evidence.

## Critical Path for Cycle 3

Cycle 3 is the last ordinary cycle in this run's `EXECUTION_CYCLES=3` budget. Ordered by
AC-closure per unit of work — this ordering deliberately front-loads the items that can
still *finish* an AC:

1. **CR 1 + CR 2 — the AC-3 producer gap.** Smallest change on this list, closes an entire
   AC outright, and fixes a live user-visible binding bug in the route shipped this cycle.
   Do it first; it is measured in minutes, not hours.
2. **CR 7 — HEL-892 as a real 400.** Closes AC 2's last clause. Small, and reachable without
   CR4 by validating `config.fieldMapping` on the Output create/update routes that already
   exist. Together with step 1 this takes the AC count from 5/9 to **7/9**.
3. **CR 5 — assertion-status.** Closes AC 6, taking it to **8/9**, and is self-contained
   (one route, one service method, one spec) unlike CR4.
4. **CR 4 — single-call `create_pipeline` + `parentStepId`.** The only remaining AC (AC 1)
   and by far the largest item: one Slick transaction spanning source/steps/outputs plus two
   rollback tests. It is the realistic cycle-3 sink, so start it only after 1-3 are green,
   and treat "steps 1-3 done, CR4 in flight" as a materially better landing point than
   "CR4 half-done and nothing else".
5. **CR 3 — grantee source-schema hole.** Small; slot it wherever it fits, or file the
   spinoff and say so in the PR.
6. **CR 6 — `PublicDashboardRoutes` rewire + `outputDataTypeId` drop.** Not an AC, but the
   `pipeline-list-api` spec delta in this change dir is currently inconsistent with the code,
   and P1.7 assumes it is done. If cycle 3 cannot fit it, it must be called out explicitly
   at hand-off rather than discovered by P1.7.
7. **CR 8 remainder + CR 9.** Largest by count, lowest per-item risk, closes no further AC.
   Realistically this is the escalation-worthy remainder.

### Recommendation for the human (final-cycle note)

Even with a perfect cycle 3, CR 8's remainder is very unlikely to fit alongside CR 4 — this
ticket is carrying roughly three tickets' worth of scope (Output CRUD, the projection +
capabilities stack, the single-call creation transaction, and a cleanup sweep), which is why
it has consumed two full cycles to reach 5/9 AC. The delivered work is genuinely good and
gate-green at every step; the problem is sizing, not execution quality. My recommendation is
to plan for cycle 3 to target **AC completion (steps 1-4 above) and then split the CR 8
remainder into a P1.3b follow-up ticket**, rather than spending a third cycle's escalation
budget rediscovering that the surface does not fit. Nothing found so far suggests the design
is wrong or that any shipped behavior is unsafe.

## Non-blocking Suggestions

- `PipelineCapabilitiesRoutesSpec` and `OutputRoutesSpec` both stand up their own
  `EmbeddedPostgres` + Flyway migration in `beforeAll`. That is correct for isolation but the
  per-spec startup cost is now paid twice and will be paid again for every new route spec
  this ticket still owes; a shared fixture trait would pay for itself over CR 4/5/8.
- `OutputRoutesSpec` is now 337 lines and `PipelineCapabilitiesRoutesSpec` 208; both will
  keep growing through cycle 3. Consider splitting before they join the 134-file soft-budget
  warning list.
- `analyzeNodes` returns `Map[String, AnalyzedStep]` built from a `mutable.LinkedHashMap`
  whose insertion order is then discarded by `.toMap`. If callers ever need
  topological order, return the `LinkedHashMap`'s sequence instead; today nothing depends on
  it, so this is purely a note for the CR-4 author.
