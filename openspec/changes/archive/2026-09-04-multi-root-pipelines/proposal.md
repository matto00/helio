## Why

A pipeline today has exactly one source: `pipelines.source_data_source_id` is a single `NOT NULL` FK, and
`join`/`union`/`lookup` reach a second source only through their own step config. P2.1 (HEL-911) made the engine walk a
DAG with several lanes, but every lane still descends from that one root frame — so "combine two sources" is expressible
only as a step-config side-channel, never as the shape of the pipeline. Multi-root is the Phase-2 model the remodel spec
promised, and it is the gate on HEL-914: that ticket's `create_pipeline`, graph validator, workspace-context serializer
and error formatting are all planned directly against the root model defined here.

## What Changes

- **BREAKING** `pipelines.source_data_source_id` is replaced by a `pipeline_roots` table (`id`, `pipeline_id`,
  `data_source_id`, `position`). Flyway **V98** creates it, backfills exactly one root per existing pipeline, and drops
  the old column. Per decision 11 (**no deprecation**) the single-source read path is deleted, not kept as a fallback.
- **BREAKING** `POST /api/pipelines` and `create_pipeline` take `roots[]` (each an existing `sourceId` or an inline
  source spec) in place of the scalar `sourceDataSourceId`.
- Root-level steps (`parent_step_id IS NULL`) gain a `root_id`, so the engine knows which root frame each lane starts
  from. The engine walks one lane per root; a rejoin may consume lanes originating at different roots.
- New `POST /api/pipelines/:id/roots` and `DELETE /api/pipelines/:id/roots/:rootId` routes, and `add_root` / `remove_root`
  MCP tools. Removing a root deletes its lanes and their Outputs, reporting the placement count first.
- `get_workspace_context` lists roots per pipeline. Every root's source is ACL-checked at write time (404 when
  unreadable), generalizing the HEL-384 cross-tenant rule.
- **Proposals are NOT in scope** and stay singular-source. `PipelineProposal` carrying `roots[]` is **HEL-914**'s,
  which owns "Proposals: `PipelineProposal` / combined proposals may propose lanes and roots". A proposal here
  yields a well-formed one-root pipeline that `add_root` extends — a coherent intermediate state.
- **Contract deliverable:** `design.md` states the multi-root model — root identity, root ordering, node-path format,
  root-removal semantics — and **supersedes engine-contract item 11** of HEL-911's archived design, which pins a
  single-root lane path. The superseded item gains a forward pointer so no reader follows the stale format.
- Corrects four now-false sentences in the remodel spec (single-root concept model, "no second migration",
  "the data model supports them from day one", singular-root decision 4).

## Capabilities

### New Capabilities

- `pipeline-multi-root`: the root model — a pipeline has one or more ordered roots, each binding a DataSource; root
  identity, root ordering, root lifecycle (add/remove), root ACL, and the multi-root node-path format.
- `mcp-pipeline-root-tools`: `add_root` / `remove_root` MCP tool contracts.

### Modified Capabilities

- `pipeline-create-api`: request shape becomes `roots[]`; per-root 404 on an unreadable source.
- `pipeline-execution`: the walk begins at N root frames rather than one virtual root.
- `pipeline-lane-walk`: lanes originate at a root; node keying admits a root sentinel per root.
- `pipeline-run-execution`: one run refreshes all roots atomically; failure reporting names the multi-root node path.
- `pipeline-analyze-api`: a source schema per root; projected schema per node across roots.
- `workspace-context-assembly`: `PipelineEntry` carries `roots[]` instead of a scalar source id/name.
- `patch-set-apply`: the pipeline `create` edit target carries `roots[]`.
- `mcp-output-tools`: `create_pipeline`'s single-call contract takes `roots[]`.
- `pipeline-steps-persistence`: root-level steps carry a `root_id`.

## Non-goals

- The editor surface and the Playwright multi-root flow — **HEL-968 (P2.3b)**, which needs HEL-912's lane layout first.
  `frontend/**` is untouched by this change.
- MCP proposals and grounding for branching — **HEL-914 (P2.4)**, which this change gates.
- Connector-specific root kinds (v0.9 connectors plug into the same root model).
- Implementing the multi-root walk on Spark (HEL-238); the `PipelineExecutionBackend` contract must still compile.

## Impact

Model/persistence: `Pipeline`, `PipelineRow`/`PipelineTable`, `PipelineRepository`, new `PipelineRootRepository`,
`WorkspaceTeardownRepository`. Services: `PipelineService` (create + transactional fold), `PipelineRunService` (the
single-source chokepoint at three `findByIdInternal` sites), `PipelineAnalyzeService`, `WorkspaceContextService`,
`PipelineProposalService`, `PatchSetApplyResolvers`, `PatchSetPreviewProjection`. Engine: `InProcessPipelineEngine`
node keying and `InProcessExecutionBackend`. API: `PipelineProtocol`, `WorkspaceContextProtocol`, `ApiRoutes`.
Contracts: 4 `schemas/` files (+ `AssistantProposalToolSchemas` parity, which `check:schemas` enforces strictly),
`helio-mcp/**`, 8 `e2e/**` specs that post a scalar source. **129 occurrences across 60 files** carry the
single-source assumption today.
