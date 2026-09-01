# Evaluation Report — Cycle 3 (evaluation-3.md)

Ticket: HEL-906 (P1.3). Change: `output-routes-api-contracts`.
Reviewed commit `39512347` (on top of cycle 2's `64ddd88d`). Builds on `evaluation-1.md`
and `evaluation-2.md`.

Cycle-3 scope was items 1-3 of evaluation-2.md's critical path; item 4 (single-call
`create_pipeline`) was skipped **by the coordinator's explicit instruction**, not by the
executor narrowing scope. I have evaluated it on that basis.

Headline: item 2 (HEL-892 as a real HTTP 400) is **done properly and closes AC 2**. Item 1
made real progress and fixed three genuine bugs, but **AC 3 is still not met — I found three
more unnormalized field-type producers**, one of them a direct sibling of the two just
fixed, in the same file. Item 3 shipped a working route but rests on a **factually false
premise about dry runs that I disproved in the code**, and that false claim is now written
into both the Scala doc comment and the published JSON schema.

## Phase 1: Spec Review — FAIL

### AC table, re-checked directly against `ticket.md`

| # | Acceptance criterion | C1 | C2 | C3 |
|---|---|---|---|---|
| 1 | Route specs for every new route incl. ACL; `create_pipeline` transaction rolls back | FAIL | FAIL | **FAIL** — `create_pipeline` still absent (CR4, carried by coordinator ruling). `parentStepId`, step-DELETE splice report, preview, validate-expression, shapes-expand still have no routes. |
| 2 | Metric Output over `sum`/`avg` binds; `select`-produced column bindable; bad slot name → **400** with valid slot list | FAIL | PARTIAL | **PASS** — the third clause is now a genuine HTTP 400 on the real persisted-write path (verified below). All three clauses met. |
| 3 | Enumerate **every** producer of a field-type string; assert each emits canonical values | FAIL | FAIL | **FAIL** — three real fixes landed, but three unnormalized producers remain. See "AC 3" below. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | PASS | PASS | **PASS** |
| 5 | `/api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query` 404 | PARTIAL | PASS | **PASS** |
| 6 | `GET /api/outputs/:id/assertion-status` reports the **last run's** assertion outcome; alert rules against `targetOutputId` | FAIL | FAIL | **FAIL** — route implemented and correct for the step-scoping half, and the alert-rule half is genuinely already shipped on `main` (verified). But the route has **no dry-run filter**, so it can report a *preview's* assertion outcome as the last run's. See "AC 6" below. |
| 7 | `check-schema-drift.mjs` green, proposal files untouched | PASS | PASS | **PASS** |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` + selftest green; no `@deprecated`/alias/shim | PASS | PASS | **PASS** |
| 9 | Per-node projection exercised by `capabilities?stepId=` | FAIL | PASS | **PASS** |

Net: **6 of 9 met** (up from 5). AC 1, AC 3, AC 6 outstanding.

### AC 3 — raw grep output, as requested, and what it does and does not prove

The coordinator asked for the raw grep rather than a summary, given this AC has been
reported satisfied twice already. Here is my own unqualified sweep across all of
`backend/src/main/scala`:

```
$ grep -rn '"number"' backend/src/main/scala
PipelineAnalyzeService.scala:339:   *  Config shape: {"column": "outputField", "expression": "$fieldA / $fieldB", "type": "number"}
PipelineAnalyzeService.scala:376:   *  synonym (`"number"`/`"double"` -> `"float"`, `"long"` -> `"integer"`, `"date"` ->
PipelineAnalyzeService.scala:383:    case "number" | "double" => "float"
PipelineAnalyzeService.scala:576:   *  rank family, `float` for `running_sum` (HEL-895/638: ... not "number"), the same declared type as
ExpressionEvaluator.scala:449:   * ... not the non-canonical `"number"` this used to emit) of `expr`
ExpressionEvaluator.scala:657:    case VNum(_) => "number"

$ grep -rn '"double"' backend/src/main/scala
PipelineAnalyzeService.scala:376:   (comment)
PipelineAnalyzeService.scala:383:    case "number" | "double" => "float"
CastStep.scala:76:      case "double"  => Try(str.toDouble).getOrElse(null)
SparkJobSubmitter.scala:264:    case "double"    => DoubleType

$ grep -rn '"date"\|"datetime"' backend/src/main/scala
PipelineAnalyzeService.scala:376:   (comment)
PipelineAnalyzeService.scala:385:    case "date"               => "timestamp"
CastStep.scala:78:      case "date"    => str
WorkspaceContextService.scala:476:  private val TemporalNameTokens: Set[String] = Set("date", "time", "timestamp", "dob")
WorkspaceContextService.scala:483:   (comment)
```

**On the executor's specific claims about the residue, it is correct.** I verified
`ExpressionEvaluator.scala:657` (`typeName`) is `private` and used only at lines 592, 617,
626, 632, 638 — all inside error-message string interpolation, never as a schema type. And
`CastStep.scala:76,78` / `SparkJobSubmitter.scala:264` are runtime *value* dispatch and
Spark type mapping — consumers, not schema-type producers. Those three are correctly
out of scope for AC 3.

**But the method is what fails the AC, not the residue.** Grepping for the literal
wrong strings can only find *hardcoded* wrong emissions. It structurally cannot find
**pass-through** producers, where a caller-supplied string flows into a `SchemaField`
unnormalized. The executor did fix two such sites this cycle (`inferCompute`'s fallback,
`inferCast`'s casts) — but only the two evaluation-2.md happened to name. Enumerating
`SchemaField(` construction sites instead of type-string literals surfaces three more that
are still live:

1. **`PipelineAnalyzeService.scala:396-401` — `inferAggregate`'s `groupBy` fields.**
   `SchemaField(name = obj.fields("name").convertTo[String], `type` = obj.fields("type").convertTo[String])`
   — a caller-supplied config string straight into a projected `SchemaField`, with **no
   `canonicalizeLegacyType`**. This is a direct sibling of `inferCompute` and `inferCast`,
   in the same file, ~40 lines from the helper written to fix exactly this. A `groupBy` on
   a column declared `"number"` in the step config produces a non-canonical projected
   column, which `buildNodeCapabilities` (`PipelineService.scala:238`) then drops via
   `DataFieldType.fromString` — the identical HEL-895/638 symptom.
2. **`DataSourceService.scala:121` — static-source create.**
   `val fields = req.columns.map(col => SchemaField(col.name, col.`type`)).toVector`, then
   `dataSourceRepo.upsertInferredSchema(ds.id, fields, ...)`. This **persists** a
   caller-supplied type string as the source's `inferredSchema`. I checked for an upstream
   guard and there is none: no `DataFieldType.fromString` validation in the path, and no
   `enum` constraint on the column type in any schema under `schemas/`. That persisted
   `inferredSchema` is precisely what `capabilitiesAtNode` reads as `sourceSchema`
   (`PipelineService.scala:211`), so a client posting `{"name":"amount","type":"number"}`
   creates a source whose column is permanently invisible to the capabilities route shipped
   in cycle 2. This is the highest-impact of the three: it is a persisted, boundary-level
   producer.
3. **`PipelineService.scala:445` — inline static source dry-analyze.**
   `payload.columns.map(c => SchemaField(c.name, c.`type`))`, same unnormalized pass-through
   on the inline-source analyze path.

For completeness, I checked the other `SchemaField(` sites and they are fine:
`PipelineSchemaDrift.scala:43-44` and `inferUnpivot`'s `valueType`
(`PipelineAnalyzeService.scala:630-633`) derive from an existing schema and inherit its
canonicality; `PipelineRunService.scala:681`, `PipelineService.scala:457` and
`DataSourceService.scala:167,229,308,398,483,776` all go through
`DataFieldType.asString`/a typed `dataType`, so they are canonical by construction.

`DemoData.scala:44` was correctly fixed (`"number"` → `"float"`) — verified in the diff.

### AC 6 — the dry-run premise is false, and the false claim is now published

The executor's claim, which the coordinator asked me to verify rather than accept: *"dry
runs persist nothing so no separate filter is needed."* **This is false.** Tracing it:

- `assertionStatus` (`OutputService.scala:198-215`) calls
  `pipelineRunRepo.listByPipelineInternal(...)` and takes `.headOption`.
- `listByPipelineInternal` (`PipelineRunRepository.scala:211-217`) is
  `.filter(_.pipelineId === ...).sortBy(_.startedAt.desc)` — **no status filter at all**.
- A *successful* dry run **does** insert a `pipeline_runs` row:
  `insertDryRunInternal` (`PipelineRunRepository.scala:131-143`) writes into the same
  `runsTable` with `status = "dry_run"`. `deleteOldDryRunsInternal` (`:182-194`) confirms
  it by filtering `r.status === "dry_run"` on that same table for retention.
- Its assertion results are persisted too: `onDryRunSuccess`
  (`PipelineRunService.scala:561-580`) sequences `insertAssertions` **after** `insertDryRun`
  precisely so the FK parent row exists.

So whenever a dry run is the most recent row, `assertionStatus` reports **a preview's**
assertion outcome as the last run's. AC 6 says "reports the last run's assertion outcome".

The `PipelineRunService.scala:526` comment the claim appears to rest on
(*"a dry run persists nothing"*) is scoped, in its own next clause, to per-node writes:
*"it never reaches onUnblockedRunSuccess's per-node writes, **only its own (unchanged)
history/SSE bookkeeping**"* — i.e. it explicitly says the history row IS written. The
comment at `:496-497` says only that a **failed** dry run has no row.

Two compounding problems, and this is the part I would most want fixed:

- `OutputService.scala:194-196` now states as fact: *"A dry run persists no `pipeline_runs`
  row at all … so every row `listByPipelineInternal` returns is already non-dry by
  construction — no separate dry-run filter is needed here."* That is a confidently-false
  comment that will actively mislead the next reader away from the bug.
- `PipelineProtocol.scala:75-83` **and** the published contract
  `schemas/outputs/output-assertion-status.schema.json` both now say the status reflects
  the *"latest **NON-DRY** run"* / *"a dry run is never considered"* — describing behavior
  the code does not implement. The doc and the schema contradict the code, and the code
  comment contradicts the schema.

The four new assertion-status tests never construct a dry run, which is why this passed
green. This is the "evidence-shaped non-evidence" pattern in its ambient-fixture form: the
tests are real, but the scenario that breaks the invariant is simply absent.

### Verified claims (executor was right on these)

- **Item 2 is on the real write path, not decorative.** `validateFieldMapping` is called in
  `OutputService.create` before `outputRepo.insertInternal`, and in `update` on the
  **merged** config (`mergedConfig`, the exact object handed to `updateOwned`), not the raw
  patch — so a patch touching an unrelated sub-object cannot smuggle through an already
  invalid stored `fieldMapping`. The comment at `:126-129` states this reasoning correctly.
  I looked for a bypass and found none: `OutputRoutes` exposes no other write path to
  `config`, and `insertInternal`/`updateOwned` are only reached through these two methods.
  Three HTTP tests cover create-400, create-200, and merged-PATCH-400.
- **`AssertionStatusResponse.dataTypeId` → `outputId` is dead scaffolding.** Verified
  against `origin/main`: the only backend producer was the now-retired
  `/api/types/:id/assertion-status`; remaining `dataTypeId` hits are the proposal protocol
  (P1.4's scope) and comments. `check-schema-drift` is green with the renamed field.
  Caveat: `frontend/src/features/dataTypes/types/dataType.ts` still declares `dataTypeId` —
  P1.6 owns that, but it is now a wire break and should be named in the PR.
- **Alert-rule `targetOutputId` was already shipped.** Confirmed on `origin/main`:
  `openspec/specs/alert-rule-crud-api/spec.md:22,30,39,43` plus `AlertRuleService`,
  `AlertRuleRepository`, `AlertRuleProtocol` and route tests. No new work needed; the
  executor's "already done by a prior ticket" is accurate.
- **Test-count delta is real.** +10 claimed, and the diff adds exactly 10 new `in {` cases
  (8 in `OutputRoutesSpec`, 2 in `PipelineAnalyzeServiceSpec`); 3431 − 3421 = 10. Not a flake.

### Coordinator item (b): the `PipelineCapabilitiesRoutesSpec` header

**Not done.** `git diff 64ddd88d..HEAD -- .../PipelineCapabilitiesRoutesSpec.scala` is empty,
and the header (lines 33-39) still carries only the cycle-2 ACL note with no statement that
its `DbContext(db, db)` is superuser-on-both-pools and therefore proves nothing about RLS.
Per the coordinator's instruction, flagged as a small outstanding item for cycle 4, **not** a
blocker.

### Carried obligations — CR4 and CR6

Recording these explicitly per the coordinator's ruling, so they cannot later be
re-labelled as a "deferral" without a filed ticket:

- **CR4 — single-call transactional `POST /api/pipelines` + `parentStepId`** (tasks 3.1/3.2,
  schemas 1.2). Sole remaining blocker for AC 1. Skipped in cycle 3 by coordinator
  instruction. **Undropped.**
- **CR6 — `PublicDashboardRoutes.scala:51-56` rewire** off `findLastRunAtByOutputDataTypeId`
  to `panel → output → pipeline.lastRunAt` (task 4.3), and **dropping
  `outputDataTypeId`/`outputDataTypeName`** from `PipelineRepository`/`PipelineService`
  (task 4.4). Still fully outstanding. The `pipeline-list-api` spec delta already sitting in
  this change dir continues to describe behavior the code does not have, and the ticket's
  Out-of-Scope section explicitly assigns this rewire to *this* ticket. **Undropped.**

Neither may be converted into a deferral, a follow-up ticket, or corrected AC text
unilaterally — that decision goes to the human before the PR.

## Phase 2: Code Review — PASS

### Gates, all re-run by me in this worktree (fresh evidence)

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` →
  **`Tests: succeeded 3431, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / exit 0.**
- `node scripts/check-schema-drift.mjs` → in sync (64 schemas / 48 protocol files); panel-type
  enums in sync. Green **with the `dataTypeId` → `outputId` rename**, which is the real test
  of that rename.
- Proposal-split check → `git diff --stat origin/main...HEAD` on
  `backend/.../DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is
  **empty**; the only `proposal`-matching path in the branch diff remains this change's own
  `proposal.md`. AC 7 holds for the third cycle running.
- `npx openspec validate --all` → **340 passed, 0 failed**.
- `npm run check:openspec` → `openspec/ is clean`.
- `npm run check:spec-structure` → 338 canonical specs, 0 issues.
- `node scripts/check-scala-quality.mjs` → **clean** (134 pre-existing soft warnings; none in
  files this cycle touched).
- Frontend gates: not run — **zero `frontend/**` files in the branch diff**, correctly.

### Code observations

- `canonicalizeLegacyType` (`PipelineAnalyzeService.scala:379-387`) is a clean, well-scoped
  helper, and its scaladoc is honest that it is *"normalization of known synonyms, not full
  validation"*. Applying it at both `inferCompute` branches (including the
  `validate`-failure branch at `:358`, which is easy to miss) is correct. The
  `ExpressionEvaluator.inferTypeOf` fix is at the source rather than the call site, which is
  the right call — all four arms (`NumLit`, both `BinOp` arms, `length`) were changed
  consistently and the scaladoc was updated to match.
- Existing tests pinned to the old wrong values were **updated, not deleted or
  `pending`-ed** (`PipelineAnalyzeServiceSpec`, `ExpressionEvaluatorSpec`) — same good
  discipline as cycle 2.
- `assertionStatus`'s step-scoping is right and well-tested: the
  `a.stepId == stepId && a.severity == "error" && !a.passed` filter is guarded by a test
  asserting a failed assertion on a *different* step does not mark this Output invalid. The
  `node.stepId.isEmpty → invalid = false` short-circuit is correct (the raw source has no
  `assert` step) and tested. The `pipelineRunRepo == null` arm follows the file's existing
  nullable-optional convention and cannot NPE.
- No inline fully-qualified names; no `@deprecated`/alias/shim; no dead code or leftover
  TODO/FIXME; no untyped escape hatches introduced.
- **[minor] Validation-before-authorization ordering.** `OutputService.create` runs
  `validateFieldMapping` *before* `accessChecker.requireAccess` (`:84-90`), so a caller with
  no grant on the pipeline receives a 400 describing that kind's valid slots instead of a
  403. It is a thin oracle and it follows the pre-existing shape (name/kind validation was
  already ahead of the ACL check in cycle 1), so it is not a blocker — but authorization
  before input validation is the safer order.
- **[minor] `CastStep` / canonical-name divergence.** Now that `inferCast` canonicalizes the
  *analyze-time* schema, note that the *runtime* `CastStep.castValue`
  (`CastStep.scala:69-81`) dispatches on `"double"`/`"date"` and has **no arm for the
  canonical `"float"`/`"timestamp"`** — both fall to `case _ => str`. So a user who writes
  the canonical `"float"` gets a projected schema saying `float` and a runtime value left as
  a string. Pre-existing, out of this ticket's scope, and *not* an AC-3 producer — but it is
  adjacent enough to the work just done that it should be captured rather than rediscovered.

## Phase 3: UI Review — N/A

Stated explicitly, per the ticket's own UI Gate section: P1.3 is backend/contract only.
Confirmed by `git diff --name-only main...HEAD` — the branch touches only `backend/src/**`,
`schemas/outputs/**` and `openspec/changes/**`. **Zero `frontend/**` files.** Dev servers
were not started and no browser checks were run. Deliberate N/A, not a silently skipped gate.

## Overall: FAIL

AC 1, AC 3 and AC 6 outstanding. AC 2 newly closed and closed properly. The cycle-3 code is
good and every gate is green; the FAIL rests on the two substantive findings above (three
remaining field-type producers; the dry-run premise) plus the coordinator-carried CR4/CR6.

## Change Requests

1. **Fix `assertionStatus`'s missing dry-run filter, and retract the false claims.**
   (a) Filter out `status = "dry_run"` rows when selecting the latest run — either a new
   `listNonDryByPipelineInternal` on `PipelineRunRepository` or a `.filterNot(_.status ==
   "dry_run")` before `.headOption` at `OutputService.scala:203`; prefer the repository-level
   variant so the invariant is enforced where the ordering lives.
   (b) **Delete the false comment** at `OutputService.scala:194-196` — "a dry run persists no
   `pipeline_runs` row at all … no separate dry-run filter is needed here" is contradicted by
   `insertDryRunInternal` (`PipelineRunRepository.scala:131-143`) and by
   `deleteOldDryRunsInternal`'s own `status === "dry_run"` filter. Replace it with the
   accurate statement of what is filtered and why.
   (c) Add the regression test that would have caught this: run a real run with a passing
   assertion, then a **successful dry run** whose assertion **fails**, then assert
   `GET /api/outputs/:id/assertion-status` still reports `invalid = false` — i.e. the dry run
   is ignored. Without that test this can silently regress again.
   After (a)-(c), `PipelineProtocol.scala:75-83` and
   `schemas/outputs/output-assertion-status.schema.json` become true as written; do not
   weaken them to match the buggy behavior. Closes AC 6.
2. **Close AC 3 by enumerating producers, not literals.** Apply `canonicalizeLegacyType` (or
   a shared normalizer) at the three sites named above:
   `PipelineAnalyzeService.scala:396-401` (`inferAggregate` groupBy),
   `DataSourceService.scala:121` (persisted static-source `inferredSchema`), and
   `PipelineService.scala:445` (inline static-source analyze). For
   `DataSourceService.scala:121` consider rejecting rather than normalizing — it is a
   request boundary, so a `400` naming the seven canonical values may be better than silent
   coercion; that is a judgement call, make it deliberately and say which you chose and why.
   Add a capabilities-level regression for the aggregate-groupBy case in the same shape as
   the existing sum/avg one (assert the groupBy column appears in `columns` with a canonical
   `dataType`). **Then re-do the sweep by enumerating `SchemaField(` construction sites
   across `backend/src/main/scala`** — not by grepping for `"number"`/`"double"`/`"date"` —
   and record that enumeration verbatim in `execution-progress.md` so AC 3 is auditable.
   The literal-grep method has now missed a producer in each of the last two cycles.
3. **Consider adding an `enum` of the seven canonical `DataFieldType` values** to the
   column-type property of the create-source request schema, so the contract itself rejects
   `"number"` at the boundary rather than relying on every producer remembering to
   normalize. This is the durable fix for the whole bug class.
4. **CR4 (carried, undropped): single-call transactional `POST /api/pipelines`** — inline
   source | `sourceId`, `steps[]` with `parentStepId`, `outputs[]`, one Slick transaction,
   with rollback tests for a failing step *and* a failing Output; plus task 3.2
   (`parentStepId` on step create; splice removed-placement count on step DELETE) and the
   task 1.2 schemas. Sole remaining blocker for AC 1.
5. **CR6 (carried, undropped): `PublicDashboardRoutes` rewire + `outputDataTypeId` drop**
   (tasks 4.3/4.4), with the public-dashboard-route test returning rows for an Output-backed
   placement.
6. **Remaining scope (task list, not yet started):** `GET /api/outputs/:id/rows` (2.4);
   `POST /api/pipelines/:id/preview` with the "run state unchanged" assertion (3.7);
   `POST /api/pipelines/:id/validate-expression?stepId=` (3.9 — cheap now, `analyzeNodes`
   supplies the node schema directly); `POST /api/pipeline-shapes/:id/expand` `{steps,
   outputs?}` envelope + `parentStepId` (3.8, BREAKING — update every existing
   `PipelineShapeRoutes` test); `DataSource.inferredSchema` on `DataSourceResponse`
   (3.10 + schema 1.3); decision-15 server-owned panel layout append in the panel-insert
   transaction, with a rollback test (2.7); lean paginated `/api/outputs` + `/api/dashboards`
   (2.6); `config.format` for HEL-876 (2.3b); the
   `output-capabilities-response`/`preview-outputs-response` schemas (rest of 1.1).
7. **Small (coordinator item b):** add the RLS-vacuity note to
   `PipelineCapabilitiesRoutesSpec`'s header — state that its `DbContext(db, db)` is
   superuser on both pools and therefore proves nothing about RLS, so the spec is never later
   mis-cited as RLS evidence.
8. **Name the `AssertionStatusResponse.dataTypeId` → `outputId` wire break in the PR**, and
   flag `frontend/src/features/dataTypes/types/dataType.ts` as P1.6's to update.

## Critical Path for Cycle 4

Budget is now 6 cycles, so the ordering optimizes for correctness-per-item rather than
racing to a deadline. Correctness-of-shipped-behavior items come before new surface:

1. **CR 1 — the dry-run filter + retracting the false comment + the dry-run regression test.**
   First, and not just because it closes AC 6. A shipped route that reports a preview's
   result as the last run's is wrong *behavior*, and the comment and schema currently
   disagree with the code in a way that would mislead the next reader (and any later
   evaluator) into believing it is already handled. Small change, high value.
2. **CR 2 — the three remaining field-type producers + the `SchemaField(`-site enumeration.**
   Closes AC 3, and the `DataSourceService.scala:121` fix removes a persisted-data footgun
   that silently breaks the capabilities route shipped in cycle 2. Do the enumeration by
   construction site and write it down; the literal-grep approach has now under-reported
   twice, and this AC has been called satisfied twice.
   With 1 and 2 done the AC count reaches **8/9**, with only AC 1 (CR4) outstanding.
3. **CR 7 + CR 8 — the two documentation items.** Minutes of work; do them alongside 1-2 so
   they do not become a fourth cycle's trailing item.
4. **CR 4 — single-call `create_pipeline` + `parentStepId`.** The last AC and by far the
   largest item: one Slick transaction spanning source/steps/outputs, plus two rollback
   tests. It is a full cycle's work on its own; start it only once 1-3 are green, and give
   it a cycle to itself rather than interleaving it with CR 6.
5. **CR 5 — `PublicDashboardRoutes` rewire + `outputDataTypeId` drop.** Not an AC, but an
   explicit in-scope obligation from the ticket's Out-of-Scope section, and the
   `pipeline-list-api` spec delta in this change dir stays inconsistent with the code until
   it lands. P1.7 assumes it is done.
6. **CR 3 — the schema-level `enum` for canonical field types.** Optional but it is the only
   change on this list that makes the bug class structurally unrepeatable rather than
   fixed-once-per-discovery.
7. **CR 6 — remaining route/contract surface.** Largest by count, lowest per-item risk,
   closes no further AC. Realistically two cycles.

### Note for the human

Three cycles in, the pattern is consistent and worth stating plainly: **every cycle's code
has been good and every gate has been green, and every cycle has also surfaced a new
instance of the same latent bug class** (non-canonical field types: 3 found in cycle 2, 2
more fixed in cycle 3, 3 more found by me this cycle) plus, this cycle, a confidently-false
premise in a comment and a published schema. That is not an execution-quality problem — it
is what happens when a ticket this wide is verified incrementally: each pass only checks the
sites the previous report named. CR 2's "enumerate construction sites, not literals" and
CR 3's schema `enum` are the two changes that would actually stop the recurrence.

On sizing: CR 4 plus CR 5 plus CR 6's remainder is realistically 2-3 more cycles even at the
current pace. The raised budget of 6 makes that feasible. If you would still prefer to split,
the natural seam is after CR 4 lands (all 9 AC met), leaving CR 5 + CR 6 as a P1.3b — but per
your ruling that decision is yours, and I am not treating either as droppable in the
meantime.

## Non-blocking Suggestions

- `OutputService.create` — move `validateFieldMapping` after `accessChecker.requireAccess`
  so authorization precedes input validation and the 400 stops being a thin oracle for
  non-grantees.
- `CastStep.castValue` (`CastStep.scala:69-81`) has no arm for the canonical `"float"` or
  `"timestamp"`, so both fall through to `case _ => str` while the analyze-time schema now
  reports them as canonical. Pre-existing and out of scope, but worth a spinoff before
  someone hits the schema-says-float/value-is-string divergence.
- `OutputService.scala` is now 218 lines with five distinct responsibilities (CRUD, config
  merge, fieldMapping validation, cascade delete, assertion status). Splitting the assertion
  -status and validation concerns out would keep it under budget as CR 4/CR 6 add more.
- `OutputRoutesSpec` is now ~460 lines and stands up its own `EmbeddedPostgres`; with CR 4/5/6
  still to come, a shared embedded-Postgres fixture trait across the route specs would pay
  for itself.
