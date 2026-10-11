## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `feature/compute-datetime-arithmetic/HEL-1314` at `5f0b679ef19bd40967dcfe4b284d64da49408b6d`. There are no code changes yet, and the change dir is untracked. The cwd guard printed `READY`. I re-read ticket.md (owner rulings Q1-Q6), proposal.md, design.md, tasks.md, all three spec deltas and skeptic-design-1.md. I checked them against the source tree, not against the orchestrator's summary.

### What I verified (with evidence)

**Structure**
- `openspec validate compute-datetime-functions --strict` printed "Change 'compute-datetime-functions' is valid".
- `check-spec-structure.mjs` printed "passed (469 canonical specs, 0 issues)".
- `check-openspec-hygiene.mjs` printed "openspec/ is clean".

**CR1 (warnings delta): addressed**
- `specs/pipeline-analyze-schema-warnings/spec.md` now carries a MODIFIED "Numeric use of a text field warns" requirement. It adds:
  - the `timestamp` type;
  - the `add_days` day-count context;
  - the exclusion of timestamp arguments from numeric contexts;
  - a remedy that depends on the field type: for `timestamp` it suggests `seconds_between`/`add_days` and "SHALL NOT suggest a cast step".
- I diffed the six base scenarios against `openspec/specs/pipeline-analyze-schema-warnings/spec.md:124-147` and they are byte-identical.
- The three new scenarios are reachable on the real trust rule:
  - `cast` to `timestamp` is trusted, because `castTrusted` uses `CastStep.SupportedTargets`, which contains `timestamp` (`AnalyzeSchemaWarnings.scala:69,259-260`; `CastStep.scala:72-73`).
  - So the "subtracting timestamps" scenario after a cast will actually fire. A CSV root is trusted (`inputFlags`, `:90`).
- The wording change has a named implementation site in D4 (`computeNumericWarnings`, `:236-246`, where the cast text is hard-coded today). Task 3.1 tests it.

**CR2 (bare-identifier unit): addressed**
- D3 now specifies the mechanism: in `StrictParser.parseFactor`, after `FnName("date_trunc")` and `(`, a `Token.Ident` first-argument token returns the units message.
- I verified this is implementable as stated:
  - Today `Token.Ident` is reached only through `parseArgs` → `parseFactor` → `Left(DollarPrefixRequiredMsg)` (`ExpressionParser.scala:115,121`).
  - The fallbacks key on that exact message only: `isDollarPrefixError` (`:181`), used by `parseProblem` (`ExpressionEvaluator.scala:102`), `validateTolerant` (`:151`) and `compile` (`:209`).
  - So the units message bypasses the legacy retry.
- The tokenizer emits `Ident` for `day` followed by `,`, and `FnName` only when `(` follows.
- The spec scenario now lists `date_trunc(day, $ts)` alongside the quoted-unknown and `$`-ref units, on validate and the write-path parseability check. Task 2.1 requires the test on BOTH `validate` and `parseProblem`.

**CR3 (D1 delta and non-epoch path): addressed**
- D1 now lists the delta classes:
  - whole-number Double/BigDecimal JSON epochs;
  - decimal-point or exponent whole-number strings (`"1771286400.0"`, `"1.7712864E9"`, `"1e3"`).
- Plain integer strings are stated to be unchanged.
- I re-traced the current `parseToUtcDate` (`DateBucketStep.scala:162-174`). `Try(str.toLong)` already handles integer strings, a leading `+`, and Long/Int values (their `toString`). Numeric strings never match a dash-bearing non-epoch branch. That makes the enumerated list the complete set of null→parsed changes. Out-of-range and non-finite values stay null.
- Task 1.1 pins the delta rows at their old `null` value first. The timestamp-value-parsing spec has a new decimal/exponent scenario, which includes the fractional `"1771286400.5"` → null.
- The `parseNonEpochInstant` entry point is named, and `parseInstant = epoch.orElse(parseNonEpochInstant)`. `parseNonEpochDate` is re-pointed to it, which keeps `ColumnClassifier.scala:56` epoch-free.
- Task 1.3 adds the ColumnClassifier regression test. I confirmed `"1771286400"` and `"1.7712864E9"` fail every non-epoch branch: Instant, OffsetDateTime, ISO_LOCAL_DATE_TIME, the space formatter, and `LocalDate.parse`.

**CR4 (fixture location): addressed**
- The path `shared-test-fixtures/compute-expression-functions.json` is pinned in D5, C5 and tasks 5.2-5.4.
- The convention exists as described:
  - `shared-test-fixtures/` holds `join-step-config.json` and others;
  - the frontend reads it via repo-root resolution (`JoinConfig.seam.test.tsx:31-38`);
  - the backend reads it via `Paths.get("../shared-test-fixtures/…")` (`OutputSummaryReducerSeamSpec.scala:15`);
  - helio-mcp reads it via `formProposalSeam.test.ts`.
- `helio-mcp/src/tools/pipelineProposal.ts` (cited in D5) exists.

**CR5 (add_days overflow): addressed**
- D2 now specifies the arithmetic:
  - `BigDecimal(n) * 86400` seconds, rounded HALF_UP to 9 decimal places;
  - split into Long seconds plus a nano remainder;
  - applied as `plusSeconds(secs).plusNanos(nanos)`;
  - non-finite `n`, Long overflow, `ArithmeticException` or `DateTimeException` give `VNull`.
- Both requested scenarios are in the spec and in task 2.1.

**Arithmetic re-check (python3 `datetime`)**
- `date(2026,7,1) + timedelta(days=1000000)` = `4764-05-28`, which matches the spec.
- 1e15 × 86400 = 8.64e19 > 2^63−1 = 9.22e18, so this overflows a Long and gives null, as the spec says. `float('1000000000000000')` is exact.
- Epochs:
  - `1782907200` → 2026-07-01T12:00Z;
  - `1771286400` → 2026-02-17T00:00Z;
  - `1782907200000` (> 9999999999) is milliseconds → 2026-07-01.
- `date_trunc`:
  - 2026-03-19 has weekday 3 (Thursday), so the week truncation gives Monday 2026-03-16;
  - `12:34:56.789+01:00` is 11:34:56.789Z, which truncates to the hour as 11:00Z;
  - 2024-02-29 truncates to the month as 2024-02-01.
- `seconds_between`:
  - 2024-03-01 − 2024-02-28 = 2 days = 172800;
  - `12:00+02:00` vs a tz-less `10:00` read as UTC gives 0;
  - `00:00:00` − `00:00:01.5` = −1.5.
- `add_days(…, 0.5)` gives 12:00Z.
- `$ts + 1` → `"2026-07-011"` holds, because `numStr` prints whole doubles as Longs (`ExpressionInterpreter.scala:72,176-177`).

**No regressions in prior-confirmed parts**
- The six base scenarios of the MODIFIED "Output type can be inferred" requirement still match the canonical spec. I compared each scenario's 4-line window by md5.
- The `TextTypes`/`check` logic (`ExpressionNumericContexts.scala:13,33-38`) behaves as D4 says: a `timestamp` operand of `-` infers non-numeric and is collected by `textRefs` once the set gains `timestamp`.

### Verdict: CONFIRM

### Non-blocking notes

- **Nested bare identifiers in the unit.** D3's `Token.Ident` look-ahead covers only a bare identifier as the first token of the unit argument. Forms like `date_trunc(-day, $ts)` or `date_trunc(lower(day), $ts)` still fail inside `parseArgs` with `DollarPrefixRequiredMsg`, then go to the legacy retry and its "Unexpected token" message. Read literally, that misses the spec's "a unit that is not a string literal … SHALL be a parse error naming the supported units".
  - A slightly more general mechanism closes this at no extra cost: parse `date_trunc`'s first argument and map a `Left(DollarPrefixRequiredMsg)` from it to the units message.
  - These forms are contrived, so this is not blocking.
- **Characterisation-table wording.** D6 still describes the table as covering "all non-Double inputs", while D1 and task 1.1 include the JSON-number Double delta rows. Task 1.1 is the operative instruction; align the D6 wording when convenient.
- **Round-1 notes still open.** These remain unaddressed in the artifacts and are still worth doing during execution:
  - Postgres `timestamptz` text form (`"… 12:00:00+00"`) falls outside the accepted shapes; this is a follow-up candidate.
  - Cast of a JSON-number epoch emits a scientific-notation string.
