## Skeptic Report — final gate (round 1, skeptic-final-1-deletion-sweep.md)

Dimension: **deletion-sweep completeness only.** Route/ACL correctness, contract+schema
consistency, and wire-contract diff are owned by the three sibling skeptics this round.

### What I verified (with evidence)

1. **Sweep grep across this diff's files.** `git diff --name-only main...HEAD` (93 files), then
   `grep -n 'com\.helio\..*DataType\|DataTypeId\|MetricDefinition\|MetricId\|type_id\|dataTypeId\|metricId\|/registry\|/metrics\|computed_fields\|@deprecated\|TODO(remodel)'` over every
   still-existing file. **Every hit is a comment, a doc/tasks/ticket line, or a test-name string.**
   No live code hit.

2. **No new hits introduced.** Added-lines-only sweep
   (`git diff main...HEAD -- backend schemas | grep '^+' | grep <pattern> | grep -v comment`)
   returns **zero** rows. The diff adds no non-comment occurrence of any swept token.

3. **`/api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query`.**
   `ApiRoutes.scala` contains only two historical comments (lines 270, 390: "`DataTypeService`/
   `DataTypeRoutes` deleted outright", "`MetricService`/`MetricRoutes` deleted outright") and no
   route. Repo-wide `grep 'pathPrefix("types")\|pathPrefix("metrics")\|path("bound")\|pathPrefix("registry")'`
   over `backend/src/main/scala/` → **zero matches**. I did not stop at grep: I ran the route tests
   myself and read the output —
   `sbt 'testOnly com.helio.api.ApiRoutesSpec -- -z "retired DataType/Metric/bound-panel routes"'`
   → 4/4 passed (`/api/types`, `/api/types/:id`, `/api/types/:id/rows`, `/api/types/:id/assertion-status`,
   `/api/types/:id/panel-capabilities`, `/api/metrics`, `/api/metrics/:id`, `/api/panels/:id/query`
   all 404; `POST /api/panels/bound` 405). Because these compiled and ran, the absence is real, not
   asserted.

4. **`outputDataTypeId`/`outputDataTypeName` off the create/list path (task 4.4, CR6).** Grep of
   `PipelineRepository.scala` + `PipelineService.scala` + `PipelineProtocol.scala`: the only hits in
   the two repo/service files are **comments** (`PipelineRepository.scala:195,331-338`). The single
   live occurrence is `PipelineService.scala:517`, inside **`analyzeProposal`** populating
   `PipelineAnalyzeProposalResponse.outputDataTypeName` from a `PipelineProposal` — the P1.4-owned
   proposal protocol, not create/list. I read `PipelineSummaryResponse`
   (`PipelineProtocol.scala:41-51`, the `GET /api/pipelines` wire shape) directly: fields are
   `id, name, sourceDataSourceId, sourceDataSourceName, lastRunStatus, lastRunAt, lastRunRowCount,
   ownerId, tag` — **neither field present**. Task 4.4's checkbox is accurate; I did not rely on it.

5. **`findLastRunAtByOutputDataTypeId`.** Three repo-wide hits, all comments
   (`PanelProtocol.scala:31`, `PublicDashboardRoutes.scala:19`, `PipelineRepository.scala:338`).
   **`PublicDashboardRoutes.scala` contains no call** — the method no longer exists on
   `PipelineRepository` at all (removal comment at :338), so a stale call could not compile.

6. **`panel-query` / `PanelQuery` (task 4.2).** `schemas/panels/panel-query.schema.json` does not
   exist and never existed on `main` in this cycle (`git cat-file -e main:schemas/panels/panel-query.schema.json`
   → fatal: does not exist; deleted by HEL-904 `2ec2a5bc`). `ls schemas/panels/` confirms no
   panel-query file. Backend code: the only `PanelQuery` string is a removal comment in
   `model.scala:473`; **no `PanelQueryExecutor` or `case class PanelQuery` anywhere** in
   `backend/src/main/scala` or `backend/src/test/scala`. `openspec/specs/panel-query-model/spec.md`
   still exists on disk, but this change carries a proper **`## REMOVED Requirements`** delta for all
   three of its requirements (with Reason + Migration each), which is exactly how OpenSpec retires a
   capability at archive time — D6 states this rationale explicitly. Correct, not a leftover.

7. **No `@deprecated`, alias, or shim.** `git diff main...HEAD -- backend schemas frontend | grep '^+.*@deprecated'`
   → **zero added lines**. The only `@deprecated` strings anywhere in the diff are the AC restatements
   in `design.md:182`, `tasks.md:63`, and `ticket.md:49`.

8. **Out-of-scope carryover is genuinely explained.** The remaining repo-wide `outputDataTypeName`
   hits (`PipelineProposalProtocol`, `PipelineAnalyzeProposalProtocol`, `WorkspaceContextProtocol`,
   `WorkspaceContextService:314,358`, `AssistantProposalToolSchemas`, `RefinementEditShape`) are all
   in the pipeline-**proposal**/assistant surface, which design.md D7/D11 and ticket.md's "Out of
   scope" put in P1.4. `WorkspaceContextService:314` carries an in-code note saying exactly that.
   Not defects of this ticket.

### Verdict: CONFIRM

Within my dimension, the deletion sweep is complete for every file this ticket touches, introduces
zero new hits, and every surviving hit is either a historical comment or documented P1.4/P1.7
carryover.

### Non-blocking notes

- **`openspec/specs/spark-query-pushdown/spec.md` is now a stale capability** — it specifies
  `PanelQuery.filters/sort/limit` pushdown and `PanelQueryExecutor` behavior for code that no longer
  exists anywhere in the backend, and this change carries **no delta for it** (only for
  `panel-query-model`). D6's own stated rationale ("leaving the spec in place would leave a
  capability describing a route that returns 404, failing HEL-910's eventual sweep") applies to it
  verbatim. Not a REFUTE: the file is not in this ticket's diff, the ticket's "Removed:" line names
  only `panel-query.schema.json`, and it sits in the same bucket as ~15 other stale specs
  (`mcp-metric-tools`, `metric-authoring-ui`, `panel-creation-datatype-step`,
  `pipeline-output-type-selector`, …) that this ticket correctly leaves to HEL-910's repo-wide
  sweep. **Recommend HEL-910 explicitly add `spark-query-pushdown` to its removal list**, since it is
  the one stale spec whose subject (`PanelQuery`) this ticket did partially retire, making it the
  easiest one to assume was already handled.
- `POST /api/panels/bound` returns **405, not the 404 ticket AC 5 words**, because `PanelIdSegment`
  is an unconstrained `Segment` matcher (design.md D5) that swallows `bound` as a bogus panel id.
  The test asserts 405 and documents why. It proves the same fact AC 5 wants (no `BoundPanelRoutes`
  exists, confirmed independently by the zero-match `path("bound")` grep), so I do not treat the
  literal status divergence as a defect — noting it so the AC/test mismatch is a deliberate,
  recorded decision rather than a silent one.
