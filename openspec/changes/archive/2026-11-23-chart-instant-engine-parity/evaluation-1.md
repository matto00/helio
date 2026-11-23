## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: bf0d531d8550b3664cdc0ec4787ce112751ed393. Review base, resolved live: e3eda3eda28683075c616a0ebd9935ad4c89b9f9.

### Phase 1: Spec Review — PASS
Issues: none.

- AC ("the chart parser and the evaluator agree on every timestamp vector in the HEL-1581 corpus, with a test that fails on the current parser first"): met. `parseChartInstant` and `parseInstantString` are now both the single `parseInstantParts` (`frontend/src/utils/timestampParsing.ts`). The fixture holds every corpus timestamp string, and a coverage GUARD (`chartTimeAxis.test.ts`, using `corpusTimestampStrings()`) keeps it complete. Agreement with the engine, not just between the two TS callers, is anchored on Scala through `ChartTimestampParsingParitySpec`.
- Tasks 1.1–3.3 are all checked, and each matches the diff. `instants.ts` no longer imports `chartTimeAxis`. `grep` finds one epoch/ISO grammar in `frontend/src`. The manifest note and the `instants.ts` header no longer describe the gap as open.
- The spec delta (`specs/chart-field-data-rendering/spec.md`) states the Unicode-digit and Java-trim rules and adds matching scenarios.
- No scope creep. There is no backend code change; the only backend edit is the spec min-count and its doc comment. No schema or API change.
- CONSTRAINTS C1 (Scala-sourced epochMillis): honored, see below.

**C1, verified independently.** I ran `sbt -J-Xmx3g "testOnly com.helio.domain.engine.ChartTimestampParsingParitySpec com.helio.domain.engine.PipelineStepParitySpec"` against the lane DB: exit 0, 710 succeeded, 0 failed. "TimestampParsing.parseInstant should agree with every case of the shared chart timestamp fixture" passed over all 235 cases. So every `epochMillis` in the fixture, including the 110 new ones, equals what the Scala parser returns. Whatever process produced them, they are Scala-true. The fixture has no duplicate inputs. No generator residue is in the tree.

**Red-first, verified independently.** The hook refused the red commit, as `red-commit-hook-refusal.txt` shows: "husky - pre-commit script failed", with 26 failures in `chartTimeAxis.test.ts`. I did not take the recorded red run on trust. I built a throwaway detached worktree at bf0d531d8, restored the pre-change `chartTimeAxis.ts` and `instants.ts` from e3eda3eda, deleted `timestampParsing.ts`, and ran the full `chartTimeAxis.test.ts` and `pipelineStepParity.test.ts`. Result: 26 failed, 878 passed. That is the same failure set, name for name (`diff` empty), as the executor's `red-chartTimeAxis.txt`. The failures are what the old parser should produce:
- Unicode-digit epochs read as `null`.
- NBSP/U+2003/U+3000-padded values read as instants.
- U+0001/U+001F-padded values read as `null`.
- The single-implementation GUARD fails.

The throwaway worktree was removed afterwards; `git worktree list` no longer shows it. Mutation e (one wrong epochMillis turns the Scala spec red) is shown in `mutation-e-wrong-epochMillis.txt`. Mutations a–d show red runs in the evidence files.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in WORKTREE_PATH, all exit 0:
- `npm run lint`, `npm run format:check` and `npm run typecheck` (in `frontend/`).
- Full frontend jest with 3 workers, under nice: 922/922 suites, 10745/10745 tests.
- `npm run build` (in `frontend/`).
- The backend specs listed above.

Root `npm test`/`npm run lint` were not run: the worktree has no root `node_modules`, and no root-level file changed.

Code:
- The grammar moved verbatim from `chartTimeAxis.ts` into `timestampParsing.ts`. Fraction handling changed from milliseconds to full nanos. Two small edits are behavior-neutral:
  - `ISO_LOCAL`'s `[T ]` with the `i` flag became `[Tt ]`. The only letter in the pattern is the separator, so the two match the same strings.
  - Epoch bounds moved from milliseconds to seconds through `floorDiv`. The boundaries are the same: -62135596800000 ms is -62135596800 s, and 253402300799999 ms is 253402300799 s.
- `parseChartInstant` keeps its signature and its floor-to-millisecond rule. Negative sub-second values check out (-1500 → seconds -2, nanos 5e8 → -1500).
- `javaNumbers.ts` has no imports, so the utils→feature import pulls nothing more into the main bundle. The build succeeds.
- Tests are meaningful: the coverage, single-implementation and nanos GUARDs are labelled as such, and the mutations show each guard can fail.
- No dead code: lint is clean, and the removed `FRACTION_AFTER_SECONDS`/`asciiDigits` copies are gone from `instants.ts`.

### Phase 3: UI Review — PASS
Issues: none.

Scope: no visible UI surface beyond which x values plot. I started servers only with `start-servers.sh` (lane DB, empty `ANTHROPIC_API_KEY`); `assert-phase.sh servers` printed PASS. In the shared browser, I confirmed the page was on port 7072 and that no dialog was open. I then imported the served `/src/utils/chartTimeAxis.ts` from the Vite dev server and called `parseChartInstant`:

| Input | Result |
|---|---|
| `١٧٠٠٠٠٠٠٠٠` | 1700000000000 |
| `１７００００００００` | 1700000000000 |
| ` 2026-10-01` | null |
| `\u00012026-10-01\u0001` | 1790812800000 |
| `2026-10-01T12:00:00.123456789Z` | 1790856000123 (floored) |
| `nope` | null |

There were no console errors. The browser was returned to `about:blank`, and the servers were stopped with `stop-servers.sh` (`STOPPED ports=7072,9979`). The chart-plan and footnote paths are covered by the passing `chartTimePlan.test.ts` and the chart overlay tests.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `shared-test-fixtures/chart-timestamp-parsing.json`: the case `"٩٩٩٩٩٩٩٩٩٩٩٩٩٩"` (14 digits) has the note "HEL-1640: out-of-range Unicode-digit epoch", but Scala reads it as 99999999999999. That is a millisecond epoch in year ~5138, so it is in range. The note is wrong; something like "Unicode-digit millisecond epoch (14 digits)" would fit. The real out-of-range case is the 16-digit entry.
- Design D3.1 asked each harvested case to carry "a `note` naming its corpus file". The 89 harvested cases all share one generic note: "cast, datebucket, compute or window". Naming the actual file would make a failing case easier to trace back to its vector.
