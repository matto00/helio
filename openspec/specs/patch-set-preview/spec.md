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
source-grounded" — the `dataType`-delete unbind hint and the panel `config.dataTypeId` rebind hint
it also described no longer apply (see the REMOVED entry below); the pipeline/dataSource/dashboard
hints it also covered are unchanged and restated here.

#### Scenario: A dashboard delete surfaces its panel count
- **WHEN** a dashboard-delete edit targeting a dashboard with 3 panels is previewed
- **THEN** its `impact` includes a hint naming 3 as the number of cascaded panels

#### Scenario: An ordinary rename has no impact hint
- **WHEN** a dataSource-update edit that only renames the source is previewed
- **THEN** its `impact` is empty
