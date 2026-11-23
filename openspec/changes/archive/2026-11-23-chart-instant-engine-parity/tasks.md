## Standing Constraints

- [C1] Fixture `epochMillis` values are produced by running the Scala parser (a throwaway generator test, output under the lane scratch dir, deleted before commit), never derived from the TypeScript implementation.

## 1. Red first

- [x] 1.1 Write a selector (test helper under `frontend/src/features/pipelines/evaluator/testing/` or alongside the chart test) that yields every distinct string cell the HEL-1581 corpus feeds to a timestamp reader (design D3.1 (i)-(iv); `pipelines.json` is excluded with a stated reason in the helper, or included — say which); verify by listing its output count in the scratch dir.
- [x] 1.2 Append those strings plus the hand-added Unicode-digit, non-ASCII-whitespace and control-character-padding (U+0001, U+001F around a date; Java trim strips them, JS trim does not) cases to `shared-test-fixtures/chart-timestamp-parsing.json`, with `epochMillis` produced by the Scala parser; verify with `sbt "testOnly com.helio.domain.engine.ChartTimestampParsingParitySpec"` green (Scala agrees with every expectation) and the min-count raised in both halves.
- [x] 1.3 Add the coverage guard (D3.2) and single-implementation guard (D3.3) tests; run `chartTimeAxis.test.ts` (full file) on the unchanged parser and confirm it is RED on the new Unicode-digit and whitespace cases; commit the red run (or save it under `.concertino/runs/HEL-1640/evidence/` and say so if the hook refuses).

## 2. Single reader

- [x] 2.1 Create `frontend/src/utils/timestampParsing.ts` with `parseInstantParts` per design D1 (Java trim, Unicode-digit epoch arm, ASCII non-epoch shapes with nanos); verify with the full `chartTimeAxis.test.ts`, `pipelineStepParity.test.ts` and evaluator test files green.
- [x] 2.2 Make `parseChartInstant` a thin millisecond wrapper and `instants.ts` re-export the shared reader (no import of `chartTimeAxis` from `instants.ts`); verify `grep` shows one epoch/ISO grammar implementation in `frontend/src` and the chart/evaluator test files are green.
- [x] 2.3 Update the `manifest.json` note and the `instants.ts` header comment (D4); verify by grep that no comment still calls the chart gap open.

## 3. Verification

- [x] 3.1 Mutations, each run on the full affected spec file(s) and recorded (red) then reverted: (a) ASCII-only digits in the shared epoch arm; (b) JS `trim` instead of Java trim; (c) delete one harvested corpus string from the fixture (coverage guard red); (d) `Math.round` instead of floor in `parseChartInstant`; (e) one wrong `epochMillis` in a new fixture case (backend `ChartTimestampParsingParitySpec` red).
- [x] 3.2 Run `npm run lint`, `npm run typecheck`, and the chart test files (`chartTimeAxis.test.ts`, `chartTimePlan.test.ts`, chart overlay tests) plus the evaluator test directory; run backend `ChartTimestampParsingParitySpec` and `PipelineStepParitySpec` (sbt -J-Xmx3g, `testOnly`).
- [x] 3.3 Confirm the main bundle gains no echarts or evaluator-wide import (inspect `timestampParsing.ts` import graph; `npm run build` succeeds).
