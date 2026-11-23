## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `bf0d531d8550b3664cdc0ec4787ce112751ed393` against the live base `e3eda3eda28683075c616a0ebd9935ad4c89b9f9` (`resolve-review-base.sh`, exit 0). One commit on the branch.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/chart-instant-unicode-parity/HEL-1640`.
- **Diff read in full** for `frontend/src/utils/timestampParsing.ts` (new), `chartTimeAxis.ts`, `evaluator/instants.ts`, `testing/timestampStrings.ts`, `chartTimeAxis.test.ts`, `ChartTimestampParsingParitySpec.scala` and `manifest.json`.
  - `parseChartInstant` now returns `Number(parts.seconds) * 1000 + Math.floor(parts.nanos / 1e6)` over `parseInstantParts`. `parseInstantString` is an alias of the same function. `instants.ts` no longer imports `chartTimeAxis`, so there is no circular import.
  - I checked the behavior of the moved grammar against the base one by one:
    - Old `ISO_LOCAL` `[T ]` with the `i` flag is equivalent to new `[Tt ]`, because only the separator is alphabetic.
    - The old millisecond bound `MIN/MAX_EPOCH_MS` is equivalent to the new floorDiv seconds bound plus non-negative nanos.
    - The old `utcMillis` fraction truncation is equivalent to `floor(nanos/1e6)`, because nanos are always non-negative.
  - The only intended changes are Java trim (with a reject when JS-trim whitespace is left over) and the Unicode-digit epoch arm.
  - `javaNumbers.ts` has zero `import` lines (grep), so the utils-to-feature import adds no evaluator code to the main bundle.
  - Every caller of `parseChartInstant` passes the raw value with no pre-trim: `chartTimePlan.ts:68,95` and `chartOverlayOption.ts:55`.
- **AC: red on the current parser, reproduced independently.** I transpiled the base `chartTimeAxis.ts` (`git show e3eda3eda:…`) into lane scratch with tsc. I then ran every case of the HEAD fixture through it (`.concertino/scratch/HEL-1640/skeptic/red.js`). Result: `cases 235 base-parser disagreements 25`.
  - 8 of the 25 are harvested HEL-1581 corpus strings, such as `"٣"`, `"１e３"`, `" １７００００００００ "` and `"１７０００００００１"`.
  - 17 are hand-added HEL-1640 cases: NBSP, U+2003 and U+3000 padding, and U+0001/U+001F padding.
  - This matches the executor's `red-chartTimeAxis.txt` (26 failed: these 25 plus the single-implementation GUARD).
- **AC: agreement on every corpus timestamp vector, anchored on Scala and not tautological.**
  - `sbt -J-Xmx3g "testOnly …ChartTimestampParsingParitySpec …TimestampParsingSpec"` exit 0, `Tests: succeeded 131, failed 0`. This includes `ChartTimestampParsingParitySpec - should agree with every case of the shared chart timestamp fixture` (min count 235, compares `parseInstant(input).map(_.toEpochMilli)` with every `epochMillis`).
  - So every expectation is Scala's value, which satisfies Standing Constraint C1 by outcome, whatever produced the values.
- **Jest:** `chartTimeAxis.test.ts`, `chartTimePlan.test.ts`, `features/panels/ui` and `features/pipelines/evaluator` (maxWorkers 3) exit 0, `Test Suites: 202 passed`, `Tests: 3539 passed`. This covers the coverage GUARD, the single-implementation GUARD, the nanos GUARD and `pipelineStepParity.test.ts`.
- **Lint, typecheck and format:** `npm run typecheck`, plus eslint `--max-warnings=0` and prettier `--check` on the changed TS files and the fixture, all exit 0. The executor's `gates.txt` shows full `lint`, `format:check`, `typecheck` and `build` at exit 0.
- **Mutation evidence:**
  - (c), (d) and (e) show the expected red: the coverage guard names `"2026-02-29"`, the floor GUARD fails, and the Scala spec fails at `Some(1700000000001)`.
  - (a) and (b) are present in the evidence directory. Their effect is also corroborated by my own base-parser run: the base parser has exactly ASCII digits and JS trim, and it is red on 25 cases.
- **Selector scope vs. the AC ("every timestamp vector in the HEL-1581 corpus"):**
  - The selector covers `cast` (timestamp/date), every `datebucket` vector, `compute` with `add_days`/`date_trunc`/`seconds_between`, and `window` day frames. I checked this against the evaluator's only string-instant readers (`cast.ts:41,135`, `dateFunctions.ts:22`, `windowRolling.ts:73` via `parseInstantCell`) and the Scala consumers (`CastStep`, `DateBucketStep`, `ExpressionDateTimeFunctions`).
  - I also checked the excluded `pipelines.json` myself. Only 2 walk vectors have a timestamp-reading step: the datebucket error vectors, on fields `who` and `name`. Their only uncovered strings are the names `ann`/`bob`/`cy`/`di`, which are non-timestamps that the base and new parsers both read as no instant.
- **Spec delta:** `specs/chart-field-data-rendering/spec.md` states the digit and trim rules and adds scenarios for Unicode digits, NBSP and corpus agreement. It is consistent with the code.
- **UI judgment:** this change has no visual, layout or token change. It only changes the pure parser beneath `chartTimePlan`, and the jest suites above exercise that path. No view changed shape, so I did not start servers or take screenshots, and no evidence rests on mtimes.

### Verdict: CONFIRM

### Non-blocking notes

- The exclusion comment in `timestampStrings.ts` says that `pipelines.json` strings are "already represented in the step files". That is not literally true: the two datebucket walk vectors carry `ann`/`bob`/`cy`/`di`, which are not in the fixture. The gap does not matter (they are non-timestamp names in error vectors), but the comment could say so precisely.
- The selector harvests every string column of a selected vector, not just the column that is read as a timestamp. This over-inclusion is harmless: it only adds Scala-pinned cases.
- `evaluation-1.md` is untracked in the worktree. That is for the orchestrator to handle at delivery.
