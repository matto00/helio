## Context

Greenfield alerting subsystem, persistence layer only. Follows the existing `DataType`/`Pipeline`
pattern end to end: domain model in `model.scala`, Slick repository in `infrastructure/`, service
in `services/` returning `Either[ServiceError, _]`, thin routes composed into `ApiRoutes.scala`.
RLS is already established for owner-scoped tables (`rls-owner-tables`, V35) and a privileged
bypass path exists (`rls-privileged-bypass`, `withSystemContext` / `*Internal` repo methods, V34).
This change adds one new owner-scoped table (`alert_rules`) that follows both patterns exactly.

## Goals / Non-Goals

**Goals:**
- Durable `AlertRule` model + CRUD API, owner-scoped via RLS + service checks.
- A privileged `listEnabledByDataTypeInternal` read path for the future evaluation engine
  (HEL-455), which runs with no request user in a background post-run context.
- `condition` stored as `jsonb` so comparator/threshold/window (and future condition kinds) don't
  require new migrations.

**Non-Goals:**
- Evaluating rules, alert events, delivery, or any UI (later tickets in the chain).
- Enforcing `metric` against the target DataType's actual field set (deferred — `metric` is
  stored as a plain string; the evaluation engine validates it against live row data).

## Decisions

- **Table shape**: `alert_rules(id, owner_id, target_data_type_id, metric, condition jsonb, name,
  enabled, severity, created_at, updated_at)`. `owner_id` FK → `users(id)`, `target_data_type_id`
  FK → `data_types(id)` `ON DELETE CASCADE` (a rule with no target is meaningless; consistent
  with how `pipeline_steps` cascades from `pipelines`).
- **Migration version**: next available VNN confirmed at scheduling time by listing
  `backend/src/main/resources/db/migration/` (ticket text says V59 on main; **confirmed V60** in
  this worktree — the executor must re-verify at implementation time in case a sibling change
  landed first, per repo convention of scanning the directory rather than trusting the ticket).
- **RLS policy**: mirror `rls-owner-tables` V35 exactly — `ROW LEVEL SECURITY` +
  `FORCE ROW LEVEL SECURITY`, single `alert_rules_owner` USING policy keyed on
  `owner_id = current_setting('app.current_user_id')::uuid`. Direct-owner shape (like
  `pipelines`/`data_types`), not indirect — `owner_id` lives on the row itself.
- **Privileged read**: `listEnabledByDataTypeInternal(dataTypeId)` runs on
  `DbContext.withSystemContext`, mirroring `DataSourceRepository.findByIdInternal` /
  `PipelineStepRepository.listByPipelineInternal`. Justification comment required at the callsite
  per `rls-privileged-bypass` convention: this method is a placeholder used only by tests in this
  ticket (no caller exists yet — HEL-455 will call it from a background post-run path with no
  request user, so RLS bypass is required there, not optional).
- **`condition` representation**: `JsValue` (spray-json) end to end — domain model holds
  `condition: JsValue`, Slick column mapped as `jsonb` (raw string round-trip through
  `JsValue.parseJson`/`.compactPrint`, matching any existing jsonb column pattern in the repo, or
  established fresh if none exists — confirm at implementation time), wire format is the same
  `JsValue` passed through unchanged. This is what makes "unknown/extra keys survive a round-trip"
  free — the service never destructures `condition`, only validates it contains the expected
  `comparator`/`threshold` keys with correct types on write, and passes it through opaquely
  otherwise.
- **Severity/comparator enums**: closed Scala `sealed trait` enums (`Severity`: `Info`/`Warning`/
  `Critical`; `Comparator`: `Gt`/`Gte`/`Lt`/`Lte`/`Eq`/`Neq`) with `fromString`/`asString`, mirroring
  the existing `Role` enum pattern in `model.scala`. `severity` is a plain DB column (text);
  `comparator` lives inside the `condition` jsonb blob, not a separate column (per ticket: "flexible
  jsonb column... so richer condition kinds can be added without a migration").
- **Ownership validation on create**: `AlertRuleService.create` calls
  `dataTypeRepo.findById(targetDataTypeId)` (owner-scoped, not `*Internal`) so a non-existent or
  non-owned DataType yields `NotFound`/`Forbidden` → mapped to 404/422 by the route layer, matching
  the ticket's acceptance criterion. This double-enforces ownership (service check + RLS) as the
  acceptance criteria require.

## Risks / Trade-offs

- [Risk] `jsonb` handling in Slick can be awkward if there's no existing precedent in this
  codebase. → Mitigation: executor greps for any existing custom Slick `ColumnType` mappings first;
  if none exist, use a `String` column with `::jsonb` cast in raw SQL via Slick's plain SQL
  interpolation for the one or two spots that need it (matches how other ad-hoc SQL is done
  elsewhere in the repo — executor confirms at implementation time), and validate/parse at the
  service boundary so `AlertRule.condition: JsValue` is always well-formed at the domain layer.
- [Risk] Cascading delete on `target_data_type_id` could silently orphan-delete rules a user
  didn't intend to lose when they delete a DataType. → Mitigation: this matches the existing
  `panel_datatype_binding` guard pattern is *not* used here on purpose — deleting a DataType with
  bound panels is already blocked (409) elsewhere; cascading alert rules is acceptable since
  there's no equivalent "block delete if rules exist" requirement in this ticket, and evaluation
  tickets will need to handle the DataType-gone case regardless.

## Migration Plan

Standard Flyway forward-only migration; additive table, no data migration. Rollback = revert the
migration file + `flyway repair`/`undo` per existing project convention (no automated down
migrations in this repo).

## Open Questions

- None blocking — `jsonb` Slick mapping approach is an implementation-time decision within the
  above constraint (opaque `JsValue` passthrough), not a design ambiguity.

## Planner Notes

- Self-approved: `ON DELETE CASCADE` for `target_data_type_id` FK (see Risk above) — no equivalent
  block-on-delete requirement was specified for alert rules, and adding one would be scope
  creep beyond this ticket.
- Self-approved: `comparator` lives inside `condition` jsonb rather than as a separate enum
  column, per the ticket's explicit “flexible jsonb column” framing.
