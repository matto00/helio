## Context

Chain: `panels.output_id -> outputs (node_step_id XOR root_id, pipeline_id) -> pipeline_roots(data_source_id)
-> data_sources`. Multi-root since HEL-913; join/union nodes have several upstream roots. The
public gate template is `output-meta` (`authorizeResourceWithSharing` + `resolvePanelOutput`,
`*Internal` reads only after the dashboard check). HEL-1187 (splitting OutputService/OutputRoutes)
is open: do not refactor those files; put the logic in a new small `ProvenanceService`.

## Goals / Non-Goals

**Goals:** one call returns the chain; public variant is an explicit allowlist built from a
separate response type (never a filtered copy of the authenticated one); bounded query count.
**Non-Goals:** SLA/staleness model (HEL-431); popover UI (HEL-1207); telemetry (HEL-1208);
migrations (V113 is reserved for HEL-1208 - none needed here); the HEL-1187 refactor.

## Decisions

D1. **Two distinct response types**, `OutputProvenanceResponse` (authenticated, carries ids and
`pipelineId`) and `PublicOutputProvenanceResponse` (names/counts/timestamps only). The public type
is constructed field by field from the shared internal `ProvenanceChain` domain value; it has no
field that could hold an id, config, errorLog, observed or ownerId, so the exclusion is
structural, and tests assert the JSON key set exactly.

D2. **Source resolution.** Root-bound output (`rootId` set): exactly that root's source. Step-bound:
load the pipeline's steps once and compute the upstream closure of the output's step (cycle-safe,
visited set; reuse `NodeDependencyClosure` if it fits). Along the closure: (i) each step's
ancestor trunk root (walk `parentStepId` to the root; `pipeline_roots.data_source_id`) contributes
its source; (ii) a join/union/lookup `SecondaryInput.Lane(stepId)` is followed transitively into
that step's own closure; (iii) a `SecondaryInput.Source(dataSourceId)` names a DataSource directly
(it is NOT a pipeline root) and contributes that data source. All data source ids are resolved in
one batched read; results are de-duplicated by data source id, ordered trunk-first by root
`position` then secondary-discovery order. A data source that no longer resolves (deleted or not
readable) is omitted, never a placeholder, so the public variant cannot leak a dangling id. The
node path is the step-kind chain (steps carry no user-given name; the kind is the label) from the trunk root to the output's node along the primary
`parentStepId` chain (root-bound: empty). Tests: one scenario each for trunk root, join with a
secondary `Lane`, join with a secondary `Source`, union, lookup, and a deleted Source-kind data
source. Acceptance criterion (b) "two roots via join" is satisfied by the `Lane`-into-second-root
case AND the `Source` case.

D3. **Row count = count of rows in the output's own node snapshot** (what the panel actually
displays), NOT pipeline-final `lastRunRowCount`, which measures the final step and is wrong for a
mid-DAG node. Layout (verified): `node_snapshots` holds ONE ROW PER DATA ROW (`row_index`, `data`
jsonb) keyed by `(pipeline_id, node_step_id | root_id)`. So this is a `count(*)` whose cost scales
with the snapshot size (O(rows in that node), served by the index on the node key; the executor
must name the index from the migrations and record `EXPLAIN` in evidence). `null` when no
snapshot exists. Accepted trade-off: exact over cheap; if evidence shows a scan over the
ticket's largest realistic node is unacceptably slow, escalate rather than silently switching to
`lastRunRowCount`.

D4. **Last run** = most recent non-dry run (same filter as `assertionStatus`, where the `!= dry_run`
filter is load-bearing). Fields: `status`, `completedAt` (freshness = this value; `pipelines.lastRunAt`
is the HEL-1177 `dataAsOf` source and stays as is). `null` object when the pipeline never ran.
`errorLog` is never in either response.

D5. **Assertion summary** for the latest non-dry run, scoped to the output's node:
`{defined, passed, failed, warned}` counts, `rootBound`. Exactly: no assert steps at the node
=> `defined:false`, all counts 0 (NOT "all passed"); root-bound output => `defined:false,
rootBound:true` (never has an assert step). Severity mapping: `error` failures -> `failed`,
non-error failures -> `warned`, passing -> `passed`. No `observed` values anywhere. The existing
`/assertion-status` response is unchanged.

D6. **Query budget (no N+1), authenticated:** output (1), pipeline (1), steps for the pipeline (1),
roots for the pipeline (1), data sources for all resolved ids via one batched read (1), runs
(1 - `listByPipelineInternal` returns all retained runs, which is retention-bounded; the
executor uses a limited/latest-non-dry read if one exists, otherwise states this bound in evidence),
assertions for the one latest run (1), snapshot count (1) = at most 8 DB reads, independent of
the number of roots/steps/secondary inputs/assertions. Public: gate + `resolvePanelOutput`
reads as `output-meta` does, plus the same 7 reads after the output is known. Mechanism (task
2.4): a test-side counting wrapper/instrumented repository (or DB statement counter) over a
fixture with 1 root/1 step/1 assertion vs one with 3 roots/several steps/several assertions,
asserting the read count is equal in both and <= 8 (authenticated). If no batched data-source
read exists the executor adds one rather than looping.

D7. **Public route** `GET /api/dashboards/:dashboardId/panels/:panelId/provenance?token=`: same
directive, `resolvePanelOutput`, same 404 mapping (missing panel/other dashboard's panel/no
output/not OutputPanel) and 404/denied for bad or missing token identical to `output-meta`; mirror the existing output-meta public-route test for the 404/denied mapping.
Composed before the catch-all panel-list `pathEndOrSingleSlash` like its siblings.

D8. **HEL-1197.** `PublicOutputMetaResponse` loses `ownerId` (frontend already nulls it).
`PanelResponse.ownerId` becomes `Option[String]`; `PanelResponse.fromDomain` gains an explicit
parameter (default keeps `ownerId`, so every non-public call site - PanelRoutes, DashboardRoutes,
DashboardContentsRoutes, DashboardSnapshotRoutes, proposals, patchsets - is byte-identical) that
the shared public panel-list route sets to drop `ownerId` when `userOpt.isEmpty` (anonymous or
share-token-only caller). An authenticated non-owner viewing a public dashboard KEEPS `ownerId`
(HEL-1197 says anonymous callers; authenticated viewers already receive it on every other
route). Blast radius to handle: `schemas/panels/panel.schema.json` lists `ownerId` as required
(relax it); the patchset undo conflict check serializes `PanelResponse` (regression test: the
authenticated serialization is byte-identical before/after); frontend `PublicOutputMeta` wire
type/mapper/tests; `canWrite` stays false publicly.

D9. **HEL-1177.** `dataAsOf` is populated ONLY by the shared public panel-list route
(`PublicDashboardRoutes`, `GET /api/dashboards/:id/panels`, including authenticated viewers of
that route); every other `PanelResponse.fromDomain` site passes `None` (verified), so
authenticated create/update/dashboard-contents/snapshot responses carry null. No frontend reader
exists (grep). The spec's frontend-indicator requirements are REMOVED (provenance popover
HEL-1207 supersedes); the replacement requirement states the truthful scope above. Fix BOTH
stale doc comments: on the `PanelResponse.dataAsOf` field and on `fromDomain`
(`PanelProtocol.scala` ~139) that claim every caller passes `None`.

D10. **MCP:** a new `get_output_provenance` tool (a field on `get_output` would make every read pay
the query budget). Tool copy states the real status codes (200/404/401 etc.), probed live against
a running backend, not assumed. Name must not collide with `get_output_capabilities`
(different words; capabilities = filter contract).

## Risks / Trade-offs

- Dropping `PanelResponse.ownerId` for anonymous callers could break a hidden frontend reader ->
  grep and tests; frontend type is already optional.
- `count(*)` over a large snapshot scales with row count -> D3 evidence and escalate rather than silently substitute.
- `NodeSnapshotRepository` is covered by the node-root guard: if touched, run the guard locally
  and audit any allowlist line remap.
