## Context

`AlertRuleRepository.listEnabledByDataTypeInternal` (V60, HEL-447) and `AlertEventRepository`'s
`findActiveByRule`/`upsertFiringInternal` (V61, HEL-455) are both privileged, `withSystemContext`
methods that were built with no caller — explicitly staged for this ticket. `PipelineRunService
.onRunSuccess` (`backend/src/main/scala/com/helio/services/PipelineRunService.scala:304`) is the
only place `resultRows`/`jsRows` exist in memory after a real write (`dataTypeRowRepo
.overwriteRows`). `AlertEventStateMachine.transition` (HEL-455) is the single source of truth for
every `AlertEvent` mutation — this engine must never write to `alert_events` any other way.

Gap found during planning: `Main.scala` constructs `alertRuleRepo` but never `alertEventRepo`, so
`ApiRoutes`'s nullable-optional `alertEventRepo` param defaults to `null` in production —
`/api/alerts` (HEL-455) is unreachable today. This ticket needs a live `AlertEventRepository`
instance in `Main.scala` anyway, so fixing that wiring gap is in scope.

## Goals / Non-Goals

**Goals:**
- `AlertEvaluationService.evaluateForDataType(dataTypeId, rows, triggeringRunId)` as the one
  entry point both `onRunSuccess` and the future HEL-340 scheduler call.
- Threshold comparator evaluation (`gt|gte|lt|lte|eq|neq`) over a scalar or column-aggregate
  metric, driving `upsertFiringInternal` (breach) / a new `resolveInternal` (clears).
- Per-run and per-rule failure isolation — one bad rule or a thrown exception never fails the
  triggering pipeline run, and never blocks evaluation of sibling rules.

**Non-Goals:**
- Delta/change, missing-data, anomaly conditions (follow-on ticket per proposal).
- Delivery/subscription consumption of the emitted log line (HEL-432).
- Building the HEL-340 scheduler itself.

## Decisions

- **Row representation**: `evaluateForDataType(dataTypeId: DataTypeId, rows: Seq[PipelineRowJson
  .Row], triggeringRunId: Option[String])`. `PipelineRowJson.Row = Map[String, Any]` is the
  engine's canonical row shape and exactly matches `onRunSuccess`'s `resultRows` — no JsValue
  round-trip needed to reach a raw field value for numeric coercion (see the dedicated coercion
  helper below).
  `triggeringRunId: Option[String]` (not `PipelineRunId`) so a schedule-triggered future call with
  no pipeline run can pass `None` — this is the "clear seam" for HEL-340: the entry point has zero
  dependency on `PipelineId`/`PipelineRunId`/`AuthenticatedUser`.
- **Numeric coercion policy (skeptic design-gate round 2 — explicit, ticket-literal decision)**:
  the ticket (`ticket.md:18`) states coercion must be "consistent with `inferFieldType`" in
  `PipelineRunService`. Checked `inferFieldType` (`PipelineRunService.scala:382-388`): it treats
  only `Boolean`, `Int`/`Long`, and `Float`/`Double` as typed values; **every `String` — numeric-
  looking or not — falls through to `"string"`**, never `"integer"`/`"double"`. This is *stricter*
  than `PipelineRowJson.toDouble` (`PipelineRowJson.scala:64-73`), whose `String` case parses via
  `s.toDoubleOption` and so *would* coerce e.g. `"42"`. Given the ticket names `inferFieldType`
  explicitly (not `toDouble`), and this codebase has documented un-cast-CSV-string pipeline output
  (a metric field can genuinely be a string like `"42"` before a `cast` step runs), this design
  **follows the ticket literally**: `AlertEvaluationService` gets its own `numericValue(v: Any):
  Option[Double]` helper — `Int`/`Long`/`Float`/`Double`/`BigDecimal` → `Some(_.toDouble)`,
  everything else (including every `String`, `Boolean`, `null`, nested maps) → `None`. This is a
  deliberate divergence from reusing `PipelineRowJson.toDouble` (which is the generic, more
  permissive primitive used elsewhere in the pipeline engine for sort/expression contexts, not a
  contract this ticket is bound to) — reusing it here would silently let un-cast CSV metric
  columns breach/clear thresholds, which the ticket's explicit `inferFieldType`-consistency clause
  exists specifically to prevent. Consequence, stated plainly: an alert rule targeting an un-cast
  string column never fires until a `cast` step converts it to a real numeric type — this is
  intentional, not a gap, and matches how the rest of the schema-inference system already treats
  such columns as non-numeric.
- **Metric extraction** (ticket: "single-row scalar, or an aggregate over the column; `metric =
  "*"`/count sentinel"): `metric == "*"` → `JsNumber(rows.size)` unconditionally (count, defined
  even for zero rows). Otherwise: `rows.size == 1` → scalar, `numericValue` applied to that one
  row's `metric` field; `None` (missing field, or a non-numeric-typed value per the coercion
  policy above) means no value to extract, and the rule is skipped for this evaluation (see the
  zero-rows case below — the same "skip, don't guess" policy). `rows.size > 1` → aggregate:
  **sum** of `numericValue` over the column, skipping rows where it returns `None` (mirrors the
  scalar path's skip philosophy). `rows.size == 0` with a non-`"*"` metric → **no value to
  extract**; the rule is skipped entirely for this evaluation (no breach, no resolve) — treating
  an empty result set as a "condition cleared" would silently conflate "no data" with "data is
  fine", which is explicitly the missing-data condition kind this ticket excludes (out of scope).
  Sum (not average) is chosen as the single baseline column-aggregate because it is the simplest
  reduction available without a richer condition-kind vocabulary; future condition-types tickets
  are the place to add avg/min/max/count-matching.
- **Auto-resolve on clear**: `AlertEventRepository.resolveInternal(ruleId: AlertRuleId): Future[
  Option[AlertEvent]]`, mirroring `upsertFiringInternal`'s shape — `withSystemContext`, reads via
  `findActiveByRule`. **Correction (skeptic design-gate round 1):** `findActiveByRule`'s
  `state =!= "resolved"` predicate (`AlertEventRepository.scala:123`) returns `firing`,
  `acknowledged`, **and** `snoozed` rows — it does *not* filter out `Snoozed`, and
  `AlertEventStateMachine.transition` does not accept `Resolve` from `Snoozed` (only from
  `Firing`/`Acknowledged`, per `AlertEventStateMachine.scala:37-47`). `resolveInternal` therefore
  branches explicitly on the active event's state before calling `transition`, rather than
  assuming every active row is resolvable:
  - `Firing` or `Acknowledged` → route through `AlertEventStateMachine.transition(existing,
    AlertEventAction.Resolve)`, persist via the same private `updateAction` `upsertFiringInternal`
    already uses, return `Some(resolved)`.
  - `Snoozed` → explicit no-op, returns `None`, no write. Auto-resolving a snoozed event would
    defeat the user's snooze; it is intentionally left `snoozed` and only re-fires (via
    `upsertFiringInternal`'s `ReFire` path on a later breach) or expires back to `firing` on its
    own read-time/re-fire path — never force-resolved by this engine. `None` here means "nothing
    was resolved" — the same return value as the "no active event" case, since both are
    legitimately "no resolution happened" from this method's caller's point of view.
  - No active event → no-op, returns `None`, no write (unchanged from the original decision).

  Called only when a rule's metric was successfully extracted (not skipped) and does not breach —
  mirrors the ticket's "a subsequent run that clears the condition transitions it to resolved"
  acceptance criterion, now correctly scoped to the two states where `Resolve` is actually legal.
- **Per-rule isolation**: `evaluateForDataType` evaluates each enabled rule inside its own
  `Future` wrapped in `recover { case NonFatal(e) => log.error(...); () }`, then sequences all
  rules with `Future.sequence` so one rule's bad `condition` JSON (e.g. missing `comparator` key)
  or a coercion failure logs and is skipped without blocking sibling rules for the same
  `DataTypeId`. The whole `evaluateForDataType` call is additionally wrapped by the caller
  (`onRunSuccess`) in a `recoverWith` — matching the file's existing discipline at
  `PipelineRunService.scala:239`/`299` — so a defect in `evaluateForDataType` itself (not just a
  single rule) can never fail `onRunSuccess`.
- **Hook placement**: after `rowsUpsert` inside `onRunSuccess`'s `for`-comprehension, added as one
  more independent `Future` (like `binaryRefsUpsert`) that does not gate `updateMeta`/`updateRun` —
  evaluation runs concurrently with those, and its failure (already caught by the recover above)
  never appears in the `for`-comprehension's failure path.
- **Wiring**: `PipelineRunService` gains an optional `alertEvaluationService: AlertEvaluationService
  = null` constructor param (nullable-default, mirrors `binaryRefRepo`). `ApiRoutes` builds
  `alertEvaluationServiceOpt` only when both `alertRuleRepo` and `alertEventRepo` are non-null
  (`for { r <- Option(alertRuleRepo); e <- Option(alertEventRepo) } yield new
  AlertEvaluationService(r, e)`), then passes `.orNull` into `PipelineRunService`'s constructor
  call. `Main.scala` gains `val alertEventRepo = new AlertEventRepository(ctx)` and passes
  `alertEventRepo = alertEventRepo` into `ApiRoutes` alongside the existing `alertRuleRepo =
  alertRuleRepo` — this is what makes both `/api/alerts` and the evaluation engine live in
  production; it is a pre-existing gap from HEL-455, fixed here because this ticket needs the
  same repo instance regardless.
- **Emitted log line**: one structured `log.info` per fired/resolved event (`ruleId`, `eventId`,
  `state`, `severity`, `dataTypeId`, `triggeringRunId`) at the point `upsertFiringInternal`/
  `resolveInternal` returns — a plain SLF4J line, not a new domain event bus (HEL-432 is a later
  ticket that can build on this; over-building a pub/sub mechanism now would be scope creep).

## Risks / Trade-offs

- [Risk] Sum-as-default aggregate may not match every user's mental model for "metric" (some
  expect average). → Mitigation: this is the ticket's stated baseline threshold-only scope;
  richer aggregate selection is explicitly deferred to the condition-types follow-on, and the
  choice is documented here so that ticket has an unambiguous starting point to extend from.
- [Risk] `Main.scala`/`ApiRoutes` wiring fix is technically outside HEL-466's literal text. →
  Mitigation: it is a one-line-per-file, additive, non-behavior-changing-elsewhere fix strictly
  required for this ticket's own production runtime to function (the evaluation engine has no
  effect if `alertEventRepo` is never constructed); called out explicitly in the proposal's
  Impact section rather than silently bundled.
- [Risk] `inferFieldType`-consistent coercion means un-cast CSV metric columns silently never
  evaluate (rule always skipped) rather than erroring, which could look like "alerts aren't
  working" to a user who hasn't run a `cast` step. → Mitigation: this is the ticket's explicit,
  literal instruction (see Decisions above) — the alternative (`toDouble`-style string coercion)
  trades a discoverability problem for a correctness problem (false breaches on ambiguous string
  data). Surfacing a user-facing diagnostic for "rule never evaluates because its metric column is
  string-typed" is a UI/UX concern beyond this ticket's scope (no alert-authoring UI exists yet);
  not addressed further here.
- [Risk] Concurrent runs against the same `DataTypeId` could race `upsertFiringInternal`/
  `resolveInternal` calls for the same rule. → Mitigation: out of scope — `onRunSuccess` already
  has no run-level mutual exclusion for the same `DataTypeId` today (schema/row upserts race the
  same way), and `upsertFiringInternal`'s read-then-write happens inside one `DBIO` composed by
  `withSystemContext`, the same transactional shape the existing dedup contract already relies on.

## Migration Plan

No schema change — V60 (`alert_rules`)/V61 (`alert_events`) already provide the tables this
ticket reads/writes. Deploy is a standard backend release; rollback is a revert (no data
migration to undo).

## Open Questions

- None blocking. Aggregate-function choice (sum), zero-row-skip policy, and the
  `inferFieldType`-consistent (not `toDouble`-permissive) numeric coercion policy are all
  self-approved design decisions within the ticket's explicit scope — see Planner Notes.

## Planner Notes

- Self-approved: `inferFieldType`-consistent numeric coercion (a dedicated `numericValue` helper
  that rejects every `String`, not `PipelineRowJson.toDouble`) — this is not a self-approved
  deviation from the ticket, it is literal conformance to the ticket's own explicit instruction
  (`ticket.md:18`, "Numeric coercion consistent with `inferFieldType`"); flagged here only because
  skeptic design-gate round 2 found the original draft had silently reached for the more familiar
  `toDouble` primitive instead and never said so.
- Self-approved: sum as the single column-aggregate function (see Decisions/Risks above).
- Self-approved: zero rows with a non-`"*"` metric skips the rule for that evaluation rather than
  treating it as either a breach or a clear — avoids silently doing missing-data detection work
  this ticket's "Out of scope" section explicitly excludes.
- Self-approved: fixing the `Main.scala` `alertEventRepo` wiring gap left by HEL-455, since this
  ticket cannot function in production without it.
- Self-approved: `AlertEventRepository.resolveInternal` as a new privileged method, following the
  exact pattern (`withSystemContext`, `findActiveByRule` read, `AlertEventStateMachine.transition`,
  `updateAction` persist) `upsertFiringInternal` already established — not a new architectural
  pattern, a direct extension of one HEL-455 already landed.
