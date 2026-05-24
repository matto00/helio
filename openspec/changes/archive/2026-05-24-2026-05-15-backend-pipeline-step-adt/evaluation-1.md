# Evaluation Report — Cycle 1 (CS2c-3a PipelineStep ADT + wire-shape evolution)

## Status
**CHANGES_REQUESTED.** One Blocker: the typed codec hard-fails at the repository's
`rowToDomain` layer on any persisted step whose JSON config is missing fields
required by its `*Config` case class. The seeded `ProfitAgg` pipeline (and any
real user pipeline mid-edit) hits this on the very first `/steps` or
`/analyze` call, returning 500 and rendering the pipeline as if it has zero
steps in the UI. The executor already implemented tolerance helpers for
`filter`, `compute`, and `aggregate` configs — the gap is that `join` (and
the other strictly-decoded kinds) need the same treatment, or the repo
should surface decode failures per-step (with a `validationError` flag)
instead of failing the entire list. Apart from this regression every other
phase-3 check passes cleanly: typed wire shape round-trips, analyze shape
is right, dry-run / real-run / cross-type PATCH lock all behave as
specified, console is clean on the new pipeline path.

## Phase 1: Spec Review — PASS

All artifacts internally consistent:
- `ticket.md` scope (10-subtype ADT, wire-shape evolution, engine split,
  PipelineRunService extraction, 4-way route decomp, AllowedOps removal,
  cross-type PATCH lock, frontend lockstep, OpenSpec sync) ↔
  `proposal.md` "what changes" sections ↔ `design.md` decisions ↔
  `tasks.md` (every box ticked except 13.x smoke, which is correctly
  evaluator-run).
- `executor-report-1.md` is candid: surfaces the two soft-budget overages
  (handlers 311 / RunService 306), the analyze-layer-still-stringly-typed
  deliberate carve-out, the Spark Select/Limit/Sort/Aggregate fail-fast
  posture, and the V31 migration as a latent-bug fix discovered during work.
  Spinoffs captured (#1–#6).
- `files-modified.md` matches what's on disk (verified by `git diff --stat`).
- `design.md` §13 smoke flow matches what I ran.

The post-hoc V31 Flyway migration is a defensible inclusion: it closes the
DB CHECK-constraint half of the same `AllowedOps` drift the ticket scopes
in §1, and the proposal explicitly states the fix-AllowedOps-drift goal.
Behaviour-preserving in that it brings the DB into alignment with what the
engine already accepts.

## Phase 2: Code Review — PASS with one Blocker (read-path tolerance gap)

### ADT correctness — PASS
`domain/Pipeline.scala:22-189` defines the 10 subtypes with constants in
`PipelineStepKind.All` (line 184); `parseKind` is the centralised valid-set
check. Each subtype's `kind` field is `val`-overridden — preserves the
sealed-trait contract and lets pattern matches stay exhaustive.

The "11-case" mentioned in the prompt is the historic stringly-typed match;
the new typed dispatch in `InProcessPipelineEngine.applyStep` (lines 87-99)
covers exactly the 10 typed subtypes with a compiler-verified exhaustive
match — no `case other` default needed. Confirmed by reading the file:
zero `@unchecked`, zero default arm, no compiler warnings would be possible.

`PipelineStepKind.All` has parity with the sealed-trait subclasses — the
`Set[String]` is hard-coded to the 10 names that match the 10 subtype
constants on the same object. No automated `sealedSubclasses` derivation,
but the surface is small and the `PipelineStepSpec` exercises both sides.

### Wire-shape evolution — PASS
`PipelineStepProtocol.scala`'s `pipelineStepResponseFormat` (lines 140-172)
and `PipelineProtocol.scala`'s `analyzeStepResponseFormat` (lines 173-204)
follow the CS2c-2 `DataSource` dispatcher pattern exactly: write injects
`type` into the per-subtype JsObject, read pattern-matches on the `type`
discriminator, unknown discriminators fail with `deserializationError`,
missing discriminator fails with a descriptive message. Smoke-verified:
new pipeline creates emit `{ type, config: object, ... }`; never `op` or
`config: string`.

Cross-type PATCH: `PipelineService.updateStep` (lines 219-228) compares
`req.`type`` to the persisted `existing.kind`; on mismatch returns
`ServiceError.BadRequest` with the message
> "Cannot change step type from 'X' to 'Y'. Delete the step and create a
> new one instead."

Verified live in Phase 3: `PATCH /api/pipeline-steps/<filterId>` with
`{type:"sort", config:{sortBy:[]}}` → 400 with that exact message.

### Engine split — PASS
`InProcessPipelineEngine.scala` shrunk from 456L → 145L (68% reduction).
`PipelineStepHandlers.scala` (311L) carries the per-kind logic. Read every
handler: shapes match the pre-CS2c-3a `applyX` methods verbatim — same
operator coverage on Filter (`= != > >= < <= contains is null is not null`),
same numeric-coercion fallback (Try → no-match), same group/aggregate fn
support (sum/count vs sum/avg/min/max/count), same join inner/left
semantics, same Sort foldRight + secondary-sort behaviour, same Compute
JsValue round-trip via `ExpressionEvaluator`. No subtle semantics changes
spotted. Static-row loader correctly delegates to
`PipelineStepHandlers.parseStaticRows` (line 61), preserving the
column-named tuple shape.

`InProcessPipelineEngineSpec.scala` is 725L (was 702L); executor migrated
fixtures via a `makeStep(op, configString)` helper that round-trips through
the codec. Suite green per executor's 566/566 sbt count.

### PipelineRunService extraction — PASS (with structural-note)
Pre-execution sequencing preserved at `PipelineRunService.scala:75-93`:
publish "queued" → conditional insertRun + deleteOldRuns(keepN=10) →
publish "running" → loadRows + executeWithStepCounts. Failure path
(lines 95-110) publishes "failed", updates run record, then updates
pipeline meta. Success path (lines 112-120) splits on `isDry` → DataType
schema + rows upsert + pipeline meta + run terminal update. This matches
the pre-CS2c-3a routes-bound logic.

`previewStep` (lines 129-174) preserves the slice-by-stepId-then-execute
pattern with a 10-row take and a recovery arm that wraps engine errors as
`UnprocessableEntity` (422). Looks right.

In-process vs Spark dispatch: the prior route only had the in-process
engine path explicitly; the Spark submitter is a separate code path
(invoked from elsewhere). The service correctly rejects
`RestSource | SqlSource` with 422 at both `submit` and `previewStep`
boundaries — preserving the pre-CS2c-3a "static/csv only" surface contract.

**Structural note (non-blocking):** `PipelineRunService.submit` is a single
large `flatMap` chain with deep nesting (findById → findById → match →
listByPipeline → preExec → runFuture.transformWith). Behaviour is right
but a future cleanup that pulls the inner `runFuture` + transform into a
private method would improve readability. Same tracking as executor's
spinoff #2.

### Route decomposition — PASS
`PipelineRunRoutes.scala` deleted; 4 new route files (Submit 33L, Status 48L,
History 23L, Stream 41L) all well under the 150L hard limit. `ApiRoutes.scala:160-163`
composes all 4 explicitly. Endpoint coverage versus the pre-CS2c-3a route
(read from `git show main:.../PipelineRunRoutes.scala`):
- POST `/pipelines/:id/run[?dry=true]` → Submit ✓
- GET `/pipelines/:id/runs/:runId` (cached status) → Status ✓
- GET `/pipelines/:id/steps/:stepId/preview` → Status (co-located: file name
  is `Status` but it owns preview too; per design.md §5 executor flexibility
  this is acceptable) ✓
- GET `/pipelines/:id/run-history` → History ✓
- GET `/pipelines/:id/run-events` (SSE) → Stream ✓

No endpoint dropped. The preview endpoint living under "Status" instead of
its own file is fine — both are GET reads on the run-execution path.

### Flyway V31 — PASS
`V31__add_aggregate_op.sql` drops and re-adds the `pipeline_steps_op_check`
constraint to include `'aggregate'`. Idempotent via `DROP CONSTRAINT IF
EXISTS`. Forward-only. Migrated cleanly when the worktree backend started.

### Spark submitter — PASS (with documented limitation)
`SparkJobSubmitter.scala:150-209` typed dispatch. Filter handler synthesizes
SQL from typed conditions (lines 154-170) — the executor's "conservative
SQL synthesis" caveat (spinoff #5) is honestly documented; SQL escape is
single-quote-only-doubled, not parameterised, but no test/data path I
can see in this PR exposes that to untrusted input today.

Select / Limit / Sort / Aggregate explicitly throw with a clear "not yet
supported on the Spark execution path" message (lines 204-208). Pre-CS2c-3a
the same surface was rejected upstream (route layer rejected REST/SQL
sources before Spark could reach these ops, and in-process is the only
path for static/csv steps). Net: Spark coverage parity is preserved.
Tracked as spinoff #3.

### `PipelineStepConfigCodec` — Blocker on read tolerance + note on `Try[Any]`
`decode` (lines 113-127) returns `Try[Any]` rather than `Try[PipelineStepConfig]`
because the codebase lacks a sealed `PipelineStepConfig` trait — each
`*Config` case class is unrelated. That's a typing weakness: every
consumer (`PipelineService.toAnalyzeStepResponse:158`,
`PipelineStepRepository.rowToDomain:85`, `PipelineService.addStep:198`)
has to pattern-match all 10 `Success(cfg: XConfig)` arms with a `Success(other)`
fallback that throws `IllegalStateException`. The fallback is unreachable
in practice (codec only emits the 10 known types) but a sealed trait
+ `Try[PipelineStepConfig]` would make that a compile-time guarantee.
Non-blocking spinoff candidate.

The Blocker is the read-path tolerance gap, detailed in Phase 3 below.
Briefly: the codec's `decode(kind, raw)` calls `JsonParser(raw).convertTo[*Config]`
unconditionally for Rename / Join / GroupBy / Cast / Select / Limit / Sort
— any persisted row whose JSON is missing a required key throws
`NoSuchElementException` → wrapped as `IllegalStateException` →
`/steps` and `/analyze` return 500 for the **entire pipeline**, not just
the affected step.

Filter / Compute / Aggregate have explicit tolerance helpers
(`decodeFilter:48`, `decodeCompute:66`, `decodeAggregate:91`) — the
executor explicitly identified mid-edit / legacy partial configs as a
real concern and protected those three kinds. The other 7 kinds did not
get the same treatment.

### `PipelineService.AllowedOps` removal — PASS
`PipelineService.scala:193-196` sources the allow-list from
`PipelineStepKind.All`. Grep confirms no `AllowedOps` symbol remains in
production code; only DemoData / comment / test references mention it
historically (`grep AllowedOps backend/src/{main,test}` → 4 hits, all in
docstrings/tests/migration comments).

### File-size budgets — PASS
| File | Lines | Budget | Status |
|---|---:|---:|---|
| All 4 new route files | ≤ 48 | 150 (hard) | ✓ |
| `InProcessPipelineEngine.scala` | 145 | 250 | ✓ |
| `Pipeline.scala` | 189 | 200 | ✓ |
| `PipelineStepHandlers.scala` | 311 | 300 (soft) | ⚠ +11; per CS2c-2 precedent acceptable |
| `PipelineStepProtocol.scala` | 176 | 250 | ✓ |
| `PipelineProtocol.scala` | 235 | 250 | ✓ |
| `PipelineStepConfigCodec.scala` | 170 | 250 | ✓ |
| `PipelineService.scala` | 296 | 300 | ✓ |
| `PipelineRunService.scala` | 306 | 300 (soft) | ⚠ +6; per CS2c-2 precedent acceptable |
| `PipelineStepRepository.scala` | 138 | 200 | ✓ |
| `SparkJobSubmitter.scala` | 238 | 250 | ✓ |

Both soft overages match CS2c-2's bar (services 318 / 337). Non-blocking.

### AuthService diff — PASS
`git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala`
returns 0 bytes. Verified.

### Inline FQN compliance — PASS (with minor note)
`check:scala-quality` enforces a specific prefix list (see
`feedback-no-inline-fqns.md`: `com.helio.*`, `spray.json.*`,
`org.apache.pekko.*`, `java.util.UUID`, `java.util.Base64`,
`java.nio.charset.*`, `java.security.*`, `at.favre.lib.*`, `slick.jdbc.*`).
Executor reports the script is clean and grepping the modified files
confirms no violations.

**Minor non-blocking note:** `PipelineRunService.scala:96,112` use
`scala.util.Failure(ex)` / `scala.util.Success(...)` as inline FQNs inside
the `transformWith` match. The mechanical script doesn't catch `scala.util`
(not in `FQN_PREFIXES`), so this is technically compliant, but the prose
rule in `CONTRIBUTING.md` says "always import at the top of the file." The
rest of the same file imports `scala.util.{Failure, Success}` would be a
trivial one-line clean-up; `PipelineService.scala:49` already does this.

### Frontend type lockstep — PASS
`frontend/src/types/models.ts:373-509` defines the discriminated union:
`PipelineStep` has 10 subtypes, each with typed `config` per its
`*Config` interface, narrowed on the `type` discriminator. Same pattern
for `AnalyzeStepResult` (lines 567+). `PipelineStepConfig` union exported
for narrowing helpers.

`grep 'JSON.parse\|JSON.stringify' frontend/src/` returned hits only in
expected places: SSE event parsing in `usePipelineRunEvents.ts:135`,
fingerprint generation for the analyze-cache dedup in
`PipelineDetailPage.tsx:775` (which is correct — `JSON.stringify` of a
typed config object as a memoisation key is legitimate). No
`JSON.parse(step.config)` callsites remain. Narrowing helpers are
internal to `PipelineDetailPage.tsx:253-304` and are 1-call-each — they're
typed-cast wrappers, not the 3-consumer narrowing helpers the proposal
warned about. Acceptable.

### Test coverage — PASS
`PipelineStepProtocolSpec` (88L) covers all 10 subtypes' write+read round
trip, missing-`type` error, unknown-`type` error, partial PATCH bodies
(config-only, position-only). `PipelineStepConfigCodecSpec` (133L) covers
per-kind decode/encode round trip and tolerance edge cases. `PipelineStepSpec`
(103L) covers kind correctness and the `PipelineStepKind.All` parity
with sealed-trait subclasses. `PipelineStepRoutesSpec` adds cross-type
PATCH 400 case (line 159) and the aggregate-acceptance regression
(line 234). `PipelineRunRoutesSpec` composes against the 4 new route files.

The only missing test for the regression I'm flagging: there's no
"persisted partial config" parity test for the strictly-decoded kinds
(Rename / Join / GroupBy / Cast / Select / Limit / Sort). Adding one
filter-style test that inserts a row with `config = '{}'` and reads it
back via `listByPipeline` would have caught the seeded-data 500 in CI.

### `PipelineAnalyzeService` stringly-typed carve-out — PASS as a spinoff
`PipelineService.analyze` (lines 105-150) round-trips typed configs
through the codec (`encode(s)` line 132) into the stringly-typed
`PipelineAnalyzeService.PipelineStepInput`, runs schema inference, then
re-decodes the analyze layer's output config string via
`PipelineStepConfigCodec.decode` and maps it back to the typed analyze
response. Bit-exact round-trip through the codec is preserved; the
analyze layer's inference logic is untouched. Honest carve-out, tracked
as executor spinoff #4.

## Phase 3: UI Review — FAIL on read-path regression; PASS on new-pipeline happy path

Backend booted cleanly on `BACKEND_PORT=8081`, V31 migration applied,
CORS allowed `http://localhost:5174`. Frontend on `DEV_PORT=5174` reached
ready in ~6s.

| Smoke step | Result |
|---|---|
| 1. Login (`matt@helio.dev`) | PASS — redirected to dashboards |
| 2. Navigate to `/pipelines` | PASS — list shows seeded `ProfitAgg` with succeeded last-run state |
| 3a. Open `ProfitAgg` (existing pipeline) | **FAIL** — `GET /api/pipelines/.../steps` and `/analyze` both return **500**; UI degrades to "0 steps / Add your first transformation step" empty state, so user has no path to recovery from inside the app |
| 3b. Create new pipeline `Smoke CS2c-3a` against `Profit` static source | PASS — POST returned 201 with typed body |
| 4. Add 3 steps (filter / sort / limit) via API | PASS — every request body emitted `{ type, config: object }`; every response carried the same typed shape; verified by inspecting JSON payloads in `browser_evaluate` |
| 5. Analyze the new pipeline | PASS — `/analyze` returned 200 with 3 typed steps; `configType: "object"` for all three (no stringified blobs) |
| 6. Run pipeline (after PATCHing the filter to `field: profit`) | PASS — 5 source rows → filter `profit > 0` → sort desc → limit 3 returns the correct top-3 result `[{date,"2/1/2026",profit:100}, {3/1, 20000}, {4/1, 1000000}]` |
| 7. Run history + step counts | PASS — Network response carries `stepRowCounts` keyed by step id; `sourceRowCount: 5`; UI shows "Run history (3)" and "Last run: 8 seconds ago" / "Rows written: 3" / SUCCEEDED |
| 8. Reload page; verify steps re-load with typed config | PASS — 3 step cards re-render, 0 console errors, expanding the Limit card shows `<input type="number" value="3">` (typed config consumed correctly by the editor component) |
| Cross-type PATCH lock | PASS — `PATCH /api/pipeline-steps/<filterId>` with `{type:"sort", config:{sortBy:[]}}` → `400` with message `Cannot change step type from 'filter' to 'sort'. Delete the step and create a new one instead.` |
| Console errors during new-pipeline flow | PASS — 0 errors after re-load |

### The Blocker, in detail

```
[error] o.apache.pekko.actor.ActorSystemImpl - Error during processing of request:
  'PipelineStepRepository: failed to decode config for step
   9607c209-421c-48b9-b4f2-1cb72b103092 (op='join'):
   Object is missing required member 'rightDataSourceId''.
   Completing with 500 Internal Server Error response.
```

The seeded `ProfitAgg` pipeline has a `join` step with `config = '{}'` in
the `pipeline_steps.config` column (verified via direct psql query).
Pre-CS2c-3a the `/steps` endpoint returned the row with `config: "{}"` as
a stringified blob — the engine would have failed at `applyJoin` runtime
on `cfg.fields("rightDataSourceId")`, but list / analyze stayed alive. After
CS2c-3a, `PipelineStepRepository.rowToDomain` calls
`PipelineStepConfigCodec.decode(row.op, row.config)`, which for `join`
unconditionally invokes `JsonParser(raw).convertTo[JoinConfig]`. That
throws `NoSuchElementException`, gets wrapped in
`IllegalStateException("failed to decode config for step <id>...")`, and
the request handler completes with 500 — for the entire `listByPipeline`
result, not just the malformed step.

`PipelineStepConfigCodec` already protects three kinds — Filter
(`decodeFilter:48`), Compute (`decodeCompute:66`), Aggregate
(`decodeAggregate:91`) — exactly because the executor recognised that
mid-edit / legacy partial configs are a real concern. The Rename / Join /
GroupBy / Cast / Select / Limit / Sort kinds didn't get the same treatment.

**Impact in this PR:**
- Seeded `ProfitAgg` pipeline is unreadable in the UI on first navigation
  — dev devs hitting `pipelines/<seeded-id>` after the migration land on
  an empty-state screen with no UI affordance to delete/repair the bad row.
- Any production pipeline with a partial config under the strictly-decoded
  kinds (most likely: a join created mid-edit before the right source was
  picked) hits the same wall — the whole pipeline becomes unreadable.

**Minimum fix paths (executor's choice — flag in cycle 2):**
1. **Extend tolerance to the remaining 7 kinds** in `PipelineStepConfigCodec`
   — give each its own `decode<Kind>` with same-default-on-missing-key
   semantics the proposal already established. Pre-CS2c-3a behaviour
   (list/analyze succeed; execution may fail) is preserved.
2. **Make the repo's `rowToDomain` non-fatal**: catch the codec failure
   per-step and surface a "ValidationErrorStep" subtype (or a wrapper)
   that the wire response can present as `{ type, configError: "...",
   validationError: "..." }`. Slightly larger but better UX — user sees the
   bad step in the list and can delete it.
3. **Repair the seed row in DemoData** (executor's `DemoData.scala` likely
   inserts `ProfitAgg` with `config: "{}"` — switch it to a non-empty
   default that matches the new `JoinConfig` shape OR drop the join step
   from the seed).

Of these, (1) is the minimum-viable fix that matches the proposal's
"behaviour-preserving" stance for the structural refactor — the executor
already opened that door for Filter/Compute/Aggregate; closing the gap for
the other 7 kinds matches the executor's own design intent. (3) is
worth doing **in addition** so the seeded pipeline shows a useful join
example instead of an empty `{}` one.

The behaviour-preservation rule in `feedback-refactor-discipline.md` is
load-bearing here: structural changes should NOT regress read-path
behaviour even when surfacing a latent bug. A read-time validation
regression is the wrong place to fix latent malformed-config data.

## Overall: CHANGES_REQUESTED

The blocker is narrowly scoped (one tolerance pattern, already partially
applied; or a small DemoData seed adjustment; or both) and doesn't touch
the core ADT / wire-shape / engine-split / route-decomp work, all of
which lands cleanly. The new-pipeline happy path is rock solid in Phase 3
end-to-end.

## Change Requests

1. **[Blocker]** Extend `PipelineStepConfigCodec` tolerance to the
   remaining 7 step kinds (Rename / Join / GroupBy / Cast / Select / Limit /
   Sort) so a persisted row with a partial config doesn't 500 the entire
   `/steps` and `/analyze` endpoints. The pattern from
   `decodeFilter` / `decodeCompute` / `decodeAggregate` (parse JsObject,
   pull each field with `.fields.get(...)` and a typed default, build the
   case class) extends naturally. Concrete missing-key defaults to match
   pre-CS2c-3a's `cfg.fields.get(...).getOrElse(...)` behaviour:
   - `Rename`: `renames` → empty `Map[String, String]`
   - `Join`: `rightDataSourceId` → `""`; `joinKey` → `""`; `joinType` → `"inner"`
   - `GroupBy`: `groupBy` → empty `Vector[String]`; `aggColumn` → `""`; `aggFunction` → `"sum"`
   - `Cast`: `casts` → empty `Map[String, String]`
   - `Select`: `fields` → empty `Vector[String]`
   - `Limit`: `count` → `0` (engine's `applyLimit` already short-circuits
     to `rows` if `count <= 0`)
   - `Sort`: `sortBy` → empty `Vector[SortKey]`

   Add a `PipelineStepConfigCodecSpec` round-trip test per kind for
   `decode(kind, "{}")` succeeding with the default values. Smoke this
   by hitting `GET /api/pipelines/<ProfitAgg-id>/steps` post-fix and
   confirming the join step's `config` is `{ rightDataSourceId: "",
   joinKey: "", joinType: "inner" }` (or whatever default the codec
   chooses).

   **Strongly preferred over** a structural per-step error surface — the
   tolerance approach matches the executor's stated design for the three
   already-protected kinds and is the minimal behaviour-preserving fix.

## Non-blocking Suggestions

1. **Inline `scala.util.Failure`/`scala.util.Success` in `PipelineRunService.scala:96,112`**
   — move to the file's import block to satisfy the prose FQN rule
   (mechanical check ignores `scala.util` but the rule is the rule).
   `PipelineService.scala:49` shows the right pattern.

2. **Consider a sealed `PipelineStepConfig` trait** so `decode` can return
   `Try[PipelineStepConfig]` instead of `Try[Any]`. Removes the
   `Success(other)` unreachable arm from
   `PipelineStepRepository.rowToDomain:96-99` and
   `PipelineService.toAnalyzeStepResponse:169-172`. Compile-time
   guarantee of exhaustiveness. Spinoff candidate, low urgency.

3. **Seed-data hygiene** — even after the codec tolerance fix, the
   `ProfitAgg` join step in DemoData persists with `config: {}` which is
   a runtime-error-on-execute. Either (a) point the join at a real second
   data source in seed (so the demo pipeline runs end-to-end), or (b) drop
   the join step from `ProfitAgg` and rename the pipeline so it's not a
   demo of an unusable feature. Drive-by hygiene; tracked as spinoff #4 in
   the executor's report by implication (the analyze-typed-config spinoff).

4. **Add a "persisted-partial-config" repository round-trip test** —
   `PipelineStepRepositorySpec` (or `PipelineStepConfigCodecSpec`) should
   include a "decode({}) succeeds with defaults for every kind" case. This
   is the regression CI would have caught.

5. **Soft file-size overages (handlers 311, RunService 306)** —
   pre-existing-style spinoff per CS2c-2's bar. Not urgent.

6. **`PipelineRunService.submit` nesting** — refactor inner `runFuture`
   composition out into a private `executeRun(...)` helper to flatten the
   six-level indent. Readability win, no behaviour change.

## Test counts (verified)
- `sbt test`: executor reports **566 / 566 PASS** (+35 from CS2c-2's 531
  baseline); not re-run by evaluator
- `npm test`: executor reports **664 / 664 PASS**
- `npm run check:scala-quality`: clean per executor; manual FQN grep on
  modified files matches
- Frontend lint / format / build: green per executor

## Phase 3 environment notes
Backend started cleanly on first try with V31 migration applied. Frontend
proxied `/api` to 8081 via the `BACKEND_PORT` env. No CORS issues. Smoke
took ~6 minutes total including the blocker root-cause dive into the
backend log + DB inspection.
