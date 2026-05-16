# Executor report — CS2c-3a (cycle 2)

## Status

**Complete.** Blocker resolved; two of three non-blocking suggestions folded in;
one non-blocking suggestion (DemoData seed hygiene) does not apply to source
code in this worktree (see decisions below).

## Blocker addressed

**Read-path tolerance gap in `PipelineStepConfigCodec`** — extended the
`decodeFilter` / `decodeCompute` / `decodeAggregate` pattern to the remaining
7 step kinds (Rename / Join / GroupBy / Cast / Select / Limit / Sort). Each
new helper pulls fields via `obj.fields.get(...)` with a typed default,
matching the pre-CS2c-3a `cfg.fields.get(...).getOrElse(...)` engine
behaviour. Defaults applied per the evaluator's prescribed table:

| Kind     | Defaults                                                                |
|----------|-------------------------------------------------------------------------|
| Rename   | `renames` → empty `Map[String, String]`                                 |
| Join     | `rightDataSourceId` → `""`; `joinKey` → `""`; `joinType` → `"inner"`    |
| GroupBy  | `groupBy` → empty `Vector[String]`; `aggColumn` → `""`; `aggFunction` → `"sum"` |
| Cast     | `casts` → empty `Map[String, String]`                                   |
| Select   | `fields` → empty `Vector[String]`                                       |
| Limit    | `count` → `0` (engine's `applyLimit` already short-circuits on `<= 0`)  |
| Sort     | `sortBy` → empty `Vector[SortKey]`                                      |

The existing `decodeFilter` / `decodeCompute` / `decodeAggregate` helpers were
not behaviour-modified — they were refactored only to share a common
`asObject(raw)` extraction so the file stays uniform across all 10 kinds.

The codec's file-header docstring was updated to remove the now-stale claim
that "this codec has no legacy-tolerance path." Replaced with a paragraph
describing the read-path tolerance contract and the execute-time error
parity with the pre-CS2c-3a engine.

## Regression coverage

Added tests in two files:

1. **`PipelineStepConfigCodecSpec`** — 7 per-kind `decode(kind, "{}")` tolerance
   cases (one each for rename / join / groupby / cast / select / limit / sort)
   plus a single parametric "every kind in `PipelineStepKind.All` tolerates
   `decode({})` without throwing" case that future-proofs against adding a new
   kind without its tolerance helper. 26 / 26 in this spec pass (was 17).

2. **`PipelineStepRepositorySpec` (NEW, 113L)** — embedded-Postgres
   round-trip that reproduces the evaluator's exact failure:
   - Insert a raw `pipeline_steps` row with `op = 'join'`, `config = '{}'`
     (using direct SQL, since the codec's typed insert path validates inputs).
   - Call `stepRepo.listByPipeline(pid)`.
   - Assert the result is a `JoinStep` with `rightDataSourceId == ""`,
     `joinKey == ""`, `joinType == "inner"` (the defaults the codec now
     returns), no exception, no 500.
   - Plus an "every kind tolerates raw config='{}'" round-trip and a full
     typed-config round-trip through `insert` + `listByPipeline`.

   The "join row with config='{}'" test is the specific regression CI would
   have caught.

## Non-blocking fixes folded in

1. **`scala.util.Failure` / `scala.util.Success` inline FQN cleanup in
   `PipelineRunService.scala`** — added `import scala.util.{Failure, Success}`
   to the file's import block (matching `PipelineService.scala:49`'s
   pattern). The two `scala.util.Failure(ex)` / `scala.util.Success((...))`
   call sites in the `transformWith` match were replaced with the imported
   names.

2. **`PipelineRunService.submit` deep-nesting refactor** — extracted the
   inner block (pre-execution + engine dispatch + `runFuture.transformWith`
   success/failure handling) into a private `executeRun(pipeline, dataSource,
   steps, isDry)` helper. `submit` is now a flat 3-level chain
   (findById → findById → match) terminating in a one-liner that delegates
   to `executeRun`. The helper is ~60 lines and replaces what was a
   six-level indent. Behaviour-preserving: every Future composition, every
   publish, every fall-through to `onDryRunSuccess` / `onRunSuccess` is
   verbatim from cycle 1; only the scoping changed. All 577 sbt tests pass.

## Non-blocking suggestion not actionable in this worktree

**DemoData seed hygiene for the `ProfitAgg` join step** — the seeded
`ProfitAgg` pipeline does *not* exist in `DemoData.scala`. The current
`DemoData` only seeds dashboards and panels; pipelines are not seeded by the
code in this worktree (`grep -rn 'Profit' backend/src` returns nothing).
The pipeline the evaluator hit at runtime exists in their local dev DB —
likely created interactively in a prior session and persisted across
restarts (the DB is durable; only `seedIfEmpty` skips when dashboards
exist). The blocker fix means that legacy row can now be read by the UI
without 500ing, and the user can delete it from inside the app.

If a seeded `ProfitAgg` (or any join-using) pipeline is wanted as part of
the dev story, it belongs in a follow-up that extends `DemoData` to seed a
pipeline + steps — that's outside the CS2c-3a structural-refactor scope per
`feedback-refactor-discipline.md`. Captured as a candidate spinoff in the
verification notes below.

## Decisions log

- **Codec growth (170L → 265L, +95L).** The file is now 15L over the soft
  budget (250). The growth is unavoidable — adding 7 per-kind helpers
  matches the pattern of the 3 existing ones, and a `forEach` reduction
  would obscure the per-kind defaults that the evaluator audited. Splitting
  the codec into one file per kind would re-fragment what's now a single
  read-path concern. Status: soft overage, parallels CS2c-2's bar.
- **PipelineRunService growth (306L → 323L, +17L).** Extracting `executeRun`
  saved a flat-vs-nested tradeoff but added the helper's signature + scoping
  scaffolding. Still a soft overage; readability gain is real.
- **Did not introduce a sealed `PipelineStepConfig` trait** — per prompt;
  out of cycle-2 scope.
- **Did not introduce a per-step `ValidationErrorStep` wrapper** — per
  prompt; evaluator preferred tolerance over a structural error surface.

## Verification gates (cycle 2)

| Gate | Result |
|---|---|
| `sbt test` | **577 / 577 PASS** (566 baseline + 11 new: 7 partial-config tolerance + 1 all-kinds parametric + 3 repo round-trip) |
| `npm test` | **664 / 664 PASS** (no count change — no frontend touches) |
| `npm run lint` | clean (zero warnings) |
| `npm run format:check` | clean |
| `npm run check:schemas` | clean (6 schemas checked across 13 protocol files) |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean — 21 soft warnings (20 pre-existing from cycle 1 + 1 new: codec at 265L) |
| `npm --prefix frontend run build` | clean |
| AuthService diff vs main | empty (verified via `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala`) |
| Cycle-1 blocker reproduction | **fixed** — `PipelineStepRepositorySpec` "decode a join row persisted with config='{}' into a default JoinStep (the cycle-1 regression)" passes; the codec returns `JoinConfig("", "", "inner")` instead of throwing |

## Files modified (cycle 2)

See `files-modified.md` for the running per-file map.

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` (MOD, 170 → 265L) — added 7 tolerance helpers + shared `asObject` extractor; refactored existing helpers to reuse it; updated file-header docstring.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (MOD, 306 → 323L) — added `import scala.util.{Failure, Success}`, added `Pipeline`/`DataSource`/`PipelineStep` to the domain import group, replaced inline `scala.util.{Failure,Success}` FQNs at the match sites, extracted the inner submit body into a private `executeRun(...)` helper.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` (MOD, 134 → 187L) — 7 per-kind decode-`{}` cases + 1 parametric all-kinds case.
- `backend/src/test/scala/com/helio/infrastructure/PipelineStepRepositorySpec.scala` (NEW, 113L) — embedded-Postgres regression coverage for the cycle-1 join-`{}` 500.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/executor-report-2.md` (NEW, this file).
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/files-modified.md` (APPENDED) — cycle 2 deltas section.

## Suggested commit sequence

1. Codec tolerance fix (`PipelineStepConfigCodec.scala`) + codec spec
2. Repository regression test (`PipelineStepRepositorySpec.scala`)
3. PipelineRunService FQN cleanup + `executeRun` refactor
4. Executor report + files-modified update (docs)

## Spinoffs surfaced in cycle 2

- **DemoData pipeline seeding** — `DemoData` does not seed pipelines today;
  a future improvement would seed a runnable demo pipeline (with a join
  pointing at a real second data source, or a non-join demo so the seed
  shows an end-to-end runnable example).
- **Codec file size** — at 265L the codec is a candidate for splitting into
  per-kind `decode*` helper files if it grows much further (e.g. when CS3
  introduces additional kinds).
