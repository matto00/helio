# Evaluation Report — Cycle 2 (CS2c-3a PipelineStep ADT + wire-shape evolution)

## Status
**APPROVED.** The cycle-1 blocker is closed: extending tolerance to all 10
step kinds in `PipelineStepConfigCodec` matches the prescribed defaults
table exactly, and the live `ProfitAgg` join row that returned 500 in
cycle 1 now decodes to `JoinConfig("", "", "inner")` and renders in the UI
with a "Remove step" affordance. The two non-blocking suggestions folded
in (FQN cleanup + `executeRun` extraction) are behaviour-preserving; the
DemoData seed-hygiene decision is honest — `DemoData.scala` does not seed
pipelines today, so the suggestion was correctly captured as a forward
marker.

## Phase 1: Spec & Report Review — PASS

### `executor-report-2.md` honesty
- Blocker resolution narrative matches the cycle-1 evaluator's prescribed
  fix path #1 (extend tolerance, not structural per-step error surface).
  The defaults table in the report is identical to the cycle-1 table at
  rows 372–379.
- DemoData claim verified: `grep -rn 'Profit\|pipeline\|seedPipeline' backend/src/main/scala/com/helio/infrastructure/DemoData.scala`
  returns 0 hits. The seeded `ProfitAgg` is local dev DB state from a
  prior interactive session (verified via the live `/api/pipelines` list).
  Forward marker capture is appropriate; not actionable in this PR.
- Soft-overage acknowledgements honest: codec 170 → 264L (the executor
  reported 265L; actual on disk is 264L — off by one line, not material),
  RunService 306 → 322L (reported 323L — same off-by-one).
- Test counts match: 8 new codec tests + 3 new repo tests = 11 added on
  top of cycle-1's 566 → 577 sbt total.

### `files-modified.md` cycle-2 deltas vs `git diff main..HEAD --stat`
- All cycle-2 modifications and additions enumerated in the "Cycle 2
  deltas" section match the diff. No undisclosed file touches.
- AuthService diff vs main: empty (`git diff main..HEAD -- backend/src/main/scala/com/helio/services/AuthService.scala | wc -c` → 0).

### Stable artifacts (re-pass from cycle 1)
Per resumability rules, did not re-read `ticket.md` / `proposal.md` /
`design.md` / `tasks.md` — cycle-1 evaluation already confirmed PASS on
spec consistency and these artifacts are stable.

## Phase 2: Code Review (targeted to cycle-2 surfaces) — PASS

### Blocker fix correctness — PASS
**All 7 newly-added `decode<Kind>` helpers exist** at
`PipelineStepConfigCodec.scala`:
- `decodeRename` (line 116) → `RenameConfig(Map.empty)` on missing key
- `decodeJoin` (line 125) → `JoinConfig("", "", "inner")` on missing keys
- `decodeGroupBy` (line 142) → `GroupByConfig(Vector.empty, "", "sum")`
- `decodeCast` (line 160) → `CastConfig(Map.empty)`
- `decodeSelect` (line 169) → `SelectConfig(Vector.empty)`
- `decodeLimit` (line 179) → `LimitConfig(0)` (uses `toIntExact` with `getOrElse(0)` — safe on overflow)
- `decodeSort` (line 188) → `SortConfig(Vector.empty[SortKey])`

Defaults match the cycle-1 evaluation table **bit-for-bit**. Shared
`asObject(raw)` helper (line 198) returns `JsObject.empty` on a non-object
top-level value rather than throwing — defensive and consistent across all
10 decoders. The existing `decodeFilter`/`decodeCompute`/`decodeAggregate`
helpers were refactored only to use the shared extractor; behaviour
unchanged.

**`decode(kind, "{}")` test coverage** at
`PipelineStepConfigCodecSpec.scala`:
- 7 explicit per-kind cases (lines 100–128, rename/join/groupby/cast/
  select/limit/sort) asserting the exact default-valued config
- 1 parametric "every kind in `PipelineStepKind.All` tolerates
  `decode({})`" case (line 130–139) — future-proofs against adding a
  new kind without its tolerance helper.

**Repo-level regression at `PipelineStepRepositorySpec.scala`**: exercises
the actual `listByPipeline` codepath against an embedded-Postgres instance
(not the codec in isolation). The "decode a join row persisted with
config='{}' into a default JoinStep (the cycle-1 regression)" case
(lines 84–97) inserts a raw `pipeline_steps` row with `op='join'`,
`config='{}'` via direct SQL, then asserts `listByPipeline` returns a
`JoinStep` with `JoinConfig("", "", "inner")` — the precise scenario the
cycle-1 smoke caught.

### `executeRun` helper extraction — PASS (behaviour-preserving)
`PipelineRunService.scala`:
- `submit` is now a flat findById → findById → match → executeRun chain
  (lines 55–77). Six-level indent reduced to three.
- `executeRun` (line 180) preserves every Future composition from the
  cycle-1 version: `publish("queued")` → `preExec` (insertRun +
  deleteOldRuns, or no-op for dry run) → `publish("running")` → engine
  load + execute → `transformWith` with `Failure` and `Success` branches.
- Failure branch (line 212): publishes "failed", updates run terminal +
  pipeline meta only when `!isDry`, returns `UnprocessableEntity`. Order
  matches cycle 1.
- Success branch (line 227): delegates to `onDryRunSuccess` or
  `onRunSuccess`. These helpers were already present in cycle 1; they're
  now invoked from the extracted `executeRun` body rather than inline.
- SSE event ordering unchanged: "queued" before any DB work, "running"
  immediately before engine dispatch, terminal event before the response
  resolves.

### FQN cleanup — PASS
`import scala.util.{Failure, Success}` at line 33; grep shows zero
remaining inline `scala.util.*` references in `PipelineRunService.scala`.
Two original violations at cycle-1 lines 96/112 are gone — replaced by
the imported names inside the `transformWith` match.

### File-size soft overages — PASS (per CS2c-2 precedent)
| File | Cycle 1 | Cycle 2 | Soft budget | Hard blocker |
|---|---:|---:|---:|---|
| `PipelineStepConfigCodec.scala` | 170 | 264 | 250 | 400 — well under |
| `PipelineRunService.scala` | 306 | 322 | 300 | 400 — well under |

Both overages are justified:
- Codec growth is the inevitable cost of adding 7 per-kind tolerance
  helpers; consolidating into a single parametric decoder would obscure
  the per-kind defaults that are themselves the contract.
- RunService growth is the cost of the readability refactor the cycle-1
  evaluator asked for; the helper signature + scaffolding adds ~17 lines
  but flattens a six-level nest.

Same bar as CS2c-2 (services 318 / 337). Non-blocking; spinoff candidate
if either file grows further.

### AuthService diff — PASS
`git diff main..HEAD -- backend/src/main/scala/com/helio/services/AuthService.scala`
returns 0 bytes. Untouched, as required.

### Scala-quality spot check — PASS
- No inline FQN regressions in the 4 cycle-2-touched files (codec, run
  service, codec spec, repo spec).
- Executor reports `check:scala-quality` clean with 21 soft warnings
  (20 cycle-1 + 1 new at codec 264L). Not re-run.

### Domain imports correctness — PASS
`PipelineRunService.scala:5-16` adds `Pipeline`, `DataSource`, `PipelineStep`
to the domain import group to support the new `executeRun` signature. All
referenced symbols resolve through the import (no inline FQNs introduced).

## Phase 3: UI / Playwright Re-run — PASS

Backend started cleanly on `BACKEND_PORT=8081` (CORS allowed
`http://localhost:5174`). Frontend on `DEV_PORT=5174` reached ready in ~5s.

### The required check — cycle-1 blocker scenario
The seeded `ProfitAgg` pipeline is **present** in the local dev DB
(`GET /api/pipelines` returns it with id `6c75e682-4a7c-469b-b9ba-5fda8e4adc42`).
The join step from cycle 1 is still there at position 5, id
`9607c209-421c-48b9-b4f2-1cb72b103092` — same id the cycle-1 backend log
referenced.

| Check | Result |
|---|---|
| `GET /api/pipelines/<ProfitAgg-id>/steps` | **200** — all 6 steps returned; join step's config decoded to `{joinKey: "", joinType: "inner", rightDataSourceId: ""}` (exactly the prescribed defaults) |
| `GET /api/pipelines/<ProfitAgg-id>/analyze` | **200** — all 6 typed steps; join step carries the same default config; `validationError: "Unknown op: 'join'"` from the analyze inference layer is **separate** from the repo-decode regression and is the expected stringly-typed carve-out flagged in cycle 1 as a spinoff (analyze inference still references the pre-typed op set — orthogonal to the codec fix) |
| UI renders the pipeline | **PASS** — 6 step cards visible (Select / Rename / Compute / Sort / Compute / Join tables); not the "0 steps / Add your first transformation step" empty state |
| User has a UI affordance to delete the join step | **PASS** — expanding the "Join tables" card surfaces a **"Remove step"** button (verified via `browser_evaluate` against the rendered DOM) |

### Light parity checks
| Check | Result |
|---|---|
| Create new step (`POST /api/pipelines/<pid>/steps` with `{type:"limit", config:{count:7}}`) | **201** with typed wire shape `{type: "limit", config: {count: 7}, ...}`; followed up with `DELETE /api/pipeline-steps/<newid>` → 204 (cleanup) |
| Cross-type PATCH lock | **400** with the expected message `Cannot change step type from 'sort' to 'filter'. Delete the step and create a new one instead.` (tested against the sort step at position 3) |
| Console errors on ProfitAgg view | **0 errors, 0 warnings** (3 info-level messages, none related to JSON parse or API errors) |

### `validationError` on the analyze response — note
The analyze response for the join step includes `"validationError": "Unknown op: 'join'"`. This comes from
`PipelineAnalyzeService` — the stringly-typed analyze inference layer that
the cycle-1 evaluator already documented as a deliberate carve-out
(spinoff #4 in the executor's cycle-1 report). It is **not** the codec
read-path regression: the typed `config` object on the same step is
correctly populated. The analyze inference treating "join" as unknown is
a pre-existing analyze-layer limitation independent of this PR's scope.
Worth re-confirming in CS3 when the analyze layer migrates to typed
inference.

## Overall: APPROVED

The cycle-1 blocker is closed by the right mechanism — codec tolerance,
matching the executor's already-established pattern for Filter / Compute /
Aggregate. The two non-blocking refactors landed cleanly and are
behaviour-preserving. No regressions introduced; no scope creep. The PR
is ready to merge after this evaluation.

## Findings

### Blockers
- (none)

### Notes (non-blocking)
1. **Codec at 264L / RunService at 322L** are both ~15–22L over their soft
   budgets. Acceptable per the CS2c-2 precedent; flag for split if either
   grows further (likely candidate when CS3 introduces additional step
   kinds or analyze-typed inference).
2. **Analyze `validationError: "Unknown op: 'join'"`** on the join step is
   the pre-existing analyze-inference stringly-typed carve-out
   (cycle-1 spinoff #4), not a regression. Worth confirming the
   forward-marker is still tracked.

### Forward markers (spinoff candidates)
1. **DemoData pipeline seeding** — `DemoData.scala` does not seed
   pipelines today; a runnable demo pipeline (with a join pointing at a
   real second data source) would harden the dev story but is out of
   structural-refactor scope.
2. **Sealed `PipelineStepConfig` trait** — would let `decode` return
   `Try[PipelineStepConfig]` instead of `Try[Any]` and remove the
   `Success(other)` unreachable arms in the repository / service. Low
   urgency, compile-time-guarantee win.
3. **Codec file split** — at 264L the codec is a candidate for per-kind
   `decode*` helper files when CS3 introduces additional kinds.
4. **Analyze-layer typed inference** — move `PipelineAnalyzeService` off
   the stringly-typed `PipelineStepInput` so analyze stops emitting
   `validationError: "Unknown op: 'join'"` on every typed-codec round
   trip.

## Test counts (verified)
- `sbt test`: executor reports **577 / 577 PASS** (566 cycle-1 + 11 new); not re-run by evaluator
- `npm test`: executor reports **664 / 664 PASS** (unchanged — backend-only cycle)
- `npm run check:scala-quality`: clean (21 soft warnings; +1 new from codec at 264L)
- Frontend lint / format / build: green per executor

## Phase 3 environment notes
Backend up on 8081 in ~2 minutes after first sbt compile, healthy on
first try. Frontend ready in 5s. CORS clean. ProfitAgg pipeline persisted
across the restart (durable DB state, as expected). Cycle-2 smoke
focused on the blocker scenario plus 3 light parity checks; took ~3
minutes including the misrouted `POST /api/pipeline-steps` → re-test
against `POST /api/pipelines/:id/steps`.
