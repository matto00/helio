## MODIFIED Requirements

### Requirement: PatchSetApplyService applies edits atomically
A pipeline `create` edit target SHALL carry `roots` in place of a scalar `sourceDataSourceId`. Prior-state and resulting-state capture for such an edit SHALL record the full root set, so an undo restores every root rather than a single source binding.

#### Scenario: Undo of a two-root pipeline create removes both roots
- **WHEN** a patch set that created a two-root pipeline is undone
- **THEN** the pipeline, both roots, and their steps and Outputs are removed

#### Scenario: A mixed patch set applies cleanly
- **WHEN** `apply` is called with a panel-update edit, a panel-delete edit, and a dashboard-update
  edit, all pre-validating successfully
- **THEN** all three edits are applied in order and the response reports each as `applied`

#### Scenario: An invalid edit changes nothing
- **WHEN** `apply` is called with a patch set whose second edit targets a nonexistent or
  not-accessible resource
- **THEN** no edit is applied — every resource named in the patch set is unchanged

#### Scenario: An editor grantee's update edit is accepted, matching the real PATCH route
- **WHEN** `apply` is called with a panel-update edit targeting a panel on a dashboard the caller
  has Editor (not Owner) access to
- **THEN** pre-validation accepts the edit — the same outcome `PATCH /api/panels/:id` would give
  that caller

#### Scenario: An editor grantee's dashboard-delete edit is rejected, matching the real DELETE route
- **WHEN** `apply` is called with a dashboard-delete edit targeting a dashboard the caller has
  Editor (not Owner) access to
- **THEN** pre-validation rejects the edit — dashboard delete is owner-only, unlike dashboard
  update, and `DELETE /api/dashboards/:id` would reject that same caller with the same access
  denial

