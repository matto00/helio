## Context

`backend/src/main/scala/com/helio/domain/steps/` holds one file per pipeline-step "kind"
(`CastStep.scala`, `ComputeStep.scala`, `SplitTextStep.scala`, ...), each exporting a typed
`*Config`, a `*Step` case class implementing `evaluate`, and a `PipelineStep.Companion` registered
in `PipelineStep.Registry` (`PipelineStep.scala`). That one registry line is the single source of
truth `PipelineStepKind.All` derives from — no other file enumerates kinds by hand except the
wire-protocol union (`PipelineStepProtocol.scala`), the config codec facade
(`PipelineStepConfigCodec.scala`), and the analyze-inference dispatch
(`PipelineAnalyzeService.scala`), all of which are covered by the kind-parity test in
`PipelineStepSpec.scala`. `datebucket` follows this template exactly — no structural deviation.

## Goals / Non-Goals

**Goals:**
- Add `datebucket` as a 14th step kind, following the `CastStep` config/codec template
  (per-field transform, tolerant decode, `null` on unparseable input) and the
  `SplitTextStep`/`ExtractHeadingsStep`/`ChunkByTokenCountStep` append-or-replace inference
  pattern (`filterNot` on the resolved output name, then `:+`).
- Deterministic, UTC-only bucket-floor semantics for `day`/`week`/`month`/`quarter`/`year`.
- Apply/infer parity: the analyze endpoint's output type for `outputColumn` must match what
  `DateBucketStep.evaluate` actually writes (a canonical ISO date string), consistent with how
  `cast`'s `"date"` target type is already represented on the wire (see `CastStep.castValue`,
  `case "date" => str`) — `date` fields are plain ISO strings, not a distinct runtime type.

**Non-Goals:**
- Gap-filling / resampling with synthesized empty buckets — out of scope per ticket.
- Configurable timezones — UTC only, documented in the requirement.

## Decisions

1. **Parsing strategy.** Accept three input shapes for `field`: (a) ISO-8601 date/time strings
   parseable by `java.time.Instant.parse` / `java.time.LocalDate.parse` / `java.time.OffsetDateTime`,
   (b) bare `LocalDate` strings (`yyyy-MM-dd`), (c) epoch values — a numeric string is treated as
   epoch **milliseconds** if its magnitude exceeds 10 digits (i.e., `> 9999999999L`), else epoch
   **seconds** (mirrors the common heuristic used elsewhere for epoch ambiguity: 10-digit values are
   seconds through ~2286, 13-digit values are milliseconds through ~2286). Any input that fails all
   three parses yields `null` for that row's `outputColumn`, matching `CastStep`'s per-value
   null-on-failure contract — no row is dropped.
   - Alternative considered: require an explicit `inputFormat` config field. Rejected — the ticket
     scope calls for the same tolerant, zero-config parsing style as `CastStep`; explicit format
     strings can be a follow-up if real data demands it.

2. **Flooring implementation — `java.time` with UTC.** Convert the parsed instant to
   `LocalDate.atStartOfDay(ZoneOffset.UTC)`-equivalent, then floor:
   - `day`: the date itself.
   - `week`: floor to the Monday of the ISO week (`java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)`).
     This is the "week boundary policy" the acceptance criteria call out to document — **weeks
     start Monday (ISO-8601)**, not Sunday.
   - `month`: first of the month (`withDayOfMonth(1)`).
   - `quarter`: first day of the quarter's first month — compute via
     `((month - 1) / 3) * 3 + 1` then `withDayOfMonth(1)`.
   - `year`: `withDayOfYear(1)`.
   Output is written as a canonical `yyyy-MM-dd` string (`LocalDate.toString`), matching how `cast`
   already represents `"date"` values on the wire (a plain ISO string, no time component) — no new
   date-representation convention is introduced.
   - Alternative considered: use `Instant`-based epoch-second bucket math (fixed-width buckets).
     Rejected — calendar-correct month/quarter/year buckets are not fixed-width (28–31 day months,
     leap years); `LocalDate` field arithmetic is the only correct approach and is what the ticket
     asks for ("start of the granularity bucket").

3. **Unsupported granularity → execute-time failure, not row-level null.** Per the ticket,
   `granularity` values outside `{day, week, month, quarter, year}` are a **step misconfiguration**,
   not a per-row data problem — the `evaluate` method returns a failed `Future` with a descriptive
   error message (`"Unsupported granularity: '<value>'. Valid values: day, week, month, quarter,
   year."`), consistent with how `AggregateStep`/`GroupByStep` already surface config-level errors
   distinctly from row-level `null` coercion failures (`CastStep`).

4. **`outputColumn` default and collision.** `DateBucketConfig.outputColumn: Option[String]`;
   `None` means overwrite `field` in place. When `outputColumn` is `Some(name)` and `name == field`,
   same as overwrite. `inferDateBucket` mirrors `inferSplitText`/`inferExtractHeadings`/
   `inferChunkByTokenCount`'s append-or-replace shape — **not** `inferCompute`'s, which
   unconditionally appends via `inputSchema :+ SchemaField(...)` with no collision check at all
   (`PipelineAnalyzeService.scala:114-136`; a `compute` step whose `column` collides with an
   existing field produces a duplicate-named field, a pre-existing quirk, not "replace" behavior —
   `compute` is the wrong precedent to copy here). The correct precedent is the `filterNot` + `:+`
   pattern used by `inferSplitText` (`PipelineAnalyzeService.scala:182-183`), `inferExtractHeadings`
   (216-217), and `inferChunkByTokenCount` (253-254): `inputSchema.filterNot(_.name ==
   resolvedOutputName) :+ SchemaField(name = resolvedOutputName, type = "date")` — this naturally
   handles both the replace case (name exists → old entry filtered out, new one appended in its
   place) and the append case (name doesn't exist → filter is a no-op, append adds it) in one
   expression.

5. **Config shape / codec.** `DateBucketConfig(field: String, granularity: String, outputColumn:
   Option[String])` — `jsonFormat3`, not `jsonFormat6` as the ticket text says (the ticket's
   "`jsonFormat6`" reference is a copy-paste slip from a step with more fields; the actual arity
   here is 3, matching the 3-field config). `decode` follows `CastConfig.decode`'s
   `StepCodecUtil.asObject` + tolerant-field-extraction template: missing `field`/`granularity`
   default to `""` (empty string), which then fails at `evaluate`-time with the standard
   "unsupported granularity" / all-rows-null path rather than a decode-time exception — consistent
   with the "tolerant decode, fail at execute time" contract every other step follows.

6. **Frontend editor.** `ui/DateBucketConfig.tsx` follows the existing per-op editor component
   shape (see the `cast` editor for the closest analog: a field-name select sourced from the
   analyze endpoint's `inputSchema`, plus one extra control). This editor needs: a field-name
   `<select>` (options = `inputSchema` field names, mirroring the cast op's field-source pattern), a
   granularity `<select>` (fixed 5 options), and an optional output-column text input (empty =
   overwrite `field`). Wire into `StepCard.tsx` / `useStepCardState.ts` the same way `cast` and
   `compute` are already wired (check both for the two distinct patterns — `cast` reads
   `inputSchema`, `compute` does not — `datebucket` needs the former).

7. **Flyway V-number.** Confirmed at design time: `backend/src/main/resources/db/migration/`
   currently tops out at `V63__pipeline_run_trigger_source.sql`; the most recent
   `pipeline_steps_op_check`-touching migration is `V52__add_chunkbytokencount_op.sql`. This change
   claims **V64** (`V64__add_datebucket_op.sql`), following the `V50`/`V51`/`V52` drop/re-add
   pattern with the full current op list plus `'datebucket'`. Per the ticket's merge-hazard note,
   the executor MUST re-confirm the current max migration file immediately before writing the
   migration (and again immediately before the delivery push) in case a concurrent v1.6 lane landed
   a same-numbered file in the interim — bump to the next free number if so, do not silently
   overwrite.

## Risks / Trade-offs

- [Risk] Epoch second-vs-millisecond heuristic (10-digit threshold) misclassifies genuine
  10-digit millisecond timestamps before 2001 or after 2286-adjacent edge cases →
  Mitigation: documented in code comment; acceptable since this mirrors existing informal
  conventions elsewhere in the codebase and the ticket does not call for an explicit-unit config.
- [Risk] ISO-week-starts-Monday policy may surprise US-centric users expecting Sunday-start weeks →
  Mitigation: explicitly documented in the spec requirement and code comment per the acceptance
  criterion ("week boundary policy documented").
- [Risk] Migration V-number collision with a concurrent v1.6 lane (three lanes may contend) →
  Mitigation: re-check immediately before commit and before push, per Decision 7.

## Planner Notes

- Self-approved: `jsonFormat3` (not `jsonFormat6` as literally stated in the ticket) — the ticket's
  wording is describing `PipelineStepProtocol`'s response wrapper arity for a different, larger
  step in a different ticket in the same epic; `DateBucketConfig` itself has 3 fields, so its own
  spray-json formatter is `jsonFormat3`. `PipelineStepProtocol.DateBucketStepResponse`'s formatter
  arity depends on how many wrapper fields the response type carries (id/pipelineId/position/config/
  createdAt/updatedAt, etc.) — that one may indeed end up needing `jsonFormat6` or similar; the
  executor should count fields on `DateBucketStepResponse` directly rather than copy a hardcoded
  arity number from either this doc or the ticket.
- Self-approved: `outputColumn` default field name is exactly `field` (no separate "auto-name"
  convention like `<field>_bucket`) — matches the ticket's explicit "default: overwrite `field`".
