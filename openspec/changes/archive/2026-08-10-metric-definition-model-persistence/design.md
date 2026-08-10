## Context

`MetricPanelConfig` (`backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`)
carries an ad-hoc `aggregation: Option[JsObject]` per panel — no reusable, named
metric exists. This is the foundational data-layer ticket for the Semantic/Metric
Layer epic (HEL-418): domain model + Flyway migration + repository + JSON only.
No REST routes, no panel binding, no MCP surface (418-B onward).

Existing conventions to follow: value-class IDs + immutable case classes
(`model.scala`), `fromString: Either[String, X]` allow-list validators (`Severity`,
`Comparator`, `ScheduleKind` in `model.scala`), owner-only RLS via `ENABLE` +
`FORCE ROW LEVEL SECURITY` with a single `USING (owner_id = current_setting(...))`
policy (V35/V54), and Slick repositories with `withUserContext`/`withSystemContext`
(`DataTypeRepository`, `PipelineRepository`).

## Goals / Non-Goals

**Goals:**
- Durable `MetricDefinition` domain model with allow-listed `aggregation`.
- `metrics` table: owner-only RLS, FK cascade to `data_types`, JSONB columns for
  `allowed_dimensions`/`format`.
- `MetricRepository` mirroring `DataTypeRepository`/`PipelineRepository` CRUD shape.
- spray-json formatters for `MetricDefinition`/`MetricFormat`.

**Non-Goals:**
- CRUD service/REST routes (418-B), panel→metric binding (418-C), MCP surface
  (418-D), agent grounding (418-E), authoring UI (418-F), governance/deprecation
  propagation (418-G).
- No validation that `measureField`/`allowedDimensions` actually exist on the bound
  DataType's `fields` — that's a service-layer (418-B) concern once routes exist.

## Decisions

1. **Aggregation validation lives on the domain model as a companion `fromString`,
   not as a raw `String` field with no boundary check.** Mirrors `Severity`/
   `Comparator`/`ScheduleKind`. `MetricDefinition.aggregation` stays typed `String`
   on the case class (per ticket's literal field list) but the repository's
   `insert`/`update` call `MetricAggregation.fromString` and return a `Left`
   through the repository call site if invalid, matching how `PipelineStep`-style
   validation is layered today. Concretely: a small `object MetricAggregation`
   with `val values: Set[String]` and `def validate(s: String): Either[String, String]`
   sits next to `MetricDefinition` in `model.scala`; the repository's `insert`/
   `update` call it before writing.

2. **RLS: direct-owner pattern, `owner_id UUID NOT NULL REFERENCES users(id)`,
   plus an index on both `owner_id` and `data_type_id`.** The ticket's own
   acceptance criteria specify a single owner policy on `owner_id` (the V35/V54
   shape), not an EXISTS-subquery via `data_types.owner_id` — `metrics.owner_id`
   is a first-class column, so the simpler direct policy applies. Revised after
   design-gate round 1: `metrics` is structurally closer to `alert_rules`
   (`V60__alert_rules.sql`) than to the older `image_uploads` (V54) — both are
   owner-only tables with a FK-with-CASCADE to `data_types` — so it follows
   `alert_rules`' newer conventions: an explicit `owner_id ... REFERENCES
   users(id)` FK (V35/V54 predate this and don't have it), and an index on
   `data_type_id` (`idx_metrics_data_type_id`, mirroring
   `idx_alert_rules_target_data_type_id`) alongside `idx_metrics_owner_id` —
   `data_type_id` carries `ON DELETE CASCADE`, so an unindexed column here
   would force a full scan on every `DataType` delete.

3. **JSONB for `allowed_dimensions`/`format`, `MappedColumnType` via spray-json,
   same pattern as `DataTypeRepository`'s `dataFieldsColumnType`.** No new
   serialization mechanism introduced for the *column* encoding.

3a. **Wire exposure: `MetricResponse` DTO + `fromDomain`, not a direct
   `RootJsonFormat[MetricDefinition]`.** Revised after design-gate round 1: a
   direct top-level `RootJsonFormat` on the domain case class has zero
   precedent anywhere in this codebase — every existing ID/Instant-bearing
   entity (`AlertRule`, `DataType`, `PipelineSchedule`, etc.) is instead
   exposed through a separate `*Response` DTO with string-ified IDs/timestamps
   and a `fromDomain` conversion (e.g. `AlertRuleResponse`/
   `AlertRuleResponse.fromDomain` in `AlertRuleProtocol.scala`), and no
   `JsonFormat[Instant]` instance exists anywhere to support direct
   macro-derivation on the domain type. `MetricProtocol.scala` adds
   `RootJsonFormat[MetricFormat]` (needed directly, for the JSONB column) and
   a `MetricResponse`/`RootJsonFormat[MetricResponse]` pair mirroring
   `AlertRuleProtocol`, satisfying the ticket's "spray-json formatters for
   MetricDefinition + MetricFormat" ask via the codebase's established wire
   convention rather than inventing new precedent for a feature (REST
   exposure) explicitly out of scope for this ticket.

4. **`findByIdInternal`/`withSystemContext` is included even though nothing calls
   it yet (ticket asks for "a privileged lookup where warranted")** — mirrors
   `DataTypeRepository.findByIdInternal`, anticipated for the future service
   layer (418-B) to resolve a metric's owner before an ACL check, exactly as
   `ResourceTypeRegistry` does for `DataType` today. Kept minimal: a single
   privileged-pool `findByIdInternal(id: MetricId): Future[Option[MetricDefinition]]`.

5. **Migration version resolved at implementation time via `ls` of
   `db/migration/`, not hardcoded** — main is currently at V74 (ticket's "V59"
   note is stale); the executor picks the next available `VNN` when it runs,
   per the ticket's own instruction not to hardcode.

## Risks / Trade-offs

- [Risk] `allowedDimensions`/`measureField` are not validated against the bound
  DataType's actual `fields` at this layer → Mitigation: explicitly out of scope
  (418-B does field-shape validation once a service layer exists); this ticket's
  acceptance criteria only require the `aggregation` allow-list check.
- [Risk] CASCADE delete on `data_type_id` means deleting a DataType silently
  deletes dependent metrics with no warning → Mitigation: matches the ticket's
  explicit acceptance criterion (CASCADE delete test required); future CRUD
  service (418-B) can add a pre-delete usage warning if needed — not this ticket.

## Planner Notes

- Self-approved: table/column naming (`metrics`, snake_case columns) — follows
  every existing migration's convention, no ambiguity.
- Self-approved: placing `MetricAggregation.fromString` next to `MetricDefinition`
  in `model.scala` rather than a new file — matches how `Severity`/`Comparator`
  live alongside their owning case classes today.
