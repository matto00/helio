## Context

`panels` is a wide-flat table (`PanelRepository.PanelTable`, 28 nullable subtype columns dispatched via
`PanelRowMapper`), not a JSONB-config table — every new bound field is its own column, following the
`aggregation`/`column_widths` precedent (V43, V53). `MetricPanelConfig`/`ChartPanelConfig`/
`TablePanelConfig` are structurally-identical-but-distinct case classes (design intentionally not
DRY'd into a shared trait, per `Panel.scala`'s own comment). `MetricRepository`/`MetricDefinition`
(HEL-446, `metrics` table, V75) are already owner-scoped with RLS; no CRUD consumer exists yet.
Panel query execution is two-phase: `GET /api/panels/:id/query` returns a `PanelQuery` (selected
fields/filters/sort/limit derived from `config.fieldMapping`) and `GET /api/types/:id/rows` returns raw
rows; **viz-level aggregation (`config.aggregation`) is applied client-side** at render time reading
`PanelResponse.config` directly (see `openspec/specs/panel-viz-aggregation/spec.md`) — the backend never
executes an aggregation query. This means "resolving the effective binding" is naturally a **read-path**
concern (what `PanelResponse.config` contains), not a query-execution concern.

## Goals / Non-Goals

**Goals:**
- `metricId` persists on the bound-trio configs, tolerant-decoded, absent-vs-null preserved on PATCH.
- `PanelService.create`/`update` reject an unresolvable/foreign/non-pipeline-output `metricId`.
- Cross-user or deleted-metric bindings clear on read, never 500 (mirrors `dataTypeId`'s existing pattern).
- `MetricPanel`'s read response materializes effective `dataTypeId`/`fieldMapping`/`aggregation`/`unit`
  from the resolved `MetricDefinition` when the panel's own raw fields are unset.

**Non-Goals:**
- Deriving `ChartPanel`/`TablePanel` effective field mappings (Decision 4).
- Any frontend work, or exposing `decimals`/`prefix`/`suffix` (no existing wire slot).
- Changing how/where aggregation executes (stays client-side, unchanged).

## Decisions

**D1 — `metricId` lives on the existing per-subtype `*Config`, not a shared trait.** Mirrors the
established "bound trio kept as distinct types, future divergence is structural" convention
(`ChartPanelConfig`'s own doc comment). Each gets `metricId: Option[MetricId] = None`, its own
`jsonFormat` arity bump, and its own `decode`/`decodeCreate`/`Patch`/`Patch.decode` branch for the
`metricId` field (string-or-null, same shape as `dataTypeId`'s existing handling). A shared
`implicit val metricIdFormat: JsonFormat[MetricId]` is added to `domain/panels/package.scala`, mirroring
the existing `dataTypeIdFormat` there (needed by all three configs' macro-derived formats).

**D2 — Persistence: one nullable `panels.metric_id` column, FK `ON DELETE SET NULL`.** New migration
(next available `VNN` after `V75__metrics.sql` — verify no newer migration landed on `main` since this
worktree branched; do not assume `V76` is still free at execution time). `PanelRowMapper` gains the
column on all three bound configs' `domainToRow`/`*Config` builders; `PanelRepository.configColumnsOf`/
`configColumnValuesOf` tuples grow by one element each (both currently 19-arity tuples — well under the
22-tuple ceiling that already forced `PanelTable.*`'s HList). `PanelTable.*`'s HList projection also
grows by one column. `ON DELETE SET NULL` means AC2 ("deleted metric reads back unbound") needs **no**
service-layer code — the FK does it at the DB layer; the read path only needs to treat an absent
`metric_id` exactly like any other unset optional column (already true by construction).

**D3 — Cross-user clearing reuses the `resolveBindingsForRead`/`resolveSingleBinding` shape, extended
with a new `MetricRepository.findByIdsOwned` batch lookup** (mirrors `DataTypeRepository.findByIdsOwned`
exactly — same `ids inSet` + owner-filter shape). `resolveBindingsForRead` gathers every panel's
`metricId` alongside its existing `dataTypeId` gather, looks both up in one round trip each, and clears
whichever one doesn't resolve to a caller-owned row — independently: an unresolvable `metricId` clears
only `metricId` (leaving `dataTypeId`/`fieldMapping` as they were, e.g. a raw override the panel still
carries), it does not force the whole panel unbound via `withBindingCleared`. Same for
`resolveSingleBinding` (single-panel path used by `update`/the `/query` route). This is a genuine defense
-in-depth path: `create`/`update` already reject a foreign `metricId` (D5), so a stored cross-user
`metricId` should not normally occur — this only guards against it, consistent with the codebase's ACL
triad philosophy already applied to `dataTypeId`.

**D4 — Effective-binding materialization is `MetricPanel`-only.** `ChartConfig.fieldMapping` is
axis-keyed (`{xAxis, yAxis, series?}` per `schemas/panel.schema.json`); `TableConfig.fieldMapping` is an
arbitrary column-key map. Neither has an unambiguous single slot a metric's one `measureField` should
fill (unlike Metric's `{value: ...}` convention, which the `panel-viz-aggregation` spec already defines).
Inventing an axis assignment would be a guess this ticket has no ground truth for. `ChartPanel`/
`TablePanel` therefore get `metricId` at the D1–D3 layers (schema, validation, persistence, cross-user
clearing) but **not** read-path materialization — their `buildQuery`/response `fieldMapping` continue to
come only from their own raw fields, exactly as today, until a follow-up defines the axis/column mapping.
This satisfies the ticket's "at minimum" / "where the epic warrants" phrasing literally rather than
guessing a shape that would need reworking later.

Materialization itself: extend `resolveSingleBinding`'s (and the batch `resolveBindingsForRead`'s)
per-panel step — after any `metricId` cross-user-clear, if the panel is a `MetricPanel` with a resolved
`metricId`, build the effective config: `dataTypeId = if (config.dataTypeId non-empty) config.dataTypeId
else metric.dataTypeId`; `fieldMapping = if (config.fieldMapping non-empty) config.fieldMapping else
JsObject("value" -> JsString(metric.measureField))`; `aggregation = config.aggregation.orElse(Some(
JsObject("value" -> JsString(metric.measureField), "agg" -> JsString(metric.aggregation))))`; `unit =
config.unit.orElse(metric.format.unit)`. Note `MetricAggregation.values` includes `"countDistinct"`,
which `panel-viz-aggregation`'s frontend `agg` enum (`count|sum|avg|min|max`) does not — an existing gap
between the two layers, not introduced by this ticket; the materialized value passes the raw string
through unchanged (frontend renders it as an unrecognized aggregation, same as any other unsupported
value today).

**D5 — `create`/`update` validation follows `PanelService.rejectCompanionBinding`'s error style (400
`BadRequest`, not `MetricService`'s 422), but not its pass-through-on-unresolved behavior** — where
`rejectCompanionBinding` lets a foreign/nonexistent `dataTypeId` pass through unchanged (deferred to
read-time clearing), AC3 requires a foreign/nonexistent `metricId` to be actively **rejected** at
create/update, so the new helper's control flow is the opposite for that case. New private helper
`rejectUnresolvableMetric(metricIdOpt, user)`: `None` → pass; `Some(id)` → `metricRepo.findByIdOwned` →
`None` (foreign/nonexistent) → 400; `Some(m)` → re-validate `m.dataTypeId` against V41
(`dataTypeRepo.findByIdOwned(m.dataTypeId, user)`, reject if absent or `sourceId.isDefined`) — a
defensive re-check, since `MetricService.create` already enforces this at metric-creation time, guarding
against any future drift. Called from `buildForCreate` and `update`, extracting `metricId` from the
create-config / config patch the same way `dataTypeIdFromCreateConfig`/`dataTypeIdFromConfigPatch`
already do (new sibling helpers in `PanelServiceHelpers`). Precedence (AC4): `metricId` need not be
mutually exclusive with raw `dataTypeId`/`fieldMapping` — both may be set; the raw field, when present,
is the effective value (D4); `metricId` only supplies the default when a raw field is absent. No
create/update-time rejection for "both set" — that combination is the designed override case, not a
conflict.

## Risks / Trade-offs

- [Chart/Table `metricId` is write-only metadata until a follow-up defines materialization] → documented
  explicitly in the proposal's Non-goals and here, not silently dropped; the field still round-trips
  and validates so a future ticket adds only the materialization step, not the whole plumbing.
- [`countDistinct` has no frontend renderer] → pre-existing gap (HEL-446 already allows it as a metric
  aggregation); out of scope to fix the frontend enum here.
- [Migration number could drift if another change lands V76 first] → executor verifies the next free
  `VNN` against `main` at implementation time rather than trusting this doc's guess.

## Migration Plan

Additive-only: new nullable column + FK, no backfill, no data loss on rollback (drop column). Existing
panels (no `metricId`) are byte-for-byte unaffected — `metric_id IS NULL` decodes to `None`, D4's
materialization branch never triggers.

## Open Questions

None outstanding — D4 resolves the one real ambiguity (Chart/Table materialization) by deliberately
deferring it rather than guessing.

## Planner Notes

Self-approved: D4's scope narrowing (Chart/Table get the field but not materialization) and D5's 400
(not 422) status-code choice, both within "self-approvable planning decisions" — neither is a new
external dependency, breaking change, or scope expansion beyond the ticket; D4 is, if anything, a scope
*reduction* relative to a literal reading of the "Resolution" bullet, made explicit and defensible rather
than silently guessed.
