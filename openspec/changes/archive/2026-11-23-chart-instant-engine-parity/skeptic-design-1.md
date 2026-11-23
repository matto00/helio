## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD e3eda3eda28683075c616a0ebd9935ad4c89b9f9 plus the untracked change dir `openspec/changes/chart-instant-engine-parity/` (ticket.md, proposal.md, design.md, tasks.md, specs/chart-field-data-rendering/spec.md). The spawn-cwd guard returned READY.

### What I verified (with evidence)

1. **The JVM reads non-ASCII digits only in the numeric-epoch arm. CONFIRMED** (`backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala`):
   - `epochOf`'s String arm is `Try(s.trim.toLong).orElse(wholeLong(Try(BigDecimal(s.trim))))`. Both `Long.parseLong` and `java.math.BigDecimal(String)` use `Character.digit(char, 10)`, which accepts any BMP Nd digit.
   - `parseNonEpochInstant` is gated by `passesGate`. That gate uses Scala `.r` regexes (`java.util.regex`, where `\d` is ASCII unless UNICODE_CHARACTER_CLASS is set, and it is not) plus `year.forall(c => c >= '0' && c <= '9')`.
   - One gate check, `timeFieldOk`, uses `field(i + 1).isDigit`, which is Unicode-aware. That check can only reject a value, never accept one, so it does not widen the accepted set.
   - Every reader after the gate is a `java.time` formatter with `DecimalStyle.STANDARD`, which parses ASCII digits only, or `OffsetDateTimeRegex`, which uses ASCII `\d`. `offsetOf`'s `toInt` only ever sees text that regex has already matched as ASCII.
   - Both arms use Java `trim`, which strips code units at or below U+0020.
2. **Two divergences exist today. CONFIRMED** (`frontend/src/utils/chartTimeAxis.ts`, `frontend/src/features/pipelines/evaluator/instants.ts:78-92`):
   - `parseChartInstant` uses JS `trim` and ASCII `\d` in `DECIMAL`.
   - `parseInstantString` applies `javaTrim`, rejects a value still padded after it, converts Unicode digits with `asciiDigits`, then falls back to `parseChartInstant`.
   - `instants.ts` imports `parseChartInstant`, so the design's circular-import reason for rejecting alternative (a) is real.
3. **D1 leaf and bundle claims. CONFIRMED.**
   - `javaNumbers.ts` is 170 lines with zero `import` lines. `javaTrim` is at :9 (`<= 0x20`) and `digitValue` at :84 (using `ND = /^\p{Nd}$/u`).
   - `frontend/src/utils/timestampParsing.ts` does not exist yet, so there is no name collision.
   - `utils/chartTimePlan.ts` and `utils/chartClickSelection.ts` already import from `features/`, so a utils-to-feature import has precedent.
4. **The whitespace change fixes a defect; it does not reverse a deliberate restriction. CONFIRMED.**
   - `openspec/specs/chart-field-data-rendering/spec.md:42-43` already says "exactly as the backend's shared timestamp parser reads it ... with no frontend-only extension".
   - The fixture's only whitespace cases are ASCII-space padding (`' 2026-10-01 '`) and whitespace-only input (`'   '`). No case or comment justifies non-ASCII trimming.
   - The HEL-1581 manifest note (`manifest.json:227`) records the digit gap as a known follow-up.
   - No owner escalation is needed.
5. **The delta spec is a faithful MODIFIED copy.** I diffed it against the live requirement. It has only two text insertions (the digit clause and the trim clause) plus three new scenarios, and every other scenario is retained verbatim.
6. **The D3 test plan is anchored on Scala, not tautological. CONFIRMED.**
   - `ChartTimestampParsingParitySpec` iterates every fixture case against `TimestampParsing.parseInstant(...).map(_.toEpochMilli)`, with a minimum of 125 cases.
   - `chartTimeAxis.test.ts:25,33` iterates the same file.
   - New cases with Scala-produced `epochMillis` are therefore proven against the engine independently of the TS implementation. D3.3 is correctly labelled a re-fork GUARD, not parity evidence.
   - `Instant.toEpochMilli` floors (nanos are non-negative), which matches D1's `Math.floor(nanos / 1e6)`.
7. **The D3.1 selector can be implemented. CONFIRMED by prototyping it** against the corpus:
   - Selectors: cast vectors with a `timestamp`/`date` target; every datebucket vector; compute vectors whose expression calls `seconds_between`/`date_trunc`/`add_days`; window vectors with `frameUnit == "days"`.
   - Strings yielded: cast 28, datebucket 40, compute 45, window 24, which is 101 distinct, 92 of them not yet in the fixture.
   - The set already contains Unicode-digit epochs (fullwidth, Devanagari, Arabic-Indic, `１e３`, `１.５`, out-of-range `９…９`) and NBSP/thin-space-padded values, so red-first is guaranteed.
   - Those step kinds match the full list of Scala callers of `parseInstant` and `parseToUtcDate` (CastStep, DateBucketStep, ExpressionDateTimeFunctions, WindowRolling days mode).
   - "Day frame" is unambiguous: the only other `frameUnit` in the corpus, `weeks`, is an error vector ("an unknown frameUnit is a step error").
8. **D1's "no fall-through" for an out-of-range whole number** differs syntactically from the engine (`epochInstant(...).orElse(parseNonEpochInstant(...))`) but gives the same result. No whole-number `BigDecimal` string can match a non-epoch shape, because all of those need `dddd-dd-dd` or `dd/dd/dddd`.

### Verdict: CONFIRM

### Non-blocking notes
- **A third divergence is fixed but not named or tested.** Java `trim` also strips control characters U+0001-U+001F, and JS `trim` does not (apart from \t\n\v\f\r). So `parseChartInstant("\u00012026-10-01")` is `null` today while Scala gives an instant. D1 step 1 (`javaTrim`) fixes this implicitly, and the spec clause "at or below U+0020" is correct. However:
  - Neither the corpus nor the planned hand-added cases cover it.
  - A future "strip only ASCII whitespace" re-fork would survive every planned test.

  Recommend adding one or two hand-added cases (for example U+0001 and U+001F around a date) and one line in the proposal's What Changes saying that control-character-padded values now plot.
- **`pipelines.json` is outside the D3.1 selector.** Its only datebucket steps are error or disabled vectors whose cells are names or absent, so nothing is lost today. Either include multi-step pipelines' cast/datebucket/compute/window steps in the selector or say in the guard why they are excluded.
- **Generating `epochMillis` from the "existing spec's failure output" is impractical.** That spec's `cases.foreach { ... shouldBe ... }` stops at the first mismatch, so the approach needs about 92 iterations. Use the throwaway generator test, put any scratch output under the lane scratch dir, and delete the test before committing.
- **D3.1's "input-row string cells" over-harvests** non-timestamp cells such as unit strings and names. That is harmless (they become `epochMillis: null` cases), but the coverage guard must use the same rule, as the Risks section already requires.
- **D1 step 2 wording.** "No fall-through" is correct in outcome. A one-line comment saying why it is equivalent to the engine's `orElse` would stop a reviewer from "fixing" it.
