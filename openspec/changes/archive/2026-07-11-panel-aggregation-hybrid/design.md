## Context

Metric panels map `rows[0]` (`usePanelData.ts:97-107`); `ChartPanel.tsx` plots one mark per raw row.
The frontend already fetches the FULL row set for a bound DataType in one call
(`fetchDataTypeRows`, `panelThunks.ts:235-256`) and slices it client-side for pagination — so an
"all rows" computation needs no new backend query path. `AggregateStep.scala` already implements
sum/avg/min/max/count with null-tolerant numeric coercion (`PipelineRowJson.toDouble`); this design
reuses those semantics (reimplemented in TS — no shared runtime between Scala/TS) rather than
introducing a second backend aggregation code path.

The "bound trio" (`MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig`) are deliberately kept as
distinct types (design.md of the CS2c-3c change); this change follows that precedent and does not
introduce a shared `BoundConfig` trait.

## Goals / Non-Goals

**Goals:**
- Metric `value` slot renders an aggregate (`count|sum|avg|min|max`) over ALL rows when configured.
- Chart renders one aggregate mark per `groupBy` group when configured.
- Same wire path (config PATCH, propose/apply-proposal) carries the new spec.
- Zero behavior change when the aggregation spec is absent.

**Non-Goals:**
- No backend/Spark aggregation push-down — rows are already fully materialized client-side.
- No change to `AggregateStep`/pipeline `aggregate` op.
- No metric label/unit-literal or chart appearance depth work (sibling HEL-291 workstream).

## Decisions

**1. Aggregation computed client-side, over all rows, keyed off the existing full-fetch.**
`usePanelData` already receives the complete row set into Redux via `fetchDataTypeRows`; only the
`pageSize` param controls how much of it lands in `paginationState.rows` (`page*pageSize` slice).
When a panel's config carries an aggregation spec, `usePanelData` requests a page size large enough
to cover the whole set (`Number.MAX_SAFE_INTEGER`) instead of the metric/chart default (10/200), so
`rows` in memory is the full set the aggregate needs. Alternative considered: a new
`GET /api/types/:id/rows?aggregate=...` backend endpoint — rejected as unnecessary network-path
duplication when the full set is already one call away, and it would fork aggregation semantics
across two runtimes for no correctness gain at current row-count scale (HEL-291's benchmark is 1000
rows).

**2. Shared TS aggregate utility mirrors `AggregateStep` semantics exactly.**
New `frontend/src/utils/aggregate.ts` exports `computeAggregate(rows, field, fn)`:
count = number of rows where `field` is non-null/non-undefined; sum/avg/min/max over values coercible
to a finite number, skipping non-coercible values. Numeric coercion: native `number` is used directly;
a `string` is coercible only if `s.trim() !== "" && Number.isFinite(Number(s))` — the explicit
non-empty guard is required (not just `Number.isFinite(Number(s))`) because `Number("")` and
`Number("  ")` both evaluate to `0`, a well-known JS gotcha that would silently treat a blank/absent
value as a real zero. This mirrors Scala's `s.toDoubleOption`, which rejects `""` (verified: matches
`AggregateStep`'s existing `PipelineRowJson.toDouble` behavior exactly, unlike a bare `Number(s)`
check). `sum` returns `0` when zero coercible values exist (mirrors `AggregateStep`'s `nums.sum` on an
empty list); `avg`/`min`/`max` return `null` when zero coercible values exist (mirrors `AggregateStep`'s
`null` on empty `nums`). Unit tests assert parity against the `AggregateStep` scenarios (null-skip,
all-null → null, mixed string/number fields, and — critically — an empty-string cell, since that is
the exact sentinel `usePanelData` substitutes for `null`/`undefined` before rows reach `ChartPanel`;
see Decision 4).

**3. Metric aggregation spec: `{ value: string; agg: AggFn }`, independent of `fieldMapping.value`.**
When present, it overrides only the `value` slot; `label`/`unit`/`trend` continue to read
`fieldMapping` off `rows[0]` unchanged (HEL-291's metric-renderer fixes are a separate workstream).
`AggFn = "count" | "sum" | "avg" | "min" | "max"`.

**4. Chart aggregation spec: `{ groupBy: string; agg: AggFn; yField: string }`, computed in
`usePanelData` over typed rows — NOT in `ChartPanel` over `rawRows`.**
`ChartPanel`'s only row-data input today is the already-stringified `rawRows`/`headers` pair (built by
`usePanelData.ts` via `Object.values(row).map(v => v != null ? String(v) : "")`), which substitutes the
literal empty string `""` for both `null`/`undefined` cells AND genuine empty-string cells — the two
become indistinguishable. That loses no information for `sum`/`avg`/`min`/`max` (a blank string was
never a coercible number either way), but it is fatal for `count`, whose entire job is to distinguish
"null" from "present": a straightforward `count` over already-stringified rows cannot tell a real null
apart from a real `""` and will overcount. Rather than adding a parallel raw-row channel into
`ChartPanel` (a second row-data path to keep in sync with `rawRows`), `groupAndAggregate` runs inside
`usePanelData` over the same typed `rows` (`Record<string, unknown>[]`) the metric path already uses
(Decision 3) — where real `null`/`undefined` survive intact — and `usePanelData` returns a new
`chartAggregate: { categories: string[]; values: number[] } | null` field on `PanelDataResult`,
computed only when the chart panel's config has an `aggregation` spec. `ChartPanel`/`buildDataOption`
accepts this precomputed field as an additional optional prop and, when present and `chartType` is
`bar`/`line`, renders it directly (categories = sorted group keys, values = aggregates) instead of
grouping `rawRows` itself — `ChartPanel` never re-derives grouping from stringified data, so the
null-vs-empty-string ambiguity never enters the aggregation computation for any of the five `AggFn`
values, including `count`. Pie/scatter chart types are out of scope for `groupBy` aggregation in this
change (bar/line only, matching the ticket's "the bar/line case"); when `chartType` is pie/scatter (or
`chartAggregate` is absent), `ChartPanel` falls back to the existing `rawRows`-driven per-row path
unchanged.

**5. Config wiring follows the existing tolerant-decode + absent-vs-null patch pattern —
INCLUDING durable persistence via a dedicated `aggregation` JSONB column.**
Backend `MetricPanelConfig`/`ChartPanelConfig` gain `aggregation: Option[JsObject]` (stored/passed
through opaquely as JSON — the backend does not interpret it, matching its "backend doesn't compute
aggregation" role); `decode`/`Patch.decode` follow the same `None`/`Some(None)`/`Some(Some(v))`
absent-vs-null shape already used for `dataTypeId`/`fieldMapping`. `PanelConfigCodec` needs no change
beyond what each subtype's `format`/`decode` already provides (note: both configs currently derive
`format` via `jsonFormat2`; adding the third `aggregation` field requires bumping both to
`jsonFormat3` alongside the `decode`/`Patch` changes). `schemas/panel.schema.json`,
`schemas/dashboard-proposal.schema.json`, and the MCP `panelSchema` (zod) all add an optional
`aggregation` object with the same shape; `ProposalPanel`'s custom reader/writer (which already
tolerates absent optional fields) gains an `aggregation: Option[JsObject]` field the same way.

**Durable persistence (cycle-2 correction — this was the actual planning gap, not just an
implementation miss):** `MetricPanelConfig.aggregation`/`ChartPanelConfig.aggregation` is only real
once it round-trips through Postgres, not merely through in-memory `decode`/`applyPatch`. This
requires, in the same change:
- A new Flyway migration (`V43__panel_aggregation_column.sql`) adding `panels.aggregation JSONB`
  (nullable) — the same pattern as the existing `field_mapping` column (`V5`/`V33`). Folding
  `aggregation` into the existing `field_mapping` JSONB blob was considered and rejected: the domain
  model already keeps them as distinct sibling fields (fieldMapping = which columns to read;
  aggregation = how to reduce them), and merging them at the mapper boundary would require an
  ad-hoc sub-key convention with no corresponding benefit over a second nullable JSONB column.
- `PanelRowMapper.metricConfig`/`chartConfig` read `row.aggregation` (JSONB → `Option[JsObject]`);
  `PanelRowMapper.domainToRow` writes `mp.config.aggregation`/`cp.config.aggregation` onto the new
  column for the metric/chart branches only (other panel kinds leave it `None`).
- `PanelRepository.replace` — the method `PanelPatchApplier` calls after every config PATCH — MUST
  include the new `aggregation` column in its persisted-column whitelist
  (`table.map(r => (..., r.aggregation, r.lastUpdated)).update(...)`); this whitelist is the actual
  point of failure cycle 1 missed (the domain-level patch was correct, but `replace` silently
  discarded the field on write).
- `PanelRepository.PanelRow`/`PanelTable` gain the corresponding `aggregation: Option[String]` field
  and column mapping (identical convention to `fieldMapping`'s `Option[String]` ↔ JSONB mapping via
  `jsonbStringType`).

## Risks / Trade-offs

- [Large row sets fetched fully into the browser for aggregation] → Acceptable at HEL-291's validated
  scale (1000 rows); a follow-on ticket can add backend aggregation if a workspace outgrows this.
- [Chart groupBy path forks from the fieldMapping-driven path in `buildDataOption`] → Kept as an
  additive branch (checked first, existing path unchanged when spec absent) rather than a rewrite, to
  minimize risk to the well-tested per-row rendering path.
- [Two aggregate implementations (Scala pipeline step, TS panel util) can drift] → Mitigated by unit
  tests asserting identical behavior on the same fixtures; documented in code comments cross-referencing
  `AggregateStep.scala`.

## Planner Notes

- Self-approved: computing aggregation client-side (Decision 1) rather than adding a backend endpoint —
  proposal's "Impact" section already scoped this as frontend-only; no new backend query surface keeps
  the change additive and low-risk, consistent with "keep changes focused" and existing full-fetch
  architecture.
- Self-approved: metric aggregation only overrides the `value` slot, leaving label/unit/trend
  unchanged — keeps this change scoped to the ticket's literal spec and defers HEL-291's metric-
  renderer-fixes workstream (separate child ticket).
