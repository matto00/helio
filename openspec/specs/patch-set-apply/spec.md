# patch-set-apply Specification

## Purpose
Applies a reviewed `PatchSet` (HEL-403) atomically — pre-validating every edit's target access and
embedded cross-resource references before any mutation, applying each via the existing
per-resource services only, and rolling back every already-applied edit on failure — the mutation
primitive the conversational-refinement diff-preview and undo work builds on.

## Requirements

### Requirement: PatchSetApplyService applies edits atomically
`PatchSetApplyService.apply(patchSet, user)` SHALL pre-validate every edit (target exists and is
accessible per the SAME access rule its own kind's real update/delete path enforces for that
SPECIFIC op — not merely a same-named repository lookup, and not assumed identical between update
and delete for a kind where the two genuinely diverge — and `patch` decodes to the shape its
`(kind, op)` requires) before mutating anything. If any edit fails pre-validation, NOTHING is
mutated. Edits SHALL apply in the caller's given order via existing per-resource services only —
no direct repository writes.

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

### Requirement: Pre-validation also authorizes resources referenced inside a patch, not only the top-level target
Pre-validation SHALL also authorize a SECOND, separately-owned resource referenced from inside an
edit's `patch`/`createPatch`, wherever its real create/update path also authorizes one — not defer
that check to forward-apply time. This covers: `panel` `create` (`dashboardId`), `pipeline`
`create` (`sourceDataSourceId`), `panel` `update`/`create` (`outputId`/`metricId`, when present
in the config patch), and `pipelineStep` `update` (a `JoinConfig`/`UnionConfig`/`LookupConfig`'s
`secondaryInput`, when it is `source`-kind and present).

For a `pipelineStep` `update`, "present" SHALL mean a `source`-kind `secondaryInput` with a non-empty `dataSourceId`, uniformly across all three config types. An empty `dataSourceId` is an incomplete draft rather than a reference to an inaccessible resource, and SHALL NOT trigger the ownership lookup or its `404` — matching the create/update route behavior these checks exist to mirror. A `lane`-kind `secondaryInput` references a node in the same pipeline and SHALL NOT trigger a data-source ownership lookup at all; it SHALL instead be validated for same-pipeline membership and acyclicity. The legacy flat fields SHALL NOT appear in this contract, and a patch set supplying one SHALL be rejected with a named error rather than coerced.

#### Scenario: A pipelineStep-update edit referencing a foreign-owned source-kind input is rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `secondaryInput` is `source`-kind naming a data source the caller does not own
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything

#### Scenario: A pipelineStep-update edit with an empty dataSourceId is not rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `source`-kind `secondaryInput` has an empty `dataSourceId`
- **THEN** pre-validation performs no ownership lookup for that id and does not reject the patch set on its account

#### Scenario: A lane-kind secondary input performs no data-source lookup
- **WHEN** a patch set includes a `pipelineStep` update edit whose `secondaryInput` is `lane`-kind naming a step in the same pipeline
- **THEN** pre-validation performs no data-source ownership lookup and does not reject the patch set on that account

#### Scenario: A patch set carrying a legacy flat field is rejected
- **WHEN** a patch set supplies a `pipelineStep` edit whose config contains `rightDataSourceId`
- **THEN** apply fails with a named error identifying the invalid config shape, and no step is created or updated

#### Scenario: A panel-create edit referencing an inaccessible dashboard is rejected pre-apply
- **WHEN** a patch set includes a panel-create edit whose decoded `dashboardId` names a dashboard
  the caller has no ownership or sharing grant on
- **THEN** pre-validation rejects the whole patch set, and no other edit in the set is applied —
  including a preceding panel-delete edit that would otherwise have already succeeded

#### Scenario: A panel-update edit binding to an owned companion DataType is rejected pre-apply
- **WHEN** a patch set includes a panel-update edit whose config patch sets `outputId` to a
  DataType the caller OWNS but which is a companion (non-pipeline-output) type
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything — mirroring
  `rejectCompanionBinding`'s real rule exactly: a foreign-owned or nonexistent `outputId` is NOT
  rejected by this specific check (it passes through unchanged, matching
  `PanelService.update`'s own documented behavior); only an OWNED companion-type binding is

#### Scenario: A panel-update edit referencing a foreign-owned metricId is rejected pre-apply
- **WHEN** a patch set includes a panel-update edit whose config patch sets `metricId` to a metric
  the caller does not own (or that doesn't resolve at all)
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything — unlike
  `outputId`, `rejectUnresolvableMetric` DOES actively reject a foreign/nonexistent reference

#### Scenario: A pipelineStep-update edit referencing a foreign-owned join right-source is rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `JoinConfig.secondaryInput` is source-kind
  naming a data source the caller does not own
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything

#### Scenario: A pipelineStep-update edit with an empty second-source id is not rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `JoinConfig`/`UnionConfig`/`LookupConfig`
  `secondaryInput` is source-kind with an empty `dataSourceId`
- **THEN** pre-validation performs no ownership lookup for that id and does not reject the patch
  set on its account

### Requirement: A failure rolls back every already-applied edit
When an edit fails partway through an otherwise-pre-validated apply, `PatchSetApplyService` SHALL
walk the edits already applied, in reverse order, compensating each: a `create` is undone by
deleting the created resource; an `update` is undone by reapplying its captured full prior state
as a complete inverse update through the same per-resource service; a `delete` is compensated per
the per-kind rollback requirement below.

#### Scenario: A mid-set failure rolls back a mixed panel/dashboard patch set
- **WHEN** a patch set applies a panel update, then a panel delete, then a dashboard update that
  fails
- **THEN** the panel's earlier update is reverted, the deleted panel's content is recreated (under
  a new id — see the per-kind rollback requirement below), and the dashboard is unchanged, so
  every touched resource's CONTENT matches its state before `apply` was called

### Requirement: Create is rejected pre-validation where no viable path exists
`create` SHALL be rejected at pre-validation for `dataType` (no direct create API exists) and for
`pipelineStep` (no field on `EditTarget` carries the new step's parent pipeline id). A
dashboard-create edit whose decoded `patch` sets `ifExists` SHALL also be rejected — this contract
only ever creates, never idempotently returns an existing dashboard.

#### Scenario: A create edit targeting dataType is rejected
- **WHEN** `apply` is called with an edit whose `target.kind` is `dataType` and `op` is `create`
- **THEN** pre-validation rejects the whole patch set with a message naming the unsupported
  combination, and nothing is mutated

#### Scenario: A dashboard create edit requesting ifExists is rejected
- **WHEN** `apply` is called with a dashboard-create edit whose `patch` includes
  `ifExists: "return"`
- **THEN** pre-validation rejects the whole patch set, and nothing is mutated

### Requirement: Delete-rollback is per-kind, and never silently overclaims success
Rolling back a `delete` edit for `panel` or `pipelineStep` SHALL recreate the resource's content
via the existing create path, reported as `recreated` with the new id (the original id is not
restored — no existing API accepts a caller-specified id). For `dashboard`/`dataSource`/
`dataType`/`pipeline`, delete-rollback SHALL be reported `unrecoverable` — no recreate is
attempted, since doing so would either be impossible (`dataType`) or require duplicating another
service's own multi-step composition rather than genuinely restoring cascaded state.

#### Scenario: A recreated delete-rollback reports the new id
- **WHEN** a panel delete is rolled back due to a later failure
- **THEN** the response marks that edit `recreated` and includes the newly-created panel's id,
  distinct from the original

#### Scenario: An unrecoverable delete rollback is reported, not hidden
- **WHEN** a patch set deletes a dataType, then a later edit fails, triggering rollback
- **THEN** the response marks the dataType-delete edit `unrecoverable` and includes the original
  failure — it never claims the dataType was restored

### Requirement: Prior-state capture is emitted in a shape a future undo path can consume
For every `update`/`delete` edit, `EditOutcome.priorState` SHALL carry the resource's full
pre-mutation state, serialized using that kind's EXISTING response shape (`PanelResponse`/
`DashboardResponse`/`DataSourceResponse`/`DataTypeResponse`/`PipelineSummaryResponse`/
`PipelineStepResponse`) — never a new, undo-specific format. `create`-op edits carry
`priorState = None`. This SHALL be populated independent of the edit's final `status`, including
for an `unrecoverable` delete-rollback, so a future undo path has the raw material to work from
even where this ticket's own rollback cannot fully restore the resource itself.

#### Scenario: An update edit's prior state matches the resource's existing response shape
- **WHEN** a panel-update edit is applied
- **THEN** its `EditOutcome.priorState` equals the same `PanelResponse` JSON shape
  `GET`/`PATCH /api/panels/:id` already returns, populated with the panel's state before the update

#### Scenario: A create edit has no prior state
- **WHEN** a panel-create edit is applied
- **THEN** its `EditOutcome.priorState` is absent/`None` — nothing existed before a create

#### Scenario: An unrecoverable delete's prior state is still captured
- **WHEN** a dataType-delete edit's rollback is reported `unrecoverable`
- **THEN** its `EditOutcome.priorState` still carries the dataType's pre-delete `DataTypeResponse`
  — prior-state capture does not depend on whether this ticket's own rollback can restore it

#### Scenario: A pipeline edit's prior state uses the joined summary shape
- **WHEN** a pipeline-update edit is applied
- **THEN** its `EditOutcome.priorState` equals the joined `PipelineSummaryResponse` shape
  (including `sourceDataSourceName`/`outputDataTypeName`), not merely the bare `Pipeline`
  id-only fields the ACL check alone would have read

### Requirement: Resulting-state capture is emitted for create/update and recreated-delete edits
`EditOutcome.resultingState` SHALL carry the resource's full post-mutation state for every
successful `create`/`update` edit and for a `recreated` delete-rollback, using the SAME per-kind
response shapes `priorState` uses. A plain (non-rolled-back) `delete`, and an `unrecoverable`
delete-rollback, SHALL carry `resultingState = None`.

#### Scenario: A create edit's resulting state includes the new resource
- **WHEN** a panel-create edit is applied
- **THEN** its `EditOutcome.resultingState` equals the created panel's `PanelResponse`, including
  its newly-minted id

#### Scenario: A plain delete edit has no resulting state
- **WHEN** a panel-delete edit is applied and never rolled back
- **THEN** its `EditOutcome.resultingState` is absent/`None` — the panel no longer exists

#### Scenario: A recreated delete-rollback's resulting state is the recreated resource
- **WHEN** a panel-delete edit is rolled back and reported `recreated`
- **THEN** its `EditOutcome.resultingState` equals the newly-recreated panel's `PanelResponse`

### Requirement: POST /api/patch-sets/apply
The backend SHALL expose `POST /api/patch-sets/apply`, accepting a `PatchSet` body and returning a
`PatchSetApplyResponse` with a per-edit outcome. The route SHALL be RLS-enforced: an edit targeting
a resource the caller cannot access is rejected during pre-validation, identically to the
corresponding existing PATCH/DELETE endpoint's own access rule.

#### Scenario: A cross-owner, no-grant edit is rejected pre-apply
- **WHEN** a patch set includes an edit targeting a resource the caller has no ownership or
  sharing grant on
- **THEN** the request is rejected before any mutation, with the same access-denial behavior the
  resource's own existing PATCH/DELETE route would give

### Requirement: A successful patch-set application SHALL be journaled with its prior state
`PatchSetApplyService.apply` SHALL persist an owner-scoped application record — every applied edit's
target kind, op, prior state, and resulting state — whenever the response reports no `failure`, and
SHALL persist nothing when a `failure` is present. The response SHALL carry an additive
`applicationId` field, present exactly when a record was journaled.

#### Scenario: A fully successful apply is journaled
- **WHEN** `POST /api/patch-sets/apply` returns a response with no `failure`
- **THEN** the response includes a new `applicationId`, and an owner-scoped application record
  exists containing every edit's target/op/prior/resulting state

#### Scenario: A partially rolled-back apply is not journaled
- **WHEN** `POST /api/patch-sets/apply` returns a response with a `failure` present (a mid-set edit
  failed and prior edits were compensated)
- **THEN** the response's `applicationId` is absent, and no application record is created

#### Scenario: A caller that ignores applicationId sees no behavior change
- **WHEN** `POST /api/patch-sets/apply` is called by a client that does not read the new
  `applicationId` field
- **THEN** every other field and every existing status code the response already returns is
  byte-for-byte unchanged from before this change

### Requirement: A journaled panel edit SHALL also capture a raw, unmaterialized config snapshot, journal-only
The journal SHALL, for a `panel` `update` edit only, additionally capture the panel's raw
(unmaterialized) post-apply config — the same value a bare, non-metric-resolving read of that panel
would return — distinct from the materialized `resultingState` already captured for every kind. This
raw config SHALL exist only in the journal, never as a field on `EditOutcome` or anywhere in the
`POST /api/patch-sets/apply` response body.

#### Scenario: A metric-bound panel's journaled raw config differs from its materialized response
- **WHEN** a panel edit updates a `OutputPanel` bound to `metricId`
- **THEN** the journal's raw config for that edit carries the panel's own stored field values, not
  the bound metric's currently-effective values that the same edit's materialized `resultingState`
  carries

#### Scenario: The raw config never appears on the apply response
- **WHEN** `POST /api/patch-sets/apply` successfully applies a panel update edit
- **THEN** the response's corresponding `EditOutcome` has exactly the same fields it had before this
  change — no raw-config field is present anywhere in the response body

### Requirement: Applying a pipeline-step patch preserves PipelineStep.enabled
Applying a patch-set operation that adds, removes, or modifies a `PipelineStep` SHALL preserve
that step's `enabled` field exactly as specified by the operation, with no implicit default —
fixing HEL-766, where `PatchSetApplyRollback`'s inverse builders (`fullPipelineStepInverse`,
`pipelineStepCreateRequestFromPrior`) omitted `enabled`, silently falling through to
`CreatePipelineStepRequest.enabled`'s `None` default.

#### Scenario: Modify-patch on a disabled step keeps it disabled after apply
- **WHEN** a patch-set modifies a `PipelineStep` that is currently `enabled: false` without an
  explicit `enabled` change
- **THEN** the step remains `enabled: false` after the patch is applied
