## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Factual claims about already-shipped code (per the orchestrator's explicit instruction to verify,
not trust the design's own narrative):**

- `helio-mcp/src/context.ts:1114` — `metrics: metricsPage.items.map((m) => ({ ... deprecated: m.deprecated }))`
  has **no filter** — every metric (deprecated or not) is included today. Confirmed.
- `helio-mcp/src/context.ts:949-954` doc-comment: `"A deprecated: true entry is still included, not
  filtered out."` — confirmed verbatim, matches the design's claim that this is a deliberate,
  documented prior decision now being reversed.
- `frontend/src/features/panels/ui/editors/useMetricBindingState.ts` and `MetricPicker.tsx` — read in
  full; confirmed **zero** `deprecated` filtering anywhere in the fetch→store→render chain (raw
  `metrics.map(...)` into `Select` options).
- `backend/.../api/routes/MetricRoutes.scala:65-67` — `DELETE` handler is
  `ServiceResponse.runNoContent(metricService.delete(id, user))`, bare `204`. Confirmed.
- `backend/.../infrastructure/DataTypeRepository.scala:189-205` (`existsBoundToAnyOwnedPanel`/
  `...Action`) and `backend/.../infrastructure/PanelRepository.scala:114-155` (`findById`'s join
  shape) — both line ranges and the cited join/owner-scoping pattern match exactly.
- `backend/.../services/PanelServiceHelpers.scala:269-287` (`withMaterializedMetric`) — confirmed: a
  no-op for `ChartPanel`/`TablePanel` today (falls to `case other => other`), materializes only for
  `MetricPanel` — matches D6's premise that Chart/Table need new wiring to carry `metricDeprecated`.
- `frontend/src/features/metrics/ui/MetricListTable.tsx` / `.css` — `.metric-status--deprecated` class
  exists exactly as cited; `MetricDetailPage.tsx`/`MetricListTable.tsx` confirmed to show only static,
  hand-written delete-confirm copy with no real count today.
- `PanelService.resolveBindingsForRead`/`resolveSingleBinding` (`PanelService.scala:88-163`) — confirmed
  both refetch the live `MetricDefinition` via `metricRepo.findByIdOwned`/`findByIdsOwned` on **every**
  call (no caching), which is what makes D8's "rename requires no re-binding" claim true by
  construction.
- V75/V76 migrations — confirmed `panels.metric_id` FK (`ON DELETE SET NULL`, indexed) and `metrics`
  table (with `deprecated BOOLEAN NOT NULL DEFAULT FALSE`, owner-scoped RLS) already exist; no new
  migration is needed for this ticket, as claimed.
- `MetricRepository.scala`/`MetricService.scala` — confirmed `findByIdOwned`-first-then-404 pattern
  already used identically in `update`/`delete`, and `MetricService.delete` is a clean extension point
  for computing the pre-delete usage count (task 1.4).
- Cross-checked all cited tasks.md test-file targets (`MetricRepositorySpec.scala`,
  `MetricRoutesSpec.scala`, `PanelMetricBindingRoutesSpec.scala`, `helio-mcp/src/context.test.ts`) exist
  and are plausible extension points.
- Read all five spec deltas (`mcp-metric-tools`, `metric-authoring-ui`, `metric-crud-api`,
  `metric-usage-governance`, `panel-datatype-binding`) in full — internally consistent with
  design.md/tasks.md, and each ticket AC traces to a concrete requirement/scenario.

**Result: every specific factual claim I could check about the current state of the HEL-549/HEL-553
code was accurate.** No hallucinated line numbers, no misdescribed current behavior.

### Missing contract update (the actual defect)

D6/tasks 2.1-2.2 add a new, **always-emitted, non-optional** `config.metricDeprecated: Boolean` field to
every `MetricPanel`/`ChartPanel`/`TablePanel` read response (`panel-datatype-binding/spec.md`'s own
scenarios assert `GET /api/dashboards/:id/panels returns ... config.metricDeprecated: true`, and the
type is `Boolean` not `Option[Boolean]`, so per spray-json's derived-format semantics it can never be
omitted — it will appear on literally every metric/chart/table panel response going forward, bound or
not).

`schemas/panel.schema.json`'s `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig` are each
`"additionalProperties": false` and currently declare no `metricDeprecated` property (verified by
reading the file). `schemas/bound-panel-response.schema.json` (`POST /api/panels/bound`'s response)
`$ref`s `panel.schema.json` directly, so the same gap propagates there too.

Per this repo's own binding rule (`CLAUDE.md`: *"Schemas in `schemas/` (JSON Schema 2020-12) ... define
the contract between frontend and backend. These are the source of truth for request/response
shapes."* and *"Keep schema updates in the same change as related client/server code."*), and per the
design's own cited precedent — D1 explicitly invokes `GET /api/pipelines/:id/analyze`, which **does**
ship a matching `schemas/pipeline-analyze-response.schema.json` — this change's own convention-model
is "new/changed response shape → matching schema update," yet neither `design.md` nor `tasks.md`
mentions touching `schemas/panel.schema.json` anywhere. Task 4.1 updates the **frontend TS** type
(`MetricPanelConfig`/etc. in `panel.ts`) but the JSON-Schema contract file — the thing `panel.ts`'s own
comments point back to as the source of truth (e.g. `panel.ts:81` `// schemas/panel.schema.json
$defs.MetricAggregation`) — is left stale.

This isn't hypothetical/cosmetic: it is a real, silent contract drift on an endpoint (`GET
/api/dashboards/:id/panels`) this change modifies, in a file the project explicitly designates as the
frontend/backend contract's source of truth, that the design's own reasoning (D1) demonstrates the team
knows how to keep in sync for an analogous case in the very same change.

I did not find a test that would currently catch this (no `PanelRoutesSpec`/`PanelMetricBindingRoutesSpec`
validates responses against `panel.schema.json` via `JsonSchemaValidation` today — that harness is only
wired to `WorkspaceContextServiceSpec`), so this would ship as silent drift rather than a build failure,
which makes it more important to catch now, at the design gate, rather than downstream.

### Verdict: REFUTE

### Change Requests

1. **`schemas/panel.schema.json`**: add `design.md`/`tasks.md` coverage for updating
   `$defs.MetricConfig`, `$defs.ChartConfig`, and `$defs.TableConfig` to declare the new
   `metricDeprecated` property (`"type": "boolean"`, and — since it's a non-optional field that is
   always present once `metricId` support exists on that config — add it to each `$def`'s `required`
   list, matching how `metric.schema.json` requires its own `deprecated` field). Without this, the
   change ships a documented contract file (`schemas/panel.schema.json`, `$ref`'d by
   `bound-panel-response.schema.json` too) that is stale relative to the actual wire response the
   moment this ships — a direct violation of `CLAUDE.md`'s "keep schema updates in the same change"
   rule, using this same change's own D1 precedent (`pipeline-analyze-response.schema.json`) as the
   counter-example of doing it correctly.

### Non-blocking notes

- Optional, not required for CONFIRM: per D1's own cited precedent (`GET /api/pipelines/:id/analyze` →
  `pipeline-analyze-response.schema.json`), consider adding a
  `schemas/metric-usage-response.schema.json` for the new `GET /api/metrics/:id/usage` response shape.
  Not every existing sub-resource endpoint has one (`DataTypeRowsResponse`/`GET /api/types/:id/rows`
  doesn't), so this is weaker evidence than the `panel.schema.json` gap above, but it would keep this
  change internally consistent with the precedent it cites for D1.
- Everything else reviewed — the D1-D8 decisions, the join/RLS/ownership reasoning, the
  `withUserContext`+explicit-`owner_id`-filter pattern (correctly distinguishing "owned" from
  "RLS-visible-via-sharing" panels), the `respondWithHeader`/`runWith` mechanism for D2's header, the
  spec deltas' AC traceability — held up under adversarial re-derivation from the actual code. This is
  a well-grounded, mechanically sound design; the one gap above is narrow and fixable with a short
  addition to tasks.md (no redesign needed).
