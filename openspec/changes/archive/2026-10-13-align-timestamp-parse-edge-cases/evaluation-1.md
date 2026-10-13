## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `07b05585101566913ea6bcab40bc2387a5c10505` (HEAD). Diff base resolved live:
`f63ab8365d2b0e6cac36154a83437b6d26b3a209` (`resolve-review-base.sh`, exit 0). Working tree clean.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (every class has a decision and a fixture case; both sides pass every case): D1 records a decision for all
  seven ticket classes (A1-A6, plus executor-found A7 for `07/01/+12026` in Planner Notes). The fixture gains 26
  cases (99 -> 125, counted from the JSON): at least one per class plus the D4 boundary positives.
  `ChartTimestampParsingParitySpec` and `chartTimeAxis.test.ts` both pass (see Phase 2).
- AC2 (same minimum on both sides): both assert `>= 125`.
- AC3: the `MM/dd/yyyy` row moved out of `unchanged` into `widenedByHel1502`. The test name is
  "change ... (was null)".
- AC4: `ComputeStepSpec` has `date_trunc("hour")` tests over both bracketed-id inputs. `DateBucketStepSpec` has the
  two epoch-bound positives.
- Tasks 1.1-3.7 are all ticked and match the diff.
- Constraints:
  - C1: no overlap between `git diff --name-only` and `gh pr diff 996/986 --name-only` (empty `comm -12`).
  - C2: `looksLikeTimestamp` is not touched and there is no migration.
  - C3: checked independently below.
  - C4: the fixture diff has zero `-` lines. Every existing `unchanged` characterisation row is still present.
  - C5: `passesGate` runs before every reader in `parseNonEpochInstant`.
- C3 red-first check, my own probe:
  - Pre-change chart parser on the new cases: accepted the five `0000` forms and both fractions written without
    seconds. The new chart code returns null for all of them.
  - Pre-change backend reader chain (rebuilt in `sbt console`): accepted `.Z`, the tz-less empty fractions, `:60Z`
    (folded to :59), `+12026`, `-0001`, the `0000` ISO/T-local/date/US forms, `2026-02-29 12:00` (clamped to
    02-28), `24:00` (rolled to the next day) and `07/01/+12026`.
  - The new backend rejects all of them.
- The spec delta (`specs/timestamp-value-parsing/spec.md`) matches the implemented grammar. `files-modified.md`
  lists every code, test and fixture file plus the spec delta with complete repo-relative paths.

### Phase 2: Code Review — PASS
Issues: none blocking

Gates I ran myself, in WORKTREE_PATH at 07b055851:
- `npm run lint`: exit 0.
- `npm run format:check`: all files pass.
- `npm test`:
  - root jest: 49 suites / 458 tests, pass.
  - frontend: 584 suites / 7030 tests, pass. The first invocation's `--shard` flag was swallowed by npm, so this
    was the full suite. I re-ran shards 2/3 and 3/3, which also passed.
  - `src/utils/chartTimeAxis`: 132 tests pass.
- `npm --prefix frontend run build`: exit 0.
- Extra pre-commit checks: `typecheck`, `check:scala-quality` (clean, no warnings on changed files),
  `check:spec-structure`, `check:openspec`, `check:schemas` and `check:repo-integrity` all exit 0.
- `sbt testFull`: whole suite in 6 foreground shards (`HELIO_TEST_SHARD_INDEX=0..5`, `HELIO_TEST_SHARD_COUNT=6`,
  `-J-Xmx3g`, `nice -n 19`). Every shard exits 0 with `[hel1468-guard] failed=0 aborted=0`:
  1252 + 1334 + 1589 + 1168 + 1269 + 1222 = 7834 succeeded, 0 failed. 4 were canceled; all are `HELIO_MEASURE`
  report-only perf tests.
  - All six changed specs ran: ChartTimestampParsingParitySpec, TimestampParsingSpec,
    DateBucketCharacterisationSpec, ComputeStepSpec, DateBucketStepSpec and TimestampAgreementSpec.
- Independent differential, beyond the fixture: 45 hand-picked edge inputs through both parsers. The inputs covered:
  - comma fraction; `T24:00:00+01:00`; `23:59:60+00` with a space separator; `12:00Z`; 10-digit fraction
  - lowercase `t`/`z`; `-00:00`; `[UTC+01:00]` id; `.Z[UTC]`; `12026-` unsigned 5-digit year; `+2026-`
  - `2026-06-31` in four shapes; `02/29/2024` vs `02/29/2026`; `.5.5Z`; padded whitespace

  Result: **0 disagreements**, and the boundary positives are unchanged. I did not reproduce the executor's
  60,000-input run (it is uncommitted). Design D4 allows that.

Code checks:
- Imports and qualifiers: there are no inline FQNs; the scala-quality check is clean.
- Comments state the decision inline, not only behind a HEL id.
- Types: no `any`.
- Error handling: `parseInstant` still never throws.
- The gate only reads the time field. I confirmed offsets and bracketed ids are untouched with probe inputs like
  `+05:30[Asia/Kolkata]` and `[UTC+01:00]`.
- Tests are meaningful: the chart-side and backend-side red was shown independently above.
- There is no dead code and no over-engineering.

### Phase 3: UI Review — N/A (verified)
Issues: none

The trigger matches (`frontend/**`), but the only frontend production change is in the pure function
`parseChartInstant` / `utcMillis`:
- `y < 1` guard
- LOCAL-branch fraction-without-seconds guard
- doc comment

Its consumers are `utils/chartTimePlan.ts:68,95` and `features/panels/ui/chartOverlayOption.ts:55`. They are not
modified and already handle a `null` result, because existing rejected shapes return null today. No component,
style, token or render path changed, so nothing new is observable in a browser beyond "more exotic strings read as
not-a-time", which the unit and parity tests cover. I started no dev servers.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:72-73`: the two year predicates are
  identical. Extract them into a small `writtenYearOk(year: String)` helper.
- `backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:88`: `case _                => true` is
  misaligned with the arm above it (cosmetic).
- `frontend/src/utils/chartTimeAxis.ts:127`: the doc-comment line is 159 characters. Rewrap it to the file's
  ~110-column comment width (Prettier does not reflow comments).
- `specs/timestamp-value-parsing/spec.md`: the new paragraph's line 2-3 wraps are uneven. The new scenario's WHEN
  list reads "... and `"2026-07-01 12:00.5"`, ... and ..." (two "and"s); tidy it on archive.
- OWNER REVIEW: A1-A7 are assumed product calls, and the PR must carry them in its OWNER REVIEW section. A7 (signed
  extended year in `MM/dd/yyyy`) was found by the executor and was not in the planner's list.
