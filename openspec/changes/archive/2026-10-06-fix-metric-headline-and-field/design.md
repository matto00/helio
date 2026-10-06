## Context

See proposal.md (Why). Verified on main at 0614c979; citations re-verified at cdb9e43d6:
- `OutputSummaryReducer.metric` (`backend/.../domain/history/OutputSummaryReducer.scala:87-103`) selects
  `if (mapping.size == 1) mapping.headOption else fieldMapping.value ?? aggregation.value`. The client port
  `resolveServerMetricField` (`frontend/src/features/panels/history/metricHistoryView.ts:21-34`) is identical.
- Metric `fieldMapping` keys are validated on every write against `OutputBindingSpec.Metric` slots
  `{value, label?, unit?}` (`OutputBindingSpec.scala:64-67`, `OutputService.validateFieldMapping`). The lone-mapping
  branch can therefore only ever pick `value` (already covered by the `fieldMapping.value` branch) or `label`/`unit` (the bug).
- Panel rows are fetched in 200-row pages (`usePanelData.ts:160,187`, `usePanelSortFilter.ts:139`). Viewer controls
  and server-mode cross-filter `eq` travel as `filter` to `GET /api/outputs/:id/rows`, filtered in SQL by
  `NodeSnapshotRepository.listRowsPaged`. The public route shares parsing/resolution (`OutputRowsQueryParsing`,
  `OutputRowsQuery.resolveFilter`).
- In `MetricOutputPanel`, `selectMetricHistoryView` returns `headline: null` under `filterActive`, so the headline is
  `computeAggregate(rawRows ...)`: the loaded page only.
- Cross-filter `client-fallback` mode (`useCrossFilterServerOps.ts:84`) narrows LOADED rows client-side
  (`PanelContent.tsx:230-247`); the server never sees that term.

## Goals / Non-Goals

**Goals:** one metric-field rule on server and client that never picks `label`/`unit`; a full-filtered-set headline
for every server-applied filter, on the authenticated and public paths; a red-first test for each fix.

**Non-Goals:** rewriting history rows (D4); the pipeline-editor preview (`OutputPreviewPane`, HEL-1321's area);
the history scrubber (L7); `ci.yml`/`playwright.config.ts`/`.gitignore`.

## Decisions

**D1 — Field rule: `fieldMapping.value` → `aggregation.value` → none.** Drop the lone-mapping branch in both
`OutputSummaryReducer.metric` and `resolveServerMetricField`, keeping the existing precedence of the two remaining
branches. Alternative considered: keep the branch but exclude `label`/`unit` keys. Rejected because with slots
validated to `{value,label,unit}` that branch has no remaining legitimate case; an exclusion list is a second rule
to drift. Legacy unvalidated configs with another lone key now resolve to `null` (the AC's "no valid field → null").
The shared fixture spec (`OutputSummaryReducerSeamSpec` + its TS twin) gains the label/unit cases so the two ports
are pinned together.

**D2 — Filtered metric piggybacks on the rows responses (page 0).** Both rows responses gain an optional
`metric: {field: string, agg: string|null, value: number|null} | null`, present only when kind = metric, a resolved
filter is defined, and `offset == 0`, else the key is ABSENT. A metric whose config resolves to no field yields
`"metric": null` (present, null), exactly like the stored summary. One service-level helper computes it after the existing
ACL/`resolveFilter` steps from the already-resolved filter, so aggregate and page share the filter (not necessarily
the snapshot: like today's count+page, the reads are separate transactions — accepted).
- Authenticated: `OutputRowsResponse` gains `metric: Option[...]`; `schemas/outputs/output-rows-response.schema.json`
  (`additionalProperties: false`) gains the optional `metric` property and the presence rule in its description.
- Public: `PublicPanelRowsResolver.resolveRows` (split out of `PublicDashboardRoutes` by HEL-1291; `outputRepo` is plain since
  HEL-1337) today returns `PagedResult[JsValue]` serialized generically
  (`{items,total,offset,limit}`, no schema). It becomes a dedicated `PublicPanelRowsResponse(items, total, offset,
  limit, metric: Option[...] = None)` — declared under `api/protocols/**` with `metric` LAST (schema-drift pairs by
  schema `title`; its case-class regex is not paren-balanced) — with the SAME JSON for existing keys (additive), plus a new
  `schemas/dashboards/public-panel-rows-response.schema.json`, registered however `scripts/check-schema-drift.mjs`
  pairs schemas with case classes (executor verifies the mechanism). `usePublicPanelData`/`fetchPublicPanelRows`
  parse `metric` from it.
- Alternatives rejected: a separate `/metric` endpoint (second request + second public route + a filter race); an SQL
  aggregate (cannot reproduce `JsSemantics.coerceNumber`'s JS `Number` parity).

**D3 — Computation: projected filtered read + reducer, always `row_index ASC`.** A new `NodeSnapshotRepository`
method returns only the metric field's cell (`data -> field`) for every row matching node + resolved filter, ordered
`row_index ASC` regardless of any `sort` on the request (so a direct API/MCP caller with `sort` gets a defined value;
the client never sends a sort for metric panels). The reducer's metric function is exposed (`metricOf(rows, config)`)
and applied to `{field -> cell}` rows. `Output` carries no config, so the helper reads it (`findConfigById` /
`findConfigsByIdsInternal`) ONLY when kind = metric, the resolved filter is defined (an empty/unparsable filter
resolves to none) and offset = 0 — unfiltered requests issue no new statement. Cost is the same order as the run path (which already holds all node rows) and
the filtered `count(*)` (which already scans the matching set). Pass criterion (self-set): on a node with ≥100k rows and a filter
matching ≥50k, median of 20 calls of the service path adds ≤ 500 ms over the same call without `metric`. Measured by
a non-gating measurement spec on EmbeddedPostgres, opt-in via env var `HELIO_MEASURE=1` so it never runs in
`sbt testFull`/CI, following `OutputHistoryCostMeasurementSpec`'s pattern (never the
shared dev DB); record the command, numbers and node row cap in the PR. Over the bar → escalate before merge, never ship silently.

**D4 — Spurious history values: expose stored identity, client guard; no backfill, no contract change.** Summaries
hold no rows, so a spurious value cannot be recomputed. After D1 the client's `pointMatches` drops mismatched points
from headline/sparkline, but its stale-baseline check only sees a baseline that is among the 30 returned `points`;
`OutputHistoryService.forOutput` resolves a window baseline via `nearestAtOrBefore` with no identity check (owner
ruling HEL-918 D6), so a spurious out-of-window baseline WOULD drive a panel delta. Fix (in authority, contract
semantics unchanged): each resolved `current`/`baseline` point gains an additive `metric: {field, agg} | null` read
from its stored summary (history response case classes + `output-history-response`/`public-output-history-response`
schemas, explicit `null`), and the client's stale check uses `baseline.metric` (falling back to today's `points`
lookup when absent) so a mismatched baseline hides the delta wherever it lies. MCP `get_output_history` gains only that
additive key. Rejected: a server guard nulling `baseline` (changes D6 for every API/MCP reader; owner call). Residual:
raw `current`/`points` on the API/MCP still report old stored values until the next run/retention; documented in the
PR. Owner ruled `no-backfill`: no V117 migration. HEL-1327 item 1 (owner `proceed-with-restated-scope`) folds in here as a
route test: a baseline older than the 30 returned points carries `baseline.metric`, so it is checkable against the
current config without a server selection change.

**D5 — Client-side cross-filter over a truncated load: RULED `existing-disclosure`.** In `client-fallback` mode with
an actual narrowing (`isCrossFiltered`) the server value excludes the cross term, so every such narrowing keeps the
loaded-rows value (no same-column carve-out: value equality vs the client's numeric-loose `cellMatchesValue` is
ill-defined). When every row is loaded the loaded value is the full set. With truncated rows,
`PanelContent.tsx:363-370` already renders HEL-588's `LoadedScopeDisclosure` "N of M loaded rows match." for every kind.
Owner ruling (HEL-1326 escalation, 2026-10-06, `existing-disclosure`): the HEL-588 disclosure "N of M loaded rows match." satisfies "labelled as computed over the loaded rows". No new copy; task 2.6 adds a guard that the disclosure renders on a metric panel in that state. Public
dashboards pass `crossFilterMode="none"` and cannot reach it.

**D6 — Client plumbing.** `fetchPanelPage` returns the response `metric`; `panelsSlice` stores it on the pagination
entry from page-0 responses only, alongside `lastQuery`; a page-0 response WITHOUT `metric` CLEARS it (no stale value
after a filter is removed). `usePublicPanelData` does the same per request. It reaches `MetricOutputPanel` as a
`filteredMetric` prop via `PanelContent`. Under a server-applied filter with no client-fallback narrowing, the headline is `filteredMetric.value` when its `field`/`agg` match
`resolveServerMetricField(config)`; `null` renders the same empty value a no-field metric renders today. Without a
matching `filteredMetric` (in flight, older server) it keeps today's loaded-rows value. A present `metric: null`
with a config that resolves to no field shows no value (matches D1); `undefined` (key absent) means "not provided".

**D7 — Pinned seams.** A new `metricField` category in `shared-test-fixtures/output-summary-reducer.json` (config →
expected `{field, agg} | null`) is asserted by BOTH `OutputSummaryReducerSeamSpec` and `aggregate.fixture.test.ts`
(via `resolveServerMetricField`). The route specs assert the exact `metric` JSON keys and validate against the
updated schemas. The filtered-headline RTL drives the real `fetchPanelPage` → `panelsSlice` → `PanelContent` →
`MetricOutputPanel` path from a mocked HTTP rows response; a prop-injected test does not count.

## Risks / Trade-offs

- [Unbounded filtered read per page-0 metric request] → metric kind + filter + offset 0 only, one projected column,
  measured under D3. Over the bar → escalate before merge, never ship silently.
- [Two ports drift again] → shared fixture cases (D1) and a client RTL test on the real panel.
- [Behaviour change for configs relying on the lone branch] → only `label`/`unit` (bug) or invalid legacy keys can
  be affected (D1).
- [Public rows path grows] → the helper lives in the service layer; `PublicPanelRowsResolver.resolveRows` (HEL-1291
  split) gains one service call.

## Planner Notes

- Self-approved: D1, D2, D3, D6 (no external dependency, no breaking API: an additive optional response key).
- Self-approved: D4 (additive identity + client guard; no change to ruling D6), D7.
- Owner rulings recorded: D5 `existing-disclosure`, D4 `no-backfill`; HEL-1327 item 1 folded in (route test only).
