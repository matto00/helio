## Context

See proposal.md (Why) and ticket.md (owner rulings 1–3). Inventory of cast target types per surface on origin/main 719710c15:

| Surface | Accepts |
| --- | --- |
| Write validator (`CastStep.companion.validateRawConfig`) | any string (shape check only) |
| Runtime (`CastStep.castValue`) | string, integer, long, double, boolean produce their type; `date` passes the string through; everything else `case _ => str` |
| Analyze (`ColumnSchemaInference.inferCast`) | `DataFieldType.canonicalizeLegacy`: double/number→float, long→integer, date→timestamp; canonical values pass; an unrecognised string makes `SchemaField`'s `require` throw → "cast config error" |
| UI picker (`CastFieldsConfig.CAST_TARGET_TYPES`) | string, integer, long, double, boolean |
| Assistant / MCP | free-form string map; schemas only show an `integer` example |
| First-run / persona templates | double, integer |
| HEL-1403 warning trust (`AnalyzeSchemaWarnings.castRuntimeTargets`) | string, integer, long, double, boolean, date |

Every timestamp producer today emits a `String`: JSON/REST/SQL sources whose column inference types a column `timestamp` (`SchemaInferenceEngine` → `TimestampParsing.looksLikeTimestamp`) keep the original string value (`jsValueToAny` on a `JsString`), and `datebucket` emits `LocalDate.toString`. CSV inference types every column `string` (HEL-893 D1) and never infers timestamps. Two platform timestamp readers exist and disagree: `TimestampParsing.looksLikeTimestamp` (ISO date-time, ISO local date-time, ISO local date, `MM/dd/yyyy`; no trim) and `DateBucketStep.parseToUtcDate` (trims; epoch seconds/millis integers; `Instant`/`OffsetDateTime`/ISO local date-time/space-separated `yyyy-MM-dd HH:mm:ss[.f]`/ISO local date). The write paths (step create/update, single-call create, proposal apply incl. first-run/persona, assistant/MCP patch-sets) all reach `PipelineStep.rawConfigProblem`; analyze (`StepConfigValidation`) and the run gate (`RunConfigGate`, used by auto-run AND the scheduler's `gatedSubmit`) call `validateRawConfig` directly; a manual run checks only `requiredConfigProblems`. JSON numbers materialise as `Double` (`PipelineRowJson.jsValueToAny`), and analyze's `float` is the numeric family for every Int/Long/Double.

## Goals / Non-Goals

Goals: every accepted target produces its projected run-time type; no implicit fallthrough; write-time rejection of unsupported targets; HEL-1403 warning trusts every honest target.

Non-Goals: UI picker changes (it offers a subset; a stored `float`/`timestamp` cast rendering in the picker is a separate follow-up); Spark path (`SparkJobSubmitter.sparkDataType`, unwired, HEL-238); changing integer truncation semantics (`"1.5"`→1); timestamp normalisation (owner ruling 3).

## Decisions

**D1. Supported target set is one constant.** `CastStep.SupportedTargets = Vector("string","integer","long","float","double","number","boolean","date","timestamp")`. Used by the write validator, `castValue`'s match (each listed explicitly), and `AnalyzeSchemaWarnings.castRuntimeTargets` (replaced by a reference to it). Alternative — derive from `DataFieldType.CanonicalWireValues` + synonyms — rejected: that set includes `string-body`/`binary-ref` which owner ruling 2 rejects.

**D2. float/number → `Double`.** Same expression as `double` (`Try(str.toDouble)`, null on failure). Analyze projects `float` for all three; `Double` is in analyze's numeric family and is what JSON numbers already materialise as, so a `float` column from a cast is indistinguishable at run time from one from a JSON source. Alternative `java.lang.Float` rejected: 32-bit precision loss and a second numeric class downstream ops would have to handle.

**D3. timestamp/date → original string if the value is timestamp-like, else `null`.** "Timestamp-like" = accepted by EITHER platform timestamp reader: `TimestampParsing.looksLikeTimestamp(str)` OR `DateBucketStep`'s own parse (`parseToUtcDate`, exposed as a non-private predicate, e.g. `DateBucketStep.parsesAsDate(value)`; it trims and accepts epoch integers and space-separated date-times). The union guarantees (a) any value a downstream `datebucket` buckets today still reaches it unchanged after a `date`/`timestamp` cast — so no existing cast→datebucket chain regresses to null — and (b) any value a JSON/SQL source would have typed `timestamp` is kept. The original string (untrimmed) is kept per owner ruling 3. A non-String input (e.g. a `Long` epoch) is emitted as its string form (`v.toString`), so every non-null timestamp/date cast output is a `String` (D7). Epoch integers are therefore kept (datebucket reads them). Only values neither reader accepts become `null` (owner ruling 1). Alternative — `looksLikeTimestamp` alone — rejected (skeptic design-1 CR2): it nulls space-separated and epoch values datebucket handles today.

**D4. Unsupported targets are rejected on the WRITE path only.** A new `Companion` hook `writeConfigProblem(raw: String): Option[String] = None` (write-only, documented as such), called by `PipelineStep.rawConfigProblem` after `validateRawConfig` (`validateRawConfig(raw).orElse(writeConfigProblem(raw))`). `CastStep.companion` overrides it to report `cast: unsupported target type '<t>' for field '<f>'. Supported: <list>` (all offenders, sorted). Every config-carrying write path (step create/update, single-call create, proposal apply, patch-set apply) reaches `rawConfigProblem` (verified by skeptic design-1 and evaluation-1), so all of them reject with their existing 422 `UnprocessableEntity` for this category (shipped spec `pipeline-step-config-rejection`); no status code changes. `validateRawConfig` is NOT changed, so analyze (`StepConfigValidation`) and `RunConfigGate` (auto-run and scheduler) never see this check: a stored legacy-target pipeline keeps being scheduled/auto-run exactly as today, and runs with the passthrough (owner ruling 2). Alternative — put the check in shared `validateRawConfig` — rejected (skeptic design-1 CR1): it would make every scheduled fire of such a pipeline a recorded not-attempted run and skip auto-runs, which the owner did not rule, and would violate `RunConfigGate`'s "gate only a run certain to fail" rule.

**D4a. Analyze projects a legacy target as passthrough.** `ColumnSchemaInference.inferCast`: for a target in `SupportedTargets`, project `canonicalizeLegacy(target)` as today; for any other target, keep the input field's type unchanged (it used to project `string-body`/`binary-ref` verbatim, or throw on an unrecognised string → "cast config error"). This matches D5's runtime passthrough exactly, so analyze and run agree for every target.

**D5. Explicit legacy passthrough.** `castValue`'s final case is `case _ => v` (the ORIGINAL value, not `v.toString`), commented as the explicit owner-ruled legacy passthrough, with a unit test per legacy kind (string-body, binary-ref, unrecognised). Reachable only for stored configs, since D4 rejects at write. This changes stored legacy-target output from `v.toString` to `v` (e.g. a Double stays a Double); the PR body states it.

**D6. Warning trust (HEL-1455 item 3).** `castTrusted` uses `SupportedTargets`. After D2/D3 every supported target produces its projected run-time class (timestamp's family is `None`, so it never warns either way). Effect: a cast mixing `float` with `string` now trusts the step and `abs($stringField)` downstream warns (it did not before because `float` made the step untrusted); cast-to-float then numeric op does not warn.

**D7. Parity proof.** A table-driven spec runs, for every supported target and a set of representative inputs, both `ColumnSchemaInference.inferCast` (via the analyze entry point) and `CastStep.apply`, and asserts each non-null output value's runtime class is in the class family of the projected type (`integer`→Int/Long, `float`→Double, `string`→String, `boolean`→Boolean, `timestamp`→String satisfying the D3 timestamp-like predicate). Iterates `SupportedTargets` itself, so a future target added without a runtime case fails the spec.

## Risks / Trade-offs

- [Existing `date`/`timestamp` casts over junk values now produce `null`] → owner-ruled; PR body states it; dev count 1+1 (test residue); prod count query provided.
- [Stored legacy-target casts] → never gated (D4); analyze now projects passthrough (D4a); dev count 0, prod count query includes `string-body`/`binary-ref`/other so the owner sees exposure.
- [Values neither timestamp reader accepts now null under date/timestamp] → owner ruling 1; values datebucket reads are kept (D3).

## Migration Plan

No migration. Rollback = revert the commit.

## Notes

- A JSON epoch NUMBER materialises as a `Double` (`1.7513712E9`), which neither timestamp reader accepts, so a `date`/`timestamp` cast yields `null` for it; `datebucket` already nulls such a value today, so nothing that works now breaks. Stated in the PR body and pinned by a test.
- Any integer string (e.g. `"42"`) is kept under `timestamp` as an epoch — the same thing `datebucket` does.
- `PipelineService.duplicateStep` copies a stored step without calling `rawConfigProblem` (true for every step kind, not new), so duplicating a stored legacy-target cast writes another legacy row; out of scope, follow-up.
- Editing any field of a stored legacy-target cast step returns 422, since the whole `casts` map is re-validated on PATCH (follows from owner ruling 2).
