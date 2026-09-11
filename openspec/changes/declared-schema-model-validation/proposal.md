## Why

`dataset` sources (HEL-1073/1074) persist a caller-declared schema in `dataset_schema`, but that
column today only carries `{name, type}` pairs and nothing validates writes against it. v0.8's
write-back story (HEL-643) requires the declaration to be authoritative: a dataset is the one
source kind Helio must not silently re-infer or coerce for.

## What Changes

- Extend the dataset declared-schema shape to carry `name`, `type` (canonical `DataFieldType`),
  `required`, and `default` per field, alongside the existing name/type pairs already backfilled
  by V106.
- Add a reusable write-time validator: given a declaration and a candidate row (positional array,
  matching `dataset_rows.data`'s existing shape), reject with a field-level error on a type
  mismatch (no coercion) or a missing required field with no default.
- Route the two existing `dataset_rows` writers (`DataSourceRepository` create/refresh, called via
  `DataSourceService`) through the validator so today's write paths already enforce the
  declaration — HEL-1077's row write API calls the same entry point.
- Normalize `required`/`default` at the JSON wire boundary (spray-json drops `Option=None`) so an
  absent field on the wire round-trips as "unset", not a false rejection.

## Capabilities

### New Capabilities

- `dataset-schema-validation`: the declared-field model (name/type/required/default) and the
  write-time validation contract every `dataset_rows` writer must satisfy.

### Modified Capabilities

- (none confirmed at planning time — `dataset-row-storage` and `static-data-connector` describe
  storage/connector shape, not this validation contract, and neither's existing requirement text
  describes today's lenient/coercing write acceptance as a spec-level guarantee. tasks.md 4.4
  re-verifies this against the actual spec text at execution time; a MODIFIED delta is added there
  if that check finds otherwise.)

## Impact

- `backend/src/main/scala/com/helio/domain/model/DataSource.scala` (or a new sibling file) — new
  `DatasetFieldDeclaration` model.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  — `dataset_schema` (de)serialization gains `required`/`default`.
- New validator (`DatasetRowValidator`) called from `DataSourceService.createStatic`/
  `applyStaticRefresh` — the single choke point every current writer (route, `PatchSetApplyForward`,
  `PipelineProposalService`, `PipelineService`) already goes through.
- `StaticColumnPayload` (`api/protocols/sources/DataSourceProtocol.scala`) gains `required`/
  `default`; `schemas/` + `openspec/` OpenAPI + frontend TypeScript types updated to match.
- `DataSourceRoutes.scala` — a rejected write returns the existing `ErrorResponse(message)` `400`
  shape via `ServiceError.BadRequest`, carrying the pinned message format (design.md Decision 7);
  no new error envelope.
- No migration expected (`dataset_schema` is already `jsonb`, schema-on-read).

## Non-goals

- The row write API itself (`POST/PUT/PATCH/DELETE .../rows`) — HEL-1077.
- Declaration-mutation semantics when rows already exist — not in this ticket's AC; deferred.
- Coercion/auto-repair of bad data — writes are rejected, never coerced.
