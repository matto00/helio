## Context

User regexes reach `java.util.regex` at exactly two sites: `StringOpsStep.extractRegexFn` (compiled once, `matcher(v.toString).find()` per row) and `AssertStep.evalRegex` (compiled once per rule, `find()` per row). Both are synchronous inside `PipelineStep.evaluate`, which the engine (`InProcessPipelineEngine`) calls in a try/catch that turns any NonFatal throwable (and a StackOverflowError, HEL-1660 owner ruling) into a `StepExecutionException` attributed to the step; an `IllegalArgumentException`'s message is surfaced verbatim (`StepExecutionException.from`). Draft preview (HEL-1630), saved preview and real runs all evaluate through this same path. Measurements: `/home/matt/Development/helio/.concertino/runs/HEL-1676/evidence/.concertino/scratch/HEL-1676/regex-measurements.md`.

Owner rulings (escalation HEL-1676-1792518291055-95c8d3, answered in chat, `escalation.answered` recorded): (1) time-box; (2) 2 s fixed, no environment variable.

## Goals / Non-Goals

**Goals:** bounded time for any user regex step; a step error naming the step; identical results for patterns that finish in time; same behaviour on every evaluation path.

**Non-Goals:** RE2/J or any engine change; rejecting patterns at validation; the client-side JS evaluator (`frontend/src/features/pipelines/evaluator/javaRegex.ts`) — no frontend change; making the budget configurable.

## Decisions

**D1. Deadline-checking CharSequence.** New `backend/src/main/scala/com/helio/domain/steps/RegexTimeBox.scala`: `StepBudget` is a fixed 2 s constant; a `Deadline` created from `System.nanoTime()`; `input(s, deadline): CharSequence` wraps the row value. `charAt` checks the clock every 1024 calls (measured: stops at 250 ms on a 250 ms budget; about 5-10% steady-state overhead over 200k rows, 19-20 ms plain vs 21-22 ms boxed). The read counter lives on the step-level deadline, so it counts reads across all rows, not per row; `length` delegates; `subSequence` returns the plain underlying `s.subSequence(a, b)` so `group()` text is unchanged; `toString` returns the underlying string. Backtracking must read characters, so `charAt` is reached inside every backtracking loop. Alternative (a watchdog thread interrupting) rejected: `Matcher` ignores interrupts.

**D2. One budget per step evaluation, shared by all rows.** The deadline is created once when the step starts matching (in `StringOpsStep.apply` for `extractRegex`, once per `evaluateRules` call for assert, shared by all `regex` rules in that assert step) and every row's matcher reads through it. A per-row budget would let N slow rows add up to N x 2 s.

**D3. Expiry error.** On expiry the wrapper throws `RegexTimeBudgetExceeded`, a new `IllegalArgumentException` subclass (NOT `StepConfigError`: the config is valid, the input was too costly). Message, e.g.: `stringops operation 'extractRegex' pattern '<p>' exceeded the 2 s regex time budget for this step`, and `Rule kind 'regex' pattern '<p>' ...` for assert. Because it is an IAE, the engine's existing catch surfaces it verbatim as a `StepExecutionException` with the step's id and kind. `AssertStep.evalRegex` must let it propagate: its `catch` only handles `PatternSyntaxException`; the executor confirms nothing above it (`evaluateRules`, `evaluate`) converts it into a rule result. The thrown exception is created without a stack trace fill (cheap).

**D4. Fixed constant, test seam.** Production uses only `RegexTimeBox.StepBudget` (2 s). A package-private overload taking the budget may exist for unit-testing the wrapper with a short budget, but the AC tests use the production 2 s path end to end.

**D5. Identical results.** The same compiled `Pattern` and the same `find()`/`group(1)` calls run; only the `CharSequence` argument changes. Proven by a corpus test comparing wrapped vs plain results (anchors with trailing `\n`, `.` vs `\r`/`\u0085`, `\s` vs `\u000B`, lookaround, backreference, unicode) plus the existing StringOps/Assert/draft-preview/parity specs staying green unchanged.

## Risks / Trade-offs

- Worst case per walk is 2 s x number of regex steps (draft preview caps at 50 steps, so at most ~100 s held per slot in a pathological draft) — bounded, as the AC requires; a per-walk budget would need a new owner ruling. Listed as a follow-up candidate, not built.
- A legitimately heavy but non-catastrophic regex over very many rows (more than 2 s total) now fails where it used to succeed slowly. Accepted by the owner's fixed 2 s ruling.
- Clock checks every 1024 reads: a pathological pattern doing heavy work between reads is not a real case for `java.util.regex` (each step of backtracking reads input).

## Testing (Iron Laws)

- Red first: an end-to-end stringops test (catastrophic pattern, input long enough that the unfixed code runs for well over 10 s) awaited with a bounded timeout fails on the unfixed code, then passes within 2 s + slack with the step error. Same for assert. A multi-row accumulation test (each row well under 2 s, total well over) is red under a per-row budget mutation.
- Mutation checks, recorded: remove the deadline throw -> red; per-row deadline -> accumulation test red; swallow in assert -> assert test red.
- Slots: a draft-preview route test where the timed-out request completes and then two concurrent requests are both admitted (not 429).
- Run in a bounded JVM, one heavy probe at a time, `nice -n 19`, at most 2 workers.
