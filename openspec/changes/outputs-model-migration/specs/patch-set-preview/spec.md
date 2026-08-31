## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Preview also enforces the specific content-level checks apply would separately enforce
Beyond `resolveAll`'s target/ACL/shape gate, `preview` SHALL reject a patch set identically to how
`apply` would for each of the following content-level checks, so a preview-clean patch set is not
falsely reported clean: a panel-update edit with a blank title or a cross-type PATCH (mirrors
`PanelServiceHelpers.resolvePatch`); a panel-update edit combining `chartType: "scatter"` with a
set `aggregation` (mirrors `PanelService.validateScatterAggregationConflict`); a pipeline-rename
edit with a blank `name` (mirrors `PipelineService.updateName`); a dataType-update edit with a
computed-field expression that is too long or fails validation (mirrors
`DataTypeService.applyUpdate`); a dataType-delete edit targeting a DataType with a panel OWNED by
the deleting user bound to it, or targeting a source-companion DataType (mirrors
`DataTypeService.delete`'s two conflict checks). This list is the SPECIFIC set of gaps found
between `resolveAll` and the real per-kind service methods at ticket delivery time — not a claim
that every future service-side validation is automatically covered (design.md Risks).

#### Scenario: A blank-title panel update is rejected, not silently previewed as valid
- **WHEN** `preview` is called with a panel-update edit whose `patch.title` is blank
- **THEN** `preview` rejects the whole call with the same error `PATCH /api/panels/:id` would give

#### Scenario: A DataType delete blocked by an owned bound panel is rejected, not hinted
- **WHEN** `preview` is called with a dataType-delete edit targeting a DataType a panel OWNED by
  the caller is bound to
- **THEN** `preview` rejects the whole call with the same `Conflict` `DELETE /api/types/:id` would
  give — this is NOT surfaced merely as an impact hint

### Requirement: Impact hints are explicit and source-grounded
`EditPreview.impact` SHALL surface the following cascade/staleness consequences, each backed by a
real backend behavior, and SHALL be empty for any edit with no such consequence: a `pipeline`/
`pipelineStep` `update`/`delete` hints that output rows are stale until re-run; a `dataSource`
`delete` hints that it cascades to dependent pipelines; a `dataType` `delete` — ONLY when the
content check above did not already reject the whole call, and ONLY when a bound panel is visible
to the caller under the SAME RLS scoping every other read in this system already applies — hints
that a panel is bound and will be unbound (the app-level owned-panel check cannot see cross-owner
bindings, so this is the one case `apply` does not reject); a `dashboard` `delete` hints the
number of panels it cascades to; a `panel` `update` that changes `config.dataTypeId` hints that
the panel will be bound to a different Output/node. The dataType-delete hint's detection SHALL be
RLS-scoped (the same visibility a caller's own reads already respect), never a privileged query
that could reveal an unrelated tenant's private resource's existence to the caller.

#### Scenario: A dataType delete with a visible cross-owner-shared bound panel surfaces an unbind hint
- **WHEN** a dataType-delete edit is previewed, and a panel bound to it lives on a dashboard the
  caller can access (as owner or via a sharing grant) but is owned by a different user
- **THEN** its `impact` includes a hint that a bound panel will be unbound, not deleted — this
  case does NOT reject the whole call, unlike an owned bound panel

#### Scenario: A dataType delete with an invisible cross-owner bound panel surfaces no hint
- **WHEN** a dataType-delete edit is previewed, and the only bound panel lives on a dashboard the
  caller cannot access at all
- **THEN** its `impact` does not surface an unbind hint for that panel — the hint's detection is
  scoped to what the caller can already see, never a privileged, caller-invisible lookup

#### Scenario: A dashboard delete surfaces its panel count
- **WHEN** a dashboard-delete edit targeting a dashboard with 3 panels is previewed
- **THEN** its `impact` includes a hint naming 3 as the number of cascaded panels

#### Scenario: An ordinary rename has no impact hint
- **WHEN** a dataSource-update edit that only renames the source is previewed
- **THEN** its `impact` is empty
