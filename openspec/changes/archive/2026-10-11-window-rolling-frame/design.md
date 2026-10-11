## Context

`WindowStep.apply` (`backend/src/main/scala/com/helio/domain/steps/WindowStep.scala`) partitions rows, sorts each
partition with an index-tie-broken comparator, computes one value per row, and re-emits rows in input order. The
step has three validation layers, all fed by one rule (HEL-1416):
- write: `companion.validateRawConfig` calls `enumProblems`, and drafts stay saveable;
- analyze: `StepConfigValidation.validateWindow`;
- run: `apply`, in the HEL-1422 error order.
Analyze typing lives in `ReshapeSchemaInference.inferWindow`. Field references for the HEL-1414 schema warnings live
in `AnalyzeSchemaWarnings.referencedFields`, which uses `WindowStep.FieldRequired`. The config is JSON in
`pipeline_steps.config`, and the `window` op is already allowed by V66. Execution is in-process only:
`SparkJobSubmitter` has no window implementation. The owner settled Q1-Q5 on 2026-10-11 (see `tasks.md`'s Standing
Constraints).

## Goals / Non-Goals

**Goals:**
- Trailing rolling avg/sum/min/max/count over N rows or N calendar days, per partition.
- Analyze types that match apply.
- Write/analyze/run validation that follows HEL-1416.
- Editor support.
- MCP and refinement docs that list the new functions.

**Non-Goals:** centred frames (follow-up ticket); `minPeriods`; gap imputation; Spark; changing `running_sum`.

## Decisions

1. **Config shape: five new function names plus two optional keys.**
   - The functions are `rolling_avg|rolling_sum|rolling_min|rolling_max|rolling_count`. The keys are
     `frameSize: Option[Int]` and `frameUnit: Option[String]`, and `WindowConfig` grows from `jsonFormat6` to
     `jsonFormat8`.
   - Alternatives considered:
     - a nested `frame: {size, unit}` object with `function = "avg"`. Rejected: `avg` next to `running_sum` reads
       as a whole-partition aggregate, and a nested object needs its own codec and draft rules in three places;
     - reusing `offset` as the frame size. Rejected: it overloads a lag/lead-only key.
   - spray-json omits `None`, so an existing row re-encodes byte-identically. A spec scenario pins this.
   - `decode` gains `StepCodecUtil.intOpt(obj, "frameSize")` and `strOpt(obj, "frameUnit")`.
2. **`FieldRequired` gains the five rolling functions.** This one change makes write drafts, the analyze
   missing-field report, `apply`'s missing-field error, and `referencedFields` (HEL-1414) all cover them. A new
   `RollingFunctions: Set[String]` holds the function-specific branches.
3. **Validation layering.**
   - `enumProblems` (write, analyze, run) gains three checks, for rolling functions only:
     - an explicit `frameSize` outside 1..1000;
     - an explicit `frameUnit` not in `{rows, days}`;
     - `days` with a non-empty `orderBy` that is not exactly one ascending key (direction compared
       case-insensitively, as `rowOrdering` does).
   - Missing `frameSize` and empty `orderBy` are draft problems. They are reported by `validateWindow` and `apply`
     (in the spec's order: function, field, frameSize, orderBy, then `enumProblems`), never by
     `validateRawConfig`.
   - 1000 bounds per-row work in rows mode and keeps the cap one named constant (`MaxFrameSize`).
4. **Algorithm.**
   - Each partition's sorted view is turned into contiguous frame ranges `[start, end]`:
     - rows mode: `start = max(0, p - N + 1)`, `end = p`;
     - days mode: the view is ordered by parsed `LocalDate` (index tie-break). The generic string comparator would
       misorder mixed timestamp formats. Rows with an unparseable or null key are split out first: they get `null`
       and join no frame. A two-pointer pass gives every row with date `d` the range from the first row dated
       `>= d-(N-1)` to the last row dated `d`. Peers therefore share one range, and so one value.
   - Because ranges only move forward, sum and count use a sliding accumulator, with sum as an exact `BigDecimal`
     so add/subtract never drifts. min and max use monotonic deques. Each partition is O(n) after the sort.
   - Values come from `PipelineRowJson.toDouble`, keeping only finite results. NaN and Infinity are skipped, both
     because SQL-like semantics want that and because spray-json cannot encode a non-finite `Double`.
   - Outputs: count is an `Int`; the others are a `Double`, or `null` when nothing contributed.
5. **Date parsing is reused, not copied.** `DateBucketStep.parseToUtcDate` goes from `private` to `private[steps]`
   (renamed nowhere), so "is a date" matches exactly what `datebucket` accepts, including epoch seconds/millis.
6. **Analyze.** `inferWindow` maps `rolling_count` to `integer` and the other four to `float`, the same canonical
   `DataFieldType` `running_sum` uses. An apply/analyze parity test runs every rolling function through both and
   asserts `Int` for `integer` and `Double` for `float` on non-null outputs.
7. **Frontend.**
   - `WINDOW_FUNCTIONS` grows by five. `FIELD_REQUIRED_FUNCTIONS` includes them.
   - New `ROLLING_FUNCTIONS` drives a frame-size `TextField type=number` and a `Select` (`rows`/`days`), following
     the offset input's existing pattern and the DESIGN.md form tokens.
   - `WindowConfigValue` gains `frameSize`/`frameUnit`. `windowConfigOf` normalizes them, and the field handlers
     carry them through.
   - When the function changes to a rolling one with no `frameSize`, the editor fills 7/`rows`.
   - The saved payload omits `frameSize`/`frameUnit` for non-rolling functions, so non-rolling configs keep their
     current wire shape.
   - TS types: `WindowFunction` union plus `frameSize?: number | null; frameUnit?: "rows" | "days" | null`.
7a. **Revisions after design gate round 1.**
   - The persisted payload is built by `stepCardFieldHandlers.onWindowChange`, not by `WindowConfig`. Its
     hard-coded `usesField` list (`running_sum|lag|lead`) must include the rolling functions (shared constant, not a
     second list), and it adds `frameSize`/`frameUnit` for rolling functions only.
   - `frameSize` display: `WindowConfigValue.frameSize: number | null`. Absent shows empty (unlike `offset`'s
     absent-as-1). The 7/`rows` default applies only when the function changes to a rolling one.
   - Raw-number check: `intOpt` turns `7.5`/`5000000000` into `None`, which the write path would store as a draft.
     `enumProblems` therefore reads the RAW JSON `frameSize` (as `LimitStep.requiredConfigProblems` does for
     `count`) and rejects a present, non-null value that is not an integer in 1..1000 (`"frameSize": null` is absent,
     as `StepCodecUtil.present` treats it). The raw check lives in `validateRawConfig` (write; analyze sees it too).
     The typed 1..1000 range check stays in `enumProblems` (write/analyze/run). `apply` keeps its typed signature: the
     run path re-encodes the typed config (`InProcessPipelineEngine.scala:508`), and writes store the typed encoding,
     so no stored row can hold an unrepresentable value.
   - `onWindowChange` builds the body with conditional spreads, so absent keys are absent (not `undefined`-valued).
   - The frame-size handler allows clearing (empty -> null) and only persists integers in 1..1000.
   - The frame-size input carries `min={1}` and `max={1000}`.
8. **Seam.**
   - The fixture is `shared-test-fixtures/window-rolling-seam.json`, following the HEL-1260 `layout-create-seam.json`
     precedent. It holds the editor-produced config, a gappy dated input, and the expected outputs.
   - Client half: following `JoinConfig.seam.test.tsx` (HEL-958), drive `StepOpEditor` plus `useStepCardState` with a
     mocked `updatePipelineStep`, and assert the PATCH body's config equals the fixture config with an EXACT key set.
   - Server half: a route spec creates the step through the real step-create route, analyzes it, runs the pipeline
     end to end on an embedded Postgres (`VerifiedEmbeddedPostgres.start`), and asserts the fixture outputs.
9. **Docs.**
   - `helio-mcp/src/tools/write.ts`: the window description string.
   - `RefinementEditShape.scala:176-179`: the function list in one doc string. The owner approved this single edit
     despite HEL-1482's lane being in patch-set code. Re-sync with origin/main before the PR.
   - The living spec gets the delta.
   - No JSON schema in `schemas/` enumerates window functions (checked).

## Risks / Trade-offs

- [Days mode with a numeric `orderBy` key, e.g. `20260101`, parses as epoch seconds] → this is the same behaviour
  as `datebucket`; it is documented in the MCP text, not special-cased.
- [`rolling_sum` returns `null` over an empty frame while `running_sum` returns `0`] → this follows the owner's Q4
  ruling. Both behaviours are spelled out in the spec and the MCP text.
- [HEL-1482 touches `RefinementEditShape.scala`] → a one-hunk text edit. Rebase onto origin/main before the PR.
- [The `PipelineStepConfigCodec`/`PipelineStepProtocol` wire format is derived from `WindowConfig.format`] → the
  `jsonFormat8` change covers both. Codec round-trip tests are extended rather than adding new formats.

## Planner Notes

Self-approved:
- the `rolling_*` naming over a nested frame object (Decision 1);
- `MaxFrameSize = 1000`, from the owner's Q5 answer;
- the editor default of 7/`rows`, matching the ticket's 7-row example;
- skipping non-finite values;
- widening `parseToUtcDate` visibility to `private[steps]`;
- no migration.

No new external dependency, no breaking API change.
