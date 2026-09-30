## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket, proposal, design, tasks, all 4 spec deltas.
- SecondaryInput (backend/.../domain/steps/SecondaryInput.scala:19-20): `Source(dataSourceId)` | `Lane(stepId)`; used by join, union, lookup (InProcessPipelineEngine.scala:118-120). A Source-kind secondary names a DataSource directly, NOT a pipeline root.
- NodeSnapshotRepository.overwriteRows: node_snapshots is one row per DATA row (`row_index`, `data` jsonb), keyed (pipeline_id, node_step_id | root_id).
- PanelResponse.fromDomain callers: only PublicDashboardRoutes.scala:414 passes dataAsOf; every other site (PanelRoutes, DashboardRoutes, DashboardContentsRoutes, DashboardSnapshotRoutes, proposals, patchsets) uses the None default.
- No batched DataSource read exists (DataSourceRepository has findByIdInternal only) - design already anticipates adding one.
- ownerId consumers: frontend panel.ts:274 already optional; TableRenderer canWrite null-safe; schemas/panels/panel.schema.json:7 lists ownerId as REQUIRED; helio-mcp types.ts carry ownerId for authed reads.

### Verdict: REFUTE

### Change Requests
1. D2 is under-specified / wrong on secondary inputs. It says "each reached root contributes its source" but a join/union/lookup secondary is `Lane(stepId)` (follow to that step's ancestor root via pipeline_steps.root_id) OR `Source(dataSourceId)` (a DataSource with no root row). Decide and write: Source-kind secondary contributes that data source (resolved via the same batched read, name+kind, and in the public variant still names only); Lane-kind is followed transitively (use/reuse NodeDependencyClosure); lookup is included. Add a test scenario per kind (AC (b) "two roots via join" is ambiguous otherwise) and handle a deleted/unreadable Source-kind data source (omit vs placeholder) explicitly.
2. D9 and panel-data-freshness delta claim dataAsOf is "backend-populated for both callers"/"authenticated and public callers". False: only the public panel-list route populates it; authenticated panel responses (create/update/dashboard contents/snapshot) always emit null. Reword the requirement and D9 to the truth (populated by the shared public panel-list route, including authenticated viewers of it; null elsewhere) and have the scenario name that route, else the spec is a new HEL-1177-style stale claim.
3. D3/Risks describe node_snapshots as possibly "one-row-per-node"; it is one row per data row, so the count is O(rows in the node), not a cheap aggregate. Correct the text, state the index relied on (verify existence in migrations) and that cost scales with snapshot size; ticket requires stating the row count used - keep "count of rows in the node's own snapshot" but with the correct layout and a cost statement.
4. Task 2.4 has no acceptance mechanism: say how reads are counted (e.g. instrumented repository/DB-statement counter in test) and what bound is asserted (<= 8 auth / public = gate reads + 7), using fixtures with 1 vs many roots/steps/assertions. Also note listByPipelineInternal returns all retained runs (retention-bounded) - state that or use a limited read so "runs list (1)" is honest.
5. D8/3.1 must list the blast radius of making PanelResponse.ownerId Option: schemas/panels/panel.schema.json `required` must drop/relax ownerId; fromDomain needs an explicit anonymity parameter (default keeps ownerId) so the 8+ non-public call sites are unchanged; patchset undo conflict-check serializes PanelResponse - task a regression test that authed output is byte-identical. Also state that an authenticated non-owner viewing a public dashboard keeps ownerId (HEL-1197 says anonymous) or decide otherwise.

### Non-blocking notes
- Public 404-vs-denied mapping "identical to output-meta": name the existing test to mirror.
- HEL-1177 doc-comment fix should also fix fromDomain comment at PanelProtocol.scala:139.
