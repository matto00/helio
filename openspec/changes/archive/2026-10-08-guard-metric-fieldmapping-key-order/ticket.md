# HEL-1182: Metric panel value resolution breaks when backend does not preserve fieldMapping key order

## Description

origin_kind: followup / origin_ticket: HEL-588

`PanelContent.tsx`'s `OutputPanelContent` (metric branch) resolved a metric panel's value column via
`Object.values(fieldMapping)[0]` — the FIRST value in whatever order the `fieldMapping` keys iterate, not a lookup by
the semantic key (`"value"`). During HEL-588's live evaluation a metric Output created with `fieldMapping: {value, label}`
came back as `{label, value}` (the backend does not preserve key insertion order — Postgres jsonb normalises it), so the
positional pick silently resolved the wrong column and the metric rendered `0`/blank.

Likely shape (implementer decides): resolve by the semantic key (`fieldMapping["value"]`) rather than position.

## Acceptance criteria

* A metric panel's displayed value is correct regardless of the order keys appear in its `fieldMapping` object.
* A red-first test: a metric `fieldMapping` with `label` before `value` (simulating the observed backend round-trip
  reordering) still resolves to the correct value column.
* No behavior change for a metric `fieldMapping` with only one key.

## Premise validation (Setup, 2026-10-08) — restated scope

The positional pick no longer exists on main: HEL-1275 (77bdaec8e, #779) removed it when the metric branch moved to
`MetricOutputPanel.tsx`, and HEL-1326 (659eec30, #805) made both the server rule (`OutputSummaryReducer.metricField`)
and its client mirror (`resolveServerMetricField`) resolve `fieldMapping.value`, then `aggregation.value`, by key on
every path. AC1 and AC3 are therefore met on main; AC2 (a label-before-value test) is not.

Ticket-drift escalation answered `proceed-with-restated-scope` by the **driver, under the overnight delegation** (not an
owner ruling). Restated scope — no AC dropped, AC2 becomes the deliverable:

* Key-order-shuffling regression tests on every remaining metric-value path: client `resolveServerMetricField` and
  `MetricOutputPanel` (loaded-rows value, filtered-metric value, server headline); server
  `OutputSummaryReducer.metricField`/`metricOf` and `OutputFilteredMetric` (authenticated rows route and the public
  `PublicPanelRowsResolver` path); `CollectionRenderer`.
* "Red first" is demonstrated by mutation: reinstating the positional pick (`Object.values(fieldMapping)[0]` on the
  client, first `fieldMapping` entry on the server) must turn the new tests red.
* Out of bounds (concurrent lanes): `usePanelData.ts`, `outputConfigTypes.ts`, Output config schemas, `PanelCard.tsx`.
* No production-code change is expected; if a test exposes a real order dependence, that is a defect to fix in scope.
