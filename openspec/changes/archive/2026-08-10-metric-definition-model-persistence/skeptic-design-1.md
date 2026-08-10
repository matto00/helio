## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/metric-definition-persistence/spec.md` in full.
- Confirmed the migration-version note is handled correctly: `ls backend/src/main/resources/db/migration/`
  shows the latest migration is `V74__api_token_scope_and_run_audit.sql`, so the ticket's
  "main is at V59" is indeed stale and `design.md` Decision 5 correctly defers to
  `ls` at implementation time rather than hardcoding.
- Confirmed the value-class-ID + immutable-case-class convention
  (`backend/src/main/scala/com/helio/domain/model.scala:8-15`, e.g. `DataTypeId`,
  `UserId`, `PipelineId`) and the `fromString: Either[String, X]` allow-list pattern
  (`Severity` at model.scala:626, `Comparator` at 651, `ScheduleKind` at 702 — all
  `sealed trait X` + case objects + companion `fromString`/`asString`).
- Confirmed the RLS direct-owner shape cited (V35 `backend/src/main/resources/db/migration/V35__rls_owner_only_tables.sql`)
  and cross-checked it against the **most recent, most structurally identical**
  precedent, `V60__alert_rules.sql` ("Alert rule persistence foundation" — same
  shape: `id TEXT PRIMARY KEY`, `owner_id UUID NOT NULL ...`, FK to `data_types(id)
  ON DELETE CASCADE`, ENABLE+FORCE RLS, single owner policy) and `V61__alert_events.sql`.
- Read `DataTypeRepository.scala` in full to confirm the `withUserContext`/
  `withSystemContext`/`findByIdInternal` shape design.md Decision 4 claims to mirror
  — confirmed accurate.
- Read `backend/src/main/scala/com/helio/api/JsonProtocols.scala` (the aggregator
  trait — carries zero formats of its own) and all 25 files under
  `backend/src/main/scala/com/helio/api/protocols/`, plus
  `AlertRuleRepositorySpec.scala`, to establish the actual JSON-formatter and
  test-scoping conventions in this codebase.
- Grepped for `JsonFormat[Instant]` and `RootJsonFormat[<domain entity>]` across
  `backend/src/main/scala/` — zero hits for either, anywhere.

### Verdict: REFUTE

The design is broadly sound (domain model shape, RLS policy shape, repository CRUD
surface, and the `MetricAggregation` validation placement are all well-reasoned and
correctly grounded against `Severity`/`Comparator`/`DataTypeRepository`). But it has
three concrete, ground-truth-verifiable gaps against established codebase
conventions that a competent implementer will either silently deviate on or stall on.

### Change Requests

1. **Missing `owner_id ... REFERENCES users(id)` FK.** `tasks.md` 2.2 specifies
   `owner_id UUID NOT NULL` with no FK to `users`. `design.md` cites "V35/V54" as
   the shape to mirror, but the two *most recent and most structurally identical*
   precedents — `V60__alert_rules.sql:18` (`owner_id UUID NOT NULL REFERENCES
   users(id)`) and `V61__alert_events.sql:27` (same) — both add this FK; `V54`
   (`image_uploads`) is the older, pre-alerts-epic table that predates this
   convention. Since `metrics` is structurally closer to `alert_rules` than to
   `image_uploads` (owner-only + FK-to-`data_types`-with-CASCADE, not a standalone
   upload), it should follow the newer pattern. Add `REFERENCES users(id)` to the
   `owner_id` column in the migration task.

2. **Missing index on `data_type_id`.** `tasks.md` 2.3 only adds
   `idx_metrics_owner_id`. Every other FK-to-`data_types` column in this codebase
   is indexed: `idx_data_type_rows_data_type_id` (V29), `idx_binary_refs_data_type_id`
   (V46), and — again the closest analog — `idx_alert_rules_target_data_type_id`
   (`V60__alert_rules.sql:30`). `metrics.data_type_id` carries `ON DELETE CASCADE`,
   so every `DataType` delete will do an unindexed table scan of `metrics` to find
   cascade candidates without this index. Add `idx_metrics_data_type_id`.

3. **`RootJsonFormat[MetricDefinition]` has no precedent anywhere in this codebase
   and is under-specified.** `proposal.md` line 22-23, `tasks.md` 4.1, and
   `spec.md`'s "MetricDefinition JSON formatters" requirement all call for a direct
   spray-json `RootJsonFormat[MetricDefinition]` with a round-trip-equality test
   (`spec.md` "MetricDefinition round-trips through JSON"). I checked all 25 files
   in `backend/src/main/scala/com/helio/api/protocols/` and every single existing
   domain entity that carries a value-class ID or an `Instant` (`DataType`,
   `AlertRule`, `PipelineSchedule`, `ImageUpload`, `ApiToken`, `Dashboard`, `Panel`,
   every `PipelineStep` subtype, etc.) is **never** given a direct
   `RootJsonFormat` — it is always exposed through a separate `*Response`/
   `*Request` DTO (e.g. `AlertRuleResponse`, `DataTypeResponse`) with string-ified
   IDs (`.value`) and string-ified timestamps (`.toString`), converted via a
   `fromDomain` method. There is also **no `JsonFormat[Instant]` instance anywhere
   in the codebase** (only Slick `BaseColumnType[Instant]` instances, e.g.
   `DataTypeRepository.scala:209`) — `jsonFormatN` cannot derive
   `RootJsonFormat[MetricDefinition]` without one, plus new `JsonFormat[MetricId]`/
   `JsonFormat[UserId]`/`JsonFormat[DataTypeId]` instances that also don't exist
   for this purpose today (the two ID-JSON-format instances that do exist —
   `dataTypeIdFormat` in `domain/panels/package.scala` and `panelIdFormat` in
   `PanelProtocol.scala` — are for embedding IDs inside nested JSON *blobs*, not
   for top-level entity marshalling). `design.md` Decision 3 ("No new
   serialization mechanism introduced") only actually justifies the JSONB
   `MetricFormat`/`Vector[String]` `MappedColumnType` (which *does* match
   precedent, e.g. `DataTypeRepository.dataFieldsColumnType`/`RootJsonFormat[DataField]`
   for the analogous embedded-struct case) — it does not address this separate,
   much bigger ask. Since this ticket explicitly has no REST routes (out of
   scope), there is no functional need for a top-level entity JSON format at all
   right now. Resolve before implementation: either (a) drop the top-level
   `RootJsonFormat[MetricDefinition]` / JSON-round-trip requirement from
   `tasks.md` 4.1 / `spec.md` and keep only `RootJsonFormat[MetricFormat]` (needed
   for the JSONB column), or (b) explicitly design a `MetricResponse` DTO
   consistent with every other entity and update the tasks/spec accordingly, or
   (c) explicitly call out the new `JsonFormat[Instant]`/ID-format precedent as a
   deliberate, reviewed deviation and add it as its own task line.

### Non-blocking notes

- `MetricDefinition.aggregation` is kept as a raw `String` field (not the
  `sealed trait` ADT shape `Severity`/`Comparator`/`ScheduleKind` use) per the
  ticket's own literal field list, with validation only enforced at the
  repository insert/update boundary rather than at construction. `design.md`
  Decision 1 documents this tension transparently rather than hand-waving it, so
  I'm not blocking on it, but note it's a weaker guarantee than the ADT pattern
  (a `MetricDefinition` with an invalid `aggregation` string can be freely
  constructed in memory) and worth a one-line callout in `tasks.md` 1.4 so the
  executor doesn't "fix" it into a full ADT without noticing the deliberate
  choice.
- AC #4 (RLS isolation test) will, by this codebase's established and previously
  documented limitation (dev/CI connects as Postgres superuser on both pools,
  which unconditionally bypasses `FORCE ROW LEVEL SECURITY`), only actually prove
  app-layer `WHERE owner_id = ?` scoping, not real Postgres RLS enforcement — see
  `AlertRuleRepositorySpec.scala`'s own comment block on this exact gap. This
  matches how every other owner-scoped repository spec in the codebase is written,
  so it's not a deviation worth blocking on, just worth the executor being aware
  of so the test doesn't overclaim in its description/comments.
