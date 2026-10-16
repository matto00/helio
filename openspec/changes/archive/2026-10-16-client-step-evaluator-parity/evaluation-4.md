## Evaluation Report — Cycle 4, re-evaluation after auditor STALE (evaluation-4.md)

Reviewed HEAD: `f64907012b35f7cdaadc9a1e8fc8262d46c72807` (archive commit on top of squash `0f7e330d8`, base `0d8bd55cf`, resolved live via `resolve-review-base.sh`).
Previously PASSed at `db8ade2f2` (evaluation-3.md). Delta reviewed since then:

- `3b79f2f4c`: merge of `origin/main` (`0d8bd55cf`). `git show --remerge-diff` is empty, so the merge resolved with no conflicts and no hand edits.
- `80725c3f8`: the final-gate round 1 fixes (Unicode-digit epoch strings, `Seq[Double].sum` negative zero by frame type, NaN-key vector, corpus additions, design/tasks updates).
- `0f7e330d8` squash: its tree equals `80725c3f8` plus `skeptic-final-2.md` (`git diff 80725c3f8 0f7e330d8 --stat` shows that one file only), so nothing changed in the squash.
- `f64907012` archive: renames only, plus `files-modified.md` deleted and `openspec/specs/pipeline-client-evaluator/spec.md` synced. Its requirement count matches the archived delta.

### Phase 1: Spec Review — PASS
- Both final-gate findings are fixed in the evaluator, and oracle vectors cover them.
  - Unicode digits: `cast.json`, `datebucket.json`, `compute.json` and `window.json` carry Unicode-digit vectors.
  - Negative zero: `pipelines.json` has two walk vectors that reach the List frame. One is groupby, then sum of `-0.0`. The other checks that List-ness survives filter, sort and limit, and covers pivot downstream of aggregate.
- design.md (Decision 1 `cast` row, Risks) and tasks.md ("Final-gate round 1 amendments") describe the behaviour as implemented.
- Constraints:
  - C1: the Scala `PipelineStepParitySpec` and the Jest `pipelineStepParity.test.ts` both run the shared corpus.
  - C2: the delta changes only `frontend/src/features/pipelines/evaluator/**` and fixtures, with no UI wiring.
  - C3: no new approximations. The new paths are exact ports.
  - C4: house rules were followed in this review.
  - C5: the oracle still runs through `executeTree`. Spec files are unchanged in this delta.
- No scope creep. `parseChartInstant` and chart code are deliberately untouched, and the chart's ASCII-only gap is recorded as a follow-up.

### Phase 2: Code Review — PASS
Gates, run fresh at `f64907012` in the worktree (logs in `/home/matt/Development/helio/.concertino/scratch/HEL-1581/eval4/`):
- `npm --prefix frontend test -- --testPathPatterns=src/features/pipelines/evaluator` (HELIO_JEST_MAX_WORKERS=2, nice 19): 7 suites, 794 tests, all pass.
- `sbt "testOnly com.helio.domain.engine.PipelineStepParitySpec"` (under the sbtfull flock): 702 tests, 0 failed, `[hel1468-guard] failed=0 aborted=0`.
- `npm run typecheck`: exit 0.
- `npm run lint` (zero-warnings): exit 0.
- `npm run format:check`: all files formatted.

I checked the Scala source to see whether the `listFrame` rule is correct:
- `aggregate`/`groupby`/`pivot` emit `grouped.map(...).toSeq`, which is a List. Every other step builds its output from `rows` with type-preserving operations:
  - `map`, `flatMap`, `collect`, `filter` and `zipWithIndex.map` (window)
  - `sortWith` (sort)
  - `rows.flatMap` (join), `rows.map` (lookup)
  - `backfilledCurrent ++ backfilledOther` (union, left type wins)
- `executeTree` does not convert frames between steps. So it is correct that the frame type passes from the primary parent and a List stays a List.
- `fillnull` mean, `aggregate` sum/avg, `groupby` sum and `pivot` sum/avg are the `.sum` sites (`AggregateStep.scala:152-153`, `GroupByStep.scala:83`, `FillNullStep.scala:188`). All of them take the `listFrame` flag.

I checked `epochOfString` against `TimestampParsing.epochOf`/`parseInstant` (`TimestampParsing.scala:106-170`):
- It reads the string with `s.trim.toLong`, then falls back to a whole `BigDecimal` with |scale| <= 40 and `toLongExact`.
- A string that is not a Long falls through to the non-epoch parsers (`null` in TS goes on to `parseChartInstant`).
- An epoch out of bounds returns `undefined`. That matches Scala, because the non-epoch parsers never accept a bare digit string. The digit mapping works on BMP code units, matching Java's char-based parsing.

Code quality: the changes are small and typed. `digitValue` is now exported for reuse rather than duplicated. There are no new escape hatches, no dead code and no TODOs.

### Phase 3: UI Review — N/A
The delta touches only the evaluator module, test fixtures and openspec. There are no component, route, `ApiRoutes.scala` or `schemas/**` changes. The archive's `openspec/specs/**` sync is a spec text move with no observable UI behaviour. The evaluator is not wired into the UI (C2).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `frontend/src/features/pipelines/evaluator/evaluatePipeline.ts` (284 lines) and `steps/aggregate.ts` (268 lines) are slightly over CONTRIBUTING.md's ~250-line soft budget. Both are well under the ~400 split threshold.
- `steps/fillnull.ts:133-137` repeats `ctx.listFrame === true` three times. Hoisting it into a local, as `aggregate.ts` does, would be tidier.
