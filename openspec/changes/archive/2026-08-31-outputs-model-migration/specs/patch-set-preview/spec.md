## ADDED Requirements

### Requirement: Preview enforces the panel/pipeline content-level checks apply would separately enforce
Beyond `resolveAll`'s target/ACL/shape gate, `preview` SHALL reject a patch set identically to how
`apply` would for each of the following content-level checks, so a preview-clean patch set is not
falsely reported clean: a panel-update edit with a blank title or a cross-type PATCH (mirrors
`PanelServiceHelpers.resolvePatch`); a pipeline-rename edit with a blank `name` (mirrors
`PipelineService.updateName`). This list is the SPECIFIC set of gaps found between `resolveAll` and
the real per-kind service methods at ticket delivery time — not a claim that every future
service-side validation is automatically covered (design.md Risks). This requirement replaces the
base spec's "Preview also enforces the specific content-level checks apply would separately
enforce" — the dataType-update/dataType-delete checks that requirement also described no longer
apply (see the REMOVED entry below), and neither does the panel-update `chartType: "scatter"` +
`aggregation` conflict check that requirement described: `PanelService.validateScatterAggregationConflict`,
`ChartPanel`, and panel-side `aggregation` were all deleted by this same ticket (task 3.9/4.1,
`PanelServiceHelpers.scala:188-199`), so there is nothing left for `preview` to mirror there. The
blank-title/cross-type-PATCH and pipeline-rename checks the base requirement also covered are
unchanged and restated here.

#### Scenario: A blank-title panel update is rejected, not silently previewed as valid
- **WHEN** `preview` is called with a panel-update edit whose `patch.title` is blank
- **THEN** `preview` rejects the whole call with the same error `PATCH /api/panels/:id` would give

### Requirement: Impact hints are explicit and source-grounded for surviving edit kinds
`EditPreview.impact` SHALL surface the following cascade/staleness consequences, each backed by a
real backend behavior, and SHALL be empty for any edit with no such consequence: a `pipeline`/
`pipelineStep` `update`/`delete` hints that output rows are stale until re-run; a `dataSource`
`delete` hints that it cascades to dependent pipelines; a `dashboard` `delete` hints the number of
panels it cascades to. This requirement replaces the base spec's "Impact hints are explicit and
source-grounded" — the `dataType`-delete unbind hint and the panel `config.dataTypeId` rebind hint
it also described no longer apply (see the REMOVED entry below); the pipeline/dataSource/dashboard
hints it also covered are unchanged and restated here.

#### Scenario: A dashboard delete surfaces its panel count
- **WHEN** a dashboard-delete edit targeting a dashboard with 3 panels is previewed
- **THEN** its `impact` includes a hint naming 3 as the number of cascaded panels

#### Scenario: An ordinary rename has no impact hint
- **WHEN** a dataSource-update edit that only renames the source is previewed
- **THEN** its `impact` is empty

## REMOVED Requirements

### Requirement: Preview also enforces the specific content-level checks apply would separately enforce
**Reason**: HEL-904 task 3.3 removed `dataType` from `PatchSetProtocol.recognizedKinds` outright — a
patch-set edit targeting `target.kind == "dataType"` is now rejected at parse, before it ever reaches
`preview`/`apply`'s per-kind content checks. `DataTypeService` itself no longer exists
(`find backend/src -name "DataTypeService*"` returns nothing) — there is no `applyUpdate`/`delete`
method left for `preview` to mirror. The panel/pipeline content checks this requirement also
described are unchanged and restated under "Preview enforces the panel/pipeline content-level checks
apply would separately enforce" above.
**Migration**: an agent that previously targeted `dataType` now targets `pipelineStep` (a
`dataType`'s computed-field expression is a `compute` pipeline step, task 2.9(g)) or, for the old
"delete a DataType" case, there is no equivalent operation — a pipeline's own Outputs are
cascade-deleted with the pipeline (`outputs.pipeline_id ON DELETE CASCADE`), not independently
deletable via a patch-set edit.

### Requirement: Impact hints are explicit and source-grounded
**Reason**: task 3.3 (as above) — `dataType` is not a recognized patch-set target kind, so no
dataType-delete edit ever reaches impact-hint computation. Additionally, task 4.1 removed the panel
`dataTypeId` binding (`domain/panels/TextPanel.scala`, `MarkdownPanel.scala`, `package.scala` all
record `dataTypeId`/`metricIdFormat` removed) — a `panel` `update` no longer has a `config.dataTypeId`
field to change, so the companion "panel bound to a different Output" impact hint this requirement
also described has no field left to detect a change on. The pipeline/dataSource/dashboard hints this
requirement also described are unchanged and restated under "Impact hints are explicit and
source-grounded for surviving edit kinds" above.
**Migration**: none — there is no equivalent hint in the outputs model; an Output's own
cascade-delete-with-pipeline behavior is already covered by the `pipeline`/`pipelineStep` staleness
hint above.
