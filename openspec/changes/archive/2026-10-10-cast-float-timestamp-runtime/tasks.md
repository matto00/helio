## Standing Constraints

- [C1] Owner rulings are fixed: null-on-unparseable for timestamp/date; reject-at-write for string-body/binary-ref/unknown targets with an explicit tested runtime passthrough for stored ones; keep-original-string for timestamp/date (no ISO rewrite). Do not re-litigate them.
- [C2] Red-first on the WHOLE pre-fix tree, with every new assertion labelled RED or GUARD in the test name or a comment. RED assertions (the bug: float/number/timestamp/date casts, unparseable→null, legacy non-string passthrough, write rejection, analyze legacy projection, cast-mixed warning, filter-over-cast pipeline) MUST be shown failing on unmodified main and recorded as red evidence before the fix. GUARD assertions (already-true behaviour the fix must preserve) are labelled as guards; the load-bearing ones (owner ruling 2 / C5 write-only gating, the D3 predicate union, keep-original-string, explicit legacy passthrough) are proven by the recorded mutation checks M1–M4 in 1.9, never by green alone. Other GUARDs are plain regression guards and are reported as such.
- [C3] New specs that start embedded Postgres MUST use `VerifiedEmbeddedPostgres.start`; confirm `[hel1468-guard]` appears in sbt output; `-J-Xmx3g` on every sbt invocation; shut down every sbt server you start.
- [C5] Unsupported-target rejection is write-path only (`rawConfigProblem`); never in `validateRawConfig`/analyze/`RunConfigGate`; stored legacy casts are never gated.
- [C4] Never touch the two dev test-gate cast steps (d4f4fecd…, c7472203…) beyond reading. Dev DB writes only via throwaway users whose ids are recorded and deleted by exact id.

## 1. Red tests (before any production change)

- [x] 1.1 `CastStepSpec` (new, `backend/src/test/scala/com/helio/domain/steps/`): "1.5" → float/number yields `Double 1.5`; timestamp/date keep `"2026-03-14T09:30:00Z"`, `"2026-03-14"`, `"03/14/2026"`, `"2026-07-01 12:00:00"`, `"1751371200"` (epoch) and `" 2026-03-14 "` unchanged (original string, untrimmed); a `Long` epoch input yields its String form; an integer-looking string such as `"42"` is kept under `timestamp` (epoch, matching datebucket — GUARD/explicit); a `Double` epoch value (`1.7513712E9`, what a JSON epoch number materialises as) yields `null` under `date`/`timestamp` (datebucket already nulls it); `"tomorrow"`/`"abc"` → null under timestamp and date; legacy targets `string-body`/`binary-ref`/`"foo"` pass the ORIGINAL value through (e.g. a `Double` stays a `Double`); existing string/integer/long/double/boolean behaviour unchanged.
- [x] 1.2 Validator: `PipelineStep.rawConfigProblem("cast", …)` rejects `{"casts":{"doc":"binary-ref"}}`, `string-body`, `"foo"` with a message naming the target(s) and the supported list; accepts every `SupportedTargets` entry; and `CastStep.companion.validateRawConfig` / `PipelineAnalyzeService.stepConfigProblem` / `RunConfigGate.stepConfigReasons` do NOT report a legacy target (write-only, D4).
- [x] 1.3 Parity spec (D7) iterating every supported target: analyze projection vs `CastStep.apply` runtime class.
- [x] 1.4 `AnalyzeSchemaWarningsSpec` (the existing "not trust a cast to float" case, ~line 332, is intentionally flipped by D6 — update it, do not delete it silently): cast `{"x":"float","y":"string"}` then compute `abs($y)` warns `numeric-op-on-text-field` for `y`; cast `{"x":"float"}` then `abs($x)` does not warn; cast `{"w":"timestamp"}` then compute does not crash/warn spuriously.
- [x] 1.5 Route/service-level: creating a cast step (step create route AND single-call pipeline create) with `binary-ref` returns 422 and stores nothing; one proposal-apply or patch-set-apply carrying a `string-body` cast is rejected.
- [x] 1.5a Analyze: a stored-style cast with `string-body`/`binary-ref`/`"foo"` projects the input field's type unchanged and has no validationError (D4a); `float`/`number` project `float`; `date`/`timestamp` project `timestamp`.
- [x] 1.5b Cast `date` → `datebucket` chain over `"2026-07-01 12:00:00"` and an epoch value buckets non-null (spec scenario).
- [x] 1.6 Pipeline-level test through a REAL in-process run: a CSV source (string cells, including a timestamp column and a junk value) → cast `{"amount":"float","when":"timestamp"}` → snapshot rows hold `Double` amounts and original timestamp strings / null for junk; a downstream `filter` `amount = 1.5` over a CSV cell `"1.50"` matches that row (FilterStep compares numerically only when the value is already a number — this assertion FAILS on the pre-fix tree, unlike sort/aggregate which already coerce numeric strings).
- [x] 1.7 Stored legacy target (inserted bypassing the write path): a real run passes the value through unchanged — include a NON-String input (e.g. a `Double` under `string-body`) that must stay a `Double` (RED: pre-fix it becomes a String); the scheduler's gate (`RunConfigGate.stepConfigReasons`, as used by `PipelineSchedulerService.gatedSubmit`) and the auto-run gate report no reason for it.
- [x] 1.8 Run the new tests on the pre-fix tree; save the failing output as red evidence, listing which assertions are RED (must fail) vs GUARD (expected to pass).
- [x] 1.9 Recorded mutation checks for the GUARD assertions (after the fix; apply each mutation, run, record the red output, revert):
  - M1: move the unsupported-target check from the write-only hook into `CastStep.companion.validateRawConfig` → the 1.2 "validateRawConfig/stepConfigProblem/RunConfigGate do not report a legacy target" assertions and the 1.7 gate assertions go red.
  - M2: shrink the timestamp-like predicate to `TimestampParsing.looksLikeTimestamp` alone → the 1.1 space-separated/epoch/untrimmed cases and 1.5b go red.
  - M3: trim or ISO-normalise the kept timestamp value → the 1.1 keep-original-string cases go red.
  - M4: re-add a catch-all `case _ => str` in place of the explicit legacy `case _ => v` → the 1.7 non-String passthrough goes red.

## 2. Fix

- [x] 2.1 `CastStep.SupportedTargets` constant; `castValue` explicit case per target (D2, D3) and explicit legacy passthrough `case _ => v` with a comment (D5); update the `CastConfig` doc comment.
- [x] 2.2 Add the write-only `Companion.writeConfigProblem` hook, call it from `PipelineStep.rawConfigProblem`, override it in `CastStep` (D4). Do NOT change `CastStep.companion.validateRawConfig`.
- [x] 2.2a `ColumnSchemaInference.inferCast` legacy passthrough projection (D4a); expose `DateBucketStep`'s parse predicate for D3.
- [x] 2.3 `AnalyzeSchemaWarnings.castRuntimeTargets` → `CastStep.SupportedTargets.toSet`, comment updated (D6).
- [x] 2.4 Re-run all new tests green; run the existing cast/analyze/pipeline suites (`CsvBlankCellsNullStepsSpec`, `InProcessPipelineEngineSpec`, `AnalyzeSchemaWarningsSpec`, `PipelineStepRoutesSpec`, `PipelineStepProtocolSpec`, `PipelineStepSpec`, first-run/persona specs) and the full backend suite via `sbt -J-Xmx3g testFull` before the final commit.

## 3. Evidence

- [x] 3.1 `files-modified.md` handoff listing every file touched.
- [x] 3.2 Red/green evidence summary in the commit or change dir.
