# patch-set-preview Specification

## Purpose
Lets a caller preview a patch set's before/after diff and downstream impact hints (stale rows,
unbinding, cascading deletes) without writing anything, reusing the same pre-validation and
content checks the apply path enforces so a caller can review exactly what accepting the patch
set will do.

## Requirements

### Requirement: PatchSetPreviewService computes a before/after diff without writing
`PatchSetPreviewService.preview(patchSet, user)` SHALL reuse `PatchSetApplyResolvers.resolveAll`
for target/ACL/shape pre-validation, unmodified. It SHALL perform NO repository writes anywhere in
its computation (reads, including the content checks named below, are permitted).

#### Scenario: Preview computes a diff for a valid patch set
- **WHEN** `preview` is called with a patch set whose edits all pre-validate successfully
- **THEN** it returns a per-edit diff, and no resource named in the patch set is mutated

#### Scenario: An invalid patch set is rejected identically to apply
- **WHEN** `preview` is called with a patch set that `PatchSetApplyResolvers.resolveAll` itself
  would reject (e.g. an edit targeting an inaccessible resource)
- **THEN** `preview` rejects the same way `apply` would, and nothing is mutated

### Requirement: before reuses the captured prior state; after is computed purely
`EditPreview.before` SHALL equal the same `priorState` a corresponding `apply` call's
`EditOutcome` would carry — `None` for a `create` edit. `EditPreview.after` SHALL be `None` for a
`delete` edit, and for `update`/`create` edits SHALL be computed via a pure, in-memory projection
using the same shared functions the real update/create paths use, serialized in the SAME response
shape `apply`'s `resultingState` would use.

#### Scenario: An update edit's after state matches the real response shape
- **WHEN** a panel-update edit is previewed
- **THEN** its `after` equals the same `PanelResponse` JSON shape a real `apply` call's
  `resultingState` would carry, computed without writing to the database

#### Scenario: A create edit's after state uses a pending-id sentinel
- **WHEN** a panel-create edit is previewed
- **THEN** its `after` carries the literal id sentinel `"(pending)"`, never a value that could be
  mistaken for a real, minted id

#### Scenario: A delete edit has no after state
- **WHEN** a panel-delete edit is previewed
- **THEN** its `after` is `None`

### Requirement: POST /api/patch-sets/preview
The backend SHALL expose `POST /api/patch-sets/preview`, accepting a `PatchSet` body and
returning a `PatchSetPreviewResponse`. The route SHALL perform no writes and SHALL be RLS-enforced
identically to `POST /api/patch-sets/apply`.

#### Scenario: Preview never mutates any resource
- **WHEN** `POST /api/patch-sets/preview` is called with any valid patch set
- **THEN** the response contains the computed diff, and a subsequent read of every resource named
  in the patch set shows it unchanged

### Requirement: A successful Accept SHALL offer an Undo action that does not auto-dismiss
`PatchSetReviewPage`'s Accept flow SHALL, on a successful apply that returns an `applicationId`,
show an actionable, non-auto-dismissing "Undo" affordance before navigating away.

#### Scenario: Accepting a patch set offers Undo
- **WHEN** the user clicks Accept and the apply call returns an `applicationId`
- **THEN** a toast notification appears with an "Undo" action bound to that `applicationId`, before
  the page navigates back to the dashboard

#### Scenario: The Undo toast does not disappear on its own
- **WHEN** the Undo toast from a successful Accept has been visible for longer than the shared
  toast system's default auto-dismiss duration
- **THEN** it is still visible — only an explicit user dismissal, or a later toast replacing it,
  removes it

#### Scenario: Clicking Undo calls the undo endpoint
- **WHEN** the user clicks the "Undo" action on that toast
- **THEN** the app calls `POST /api/patch-sets/:id/undo` with that application's id

#### Scenario: An apply with no applicationId shows no Undo action
- **WHEN** the apply call succeeds but returns no `applicationId` (nothing was journaled)
- **THEN** no "Undo" action is offered

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
source-grounded" — the `dataType`-delete unbind hint and the panel `config.outputId` rebind hint
it also described no longer apply (see the REMOVED entry below); the pipeline/dataSource/dashboard
hints it also covered are unchanged and restated here.

#### Scenario: A dashboard delete surfaces its panel count
- **WHEN** a dashboard-delete edit targeting a dashboard with 3 panels is previewed
- **THEN** its `impact` includes a hint naming 3 as the number of cascaded panels

#### Scenario: An ordinary rename has no impact hint
- **WHEN** a dataSource-update edit that only renames the source is previewed
- **THEN** its `impact` is empty

### Requirement: Patch-set preview shows Output-level diffs
Previewing an unapplied patch-set SHALL show its effect at the level of Outputs and placements
(added/removed/modified), not DataType/panel-binding diffs.

#### Scenario: Previewing a patch-set shows an Output being added
- **WHEN** a patch-set adding a new Output to an existing pipeline is previewed before apply
- **THEN** the preview shows that Output as an addition, including its target node and
  `fieldMapping`

### Requirement: Preview resolves Output update and delete without error or writes
`POST /api/patch-sets/preview` SHALL return, for `output` `update` and `delete` edits, the same resolution outcomes as apply's pre-validation and SHALL NOT return 500 or write any row.

#### Scenario: Owned output update previews
- **WHEN** an owner previews an `update` edit renaming an Output they own
- **THEN** the response is 200 and the edit's diff has `before` = the prior Output (including config) and `after` = that Output with the name/config patch applied, and no row changes

#### Scenario: Owned output delete previews
- **WHEN** an owner previews a `delete` edit for an Output they own
- **THEN** the response is 200, `before` is the prior Output and `after` is null, and no row changes

#### Scenario: Foreign and absent output ids are indistinguishable
- **WHEN** a non-owner previews an output update/delete for an Output they cannot see, and another caller previews one for a nonexistent id
- **THEN** both responses are 404 with byte-identical bodies

### Requirement: Preview and apply agree on pipelineStep delete prior state
A previewed `pipelineStep` delete SHALL report `boundOutputs` in its prior state exactly as apply's does.

#### Scenario: Step delete with a bound Output
- **WHEN** a pipelineStep with a bound Output is previewed for delete
- **THEN** its prior state `boundOutputs` equals what apply captures

### Requirement: Preview context parity with apply
The `PatchSetApplyContext` built for preview SHALL have every collaborator non-null and supplied; a collaborator absent from the preview context SHALL fail a structural test.

#### Scenario: New context field
- **WHEN** a field is added to `PatchSetApplyContext` and preview does not wire it
- **THEN** the parity test fails

### Requirement: Dashboard-update preview drops ghost layout items like apply
Previewing a dashboard `update` edit SHALL restrict both the stored layout and every supplied layout breakpoint to the
dashboard's current panels before resolving and validating the layout, exactly as applying the same edit does, so the
preview's `after` never shows a layout item that apply would drop.

#### Scenario: A stored ghost is absent from the preview
- **WHEN** a dashboard's stored layout holds an item for a panel no longer on the dashboard and an appearance-only
  update of that dashboard is previewed
- **THEN** the preview's `after.layout` contains no item for that panel, matching apply's `resultingState`

#### Scenario: A supplied ghost item is dropped, not validated
- **WHEN** a previewed dashboard update supplies a breakpoint containing an item for a panel not on the dashboard,
  overlapping a live item
- **THEN** the preview succeeds and its `after.layout` omits that item, as apply would

### Requirement: Preview is cumulative across the edits of one patch set
Patch-set preview SHALL project each edit against the state produced by the earlier edits of the same patch set, as
apply would execute them in order: an edit's `after` SHALL equal what apply returns as that edit's resulting state
(ignoring server-assigned ids and timestamps), the dashboard-delete impact count SHALL reflect panels created or
removed by earlier edits, and an edit that apply would fail because an earlier edit deleted (directly or by cascade)
its target or a resource it references, or moved the dashboard's layout version past an `expectedLayoutVersion` it
carries, SHALL fail the whole preview with the same error class. Each edit's `before` and target fingerprint SHALL
remain the pre-apply state, matching apply's `priorState` and stale check.

#### Scenario: Panel delete then dashboard rename
- **WHEN** a patch set deletes a panel of dashboard D and then renames D
- **THEN** the rename's preview `after.layout` has no items for the deleted panel, equal to apply's resulting state

#### Scenario: Panel create then dashboard appearance update
- **WHEN** a patch set creates a panel on D and then updates D's appearance
- **THEN** the update's preview `after.layout` includes the new panel's placement in every breakpoint at the
  position apply assigns

#### Scenario: Two updates of the same target
- **WHEN** a patch set updates a panel's title and then the same panel's appearance
- **THEN** the second edit's preview `after.title` is the new title

#### Scenario: Update of a target an earlier edit deleted
- **WHEN** a patch set deletes a panel and then updates the same panel
- **THEN** preview fails with a not-found error instead of returning an `after`

#### Scenario: Stale expected layout version after an earlier layout change
- **WHEN** a patch set creates a panel on D and then updates D's layout with `expectedLayoutVersion` equal to D's
  version before the patch set
- **THEN** preview fails with a layout conflict

#### Scenario: Fingerprints unaffected by earlier edits
- **WHEN** a patch set edits the same target twice and is applied with the fingerprints preview returned
- **THEN** apply does not report the patch set stale

### Requirement: pipelineStep update preview resolves for every registered step kind
A `POST /api/patch-sets/preview` containing a `pipelineStep` `update` edit SHALL resolve for every step kind registered in `PipelineStep.Registry`: a position-only update and a valid config update SHALL each return 200 with an `after` reflecting the requested position/config, never a 500 and never a 400 claiming a config/kind type mismatch. The preview's acceptance SHALL agree with apply's for the same edit.

#### Scenario: Position-only update of a convertformat, analyzewithai or generatetext step
- **WHEN** a patch set updating only the `position` of an existing `convertformat`, `analyzewithai` or `generatetext` step is previewed
- **THEN** the response is 200 and the edit's `after` carries that step's `type`, its unchanged config, and the requested position

#### Scenario: Config update of a convertformat, analyzewithai or generatetext step
- **WHEN** a patch set replacing the `config` of such a step with a valid config of the same kind is previewed
- **THEN** the response is 200 and the edit's `after.config` equals the requested config

#### Scenario: A newly registered step kind without a projection arm
- **WHEN** a step kind is added to `PipelineStep.Registry` without a matching arm in the preview projection
- **THEN** the backend test suite fails, naming the kind
