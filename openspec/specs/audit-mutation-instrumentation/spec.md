# audit-mutation-instrumentation Specification

## Purpose
Defines which state-changing operations and auth events must produce an audit row, what that row
must contain, and the guarantee that emitting it never affects the outcome of the underlying
request.

## Requirements

### Requirement: Every resource mutation writes exactly one audit event
Creating, updating, or deleting a dashboard, panel, pipeline (including step/run submission), data
source, or data type SHALL write exactly one audit event carrying a `<resource>.<verb>` action
(e.g. `dashboard.create`, `panel.delete`, `pipeline.run.submit`), the affected `resource_type`, and
`resource_id`.

#### Scenario: Creating a dashboard writes one audit row
- **WHEN** a dashboard is created via the API
- **THEN** exactly one audit event is written with action `dashboard.create`, `resource_type`
  `dashboard`, and `resource_id` set to the new dashboard's id

#### Scenario: Deleting a panel writes one audit row
- **WHEN** a panel is deleted via the API
- **THEN** exactly one audit event is written with action `panel.delete`, `resource_type` `panel`,
  and `resource_id` set to the deleted panel's id

#### Scenario: Submitting a pipeline run writes one audit row
- **WHEN** a pipeline run is submitted via the API
- **THEN** exactly one audit event is written with action `pipeline.run.submit`, `resource_type`
  `pipeline`, and `resource_id` set to the pipeline's id

### Requirement: A mutation that creates nothing writes no audit row
Calling a create-style endpoint that resolves to an existing resource instead of creating a new one
SHALL write no `<resource>.create` audit event for that call.

#### Scenario: Creating a dashboard with an existing-name match writes no audit row
- **WHEN** a dashboard create request with `ifExists: "return"` matches an existing dashboard by
  name, so nothing is created
- **THEN** no `dashboard.create` audit event is written for that call

### Requirement: A batch mutation writes one audit row per API call, not one per item
Batch-creating or batch-updating multiple panels in a single API call SHALL write exactly one
audit event for that call, carrying the affected item count, not one event per item.

#### Scenario: Batch-creating panels writes one audit row
- **WHEN** N panels are created via the batch-create endpoint in a single API call
- **THEN** exactly one audit event is written with action `panel.batch_create` and a count of N in
  `metadata`
- **AND** no `panel.create` event is written for any individual panel in the batch

#### Scenario: Batch-updating panels writes one audit row
- **WHEN** N panels are updated via the batch-update endpoint in a single API call
- **THEN** exactly one audit event is written with action `panel.batch_update` and a count of N in
  `metadata`

### Requirement: Composite dashboard-content operations write one audit row per call
Replacing a dashboard's entire panel set, or importing a dashboard snapshot, SHALL each write
exactly one audit event for that call, not one event per affected panel.

#### Scenario: Replacing dashboard contents writes one audit row
- **WHEN** a dashboard's panel set is replaced via the contents-replace endpoint
- **THEN** exactly one audit event is written with action `dashboard.contents.replace`

#### Scenario: Importing a dashboard snapshot writes one audit row
- **WHEN** a dashboard is created from an imported snapshot payload
- **THEN** exactly one audit event is written with action `dashboard.import`, not `dashboard.create`

### Requirement: A composite operation writes one audit row per actor-initiated API call, not one per affected row
An operation that affects multiple database rows in a single actor-initiated call (duplicating a
dashboard and its panels, deleting a dashboard whose panels cascade-delete) SHALL write exactly one
audit event for that call, not one per affected row.

#### Scenario: Duplicating a dashboard writes one audit row, not one per copied panel
- **WHEN** a dashboard with N panels is duplicated via the API
- **THEN** exactly one audit event is written, with action `dashboard.duplicate` and
  `resource_id` set to the new dashboard's id
- **AND** no `panel.create` event is written for any of the N copied panels

#### Scenario: Deleting a dashboard writes one audit row, not one per cascade-deleted panel
- **WHEN** a dashboard with panels is deleted via the API (cascading panel deletion at the DB level)
- **THEN** exactly one audit event is written, with action `dashboard.delete`
- **AND** no `panel.delete` event is written for any cascade-deleted panel

### Requirement: An MFA-gated login is audited at the point a session is actually established
For a user with MFA enrolled, `auth.login` SHALL be recorded only when a session is actually
established, not when a login attempt merely triggers an MFA challenge.

#### Scenario: An MFA challenge does not itself write an `auth.login` row
- **WHEN** an MFA-enrolled user submits correct credentials and is challenged for a second factor
- **THEN** an audit event is written with action `auth.login.challenged`, not `auth.login`

#### Scenario: A successful MFA verification writes the `auth.login` row
- **WHEN** an MFA-enrolled user successfully completes MFA verification
- **THEN** exactly one audit event is written with action `auth.login`

#### Scenario: A failed MFA verification writes an `auth.login.failed` row
- **WHEN** an MFA-enrolled user fails MFA verification
- **THEN** an audit event is written with action `auth.login.failed`

### Requirement: A rolled-back partial mutation writes no false completion or undo row
When a composite operation creates a resource and then rolls that resource back due to a
later failure within the same call, the rollback SHALL NOT write an audit event asserting the
resource was deleted by an actor-initiated action.

#### Scenario: A failed dashboard proposal apply's rollback writes no `dashboard.delete` row
- **GIVEN** a dashboard proposal apply that successfully creates the dashboard but fails while
  creating one of its panels
- **WHEN** the apply rolls back by removing the partially-created dashboard
- **THEN** a `dashboard.create` audit event was written for the dashboard
- **AND** no `dashboard.delete` audit event is written for the rollback

### Requirement: Auth and token lifecycle events are audited
Successful and failed login, registration, logout, PAT creation, and PAT revocation SHALL each
write exactly one audit event with a stable `auth.*`/`token.*` action namespace.

#### Scenario: Successful login writes one audit row
- **WHEN** a user successfully logs in
- **THEN** exactly one audit event is written with action `auth.login`, actor set to the
  authenticated user

#### Scenario: Failed login writes one audit row with no secret material
- **WHEN** a login attempt fails
- **THEN** exactly one audit event is written with action `auth.login.failed`, a null actor user
  id, and `metadata` containing the attempted identifier (e.g. email) but no plaintext password or
  other secret

#### Scenario: PAT revocation writes one audit row
- **WHEN** an API token is revoked
- **THEN** exactly one audit event is written with action `token.revoke`, `resource_type` `token`,
  and `resource_id` set to the revoked token's id

### Requirement: MFA enrollment and disablement are audited
Confirming MFA enrollment, disabling MFA, and regenerating backup codes SHALL each write exactly
one audit event; starting (but not confirming) enrollment SHALL NOT.

#### Scenario: Confirming MFA enrollment writes one audit row
- **WHEN** a user successfully confirms MFA enrollment
- **THEN** exactly one audit event is written with action `auth.mfa.enable`

#### Scenario: Disabling MFA writes one audit row
- **WHEN** a user successfully disables MFA
- **THEN** exactly one audit event is written with action `auth.mfa.disable`

#### Scenario: Starting MFA enrollment writes no audit row
- **WHEN** a user starts (but does not confirm) MFA enrollment
- **THEN** no audit event is written for that call

### Requirement: An uploaded image is audited as its own resource, not a data source
Uploading an image via the direct image-upload endpoint SHALL write one audit event with action
`image_upload.create`, not `data_source.create` — an uploaded image has no data source id.

#### Scenario: Uploading an image writes one `image_upload.create` row
- **WHEN** an image is uploaded via the direct image-upload endpoint
- **THEN** exactly one audit event is written with action `image_upload.create` and `resource_id`
  set to the resulting image upload's id

### Requirement: Patch-set apply and undo write one row per underlying edit
Applying or undoing a patch set SHALL write one audit event per underlying per-resource edit it
performs, via the same per-resource actions each edited resource's own create/update/delete
already uses — not one collapsed row for the whole apply/undo call.

#### Scenario: Applying a multi-edit patch set writes one row per edit
- **WHEN** a patch set containing edits to 3 distinct resources is applied via the API
- **THEN** 3 audit events are written, each with the action appropriate to its own resource and
  operation (e.g. `panel.update`, `dashboard.create`)

### Requirement: Read traffic is never audited
No `GET` request or other read-only operation SHALL produce an audit event under this
instrumentation.

#### Scenario: Listing dashboards writes no audit row
- **WHEN** a caller lists or fetches dashboards
- **THEN** no audit event is written for that request

### Requirement: An audit write never changes the outcome of the request it describes
Emitting an audit event for a mutation SHALL NOT cause that mutation to fail, block, or return a
different result than it would have without instrumentation — reusing `AuditService.record`'s
existing never-fails contract (HEL-471) unmodified.

#### Scenario: A failing audit store does not fail the mutation
- **GIVEN** an `AuditService`/underlying store that fails to append
- **WHEN** a dashboard create request is made
- **THEN** the dashboard is created successfully and the API response is unaffected by the audit
  failure

### Requirement: A committed workspace teardown writes exactly one audit event
A tag-scoped workspace teardown (`POST /api/workspace/teardown`) that **commits** — defined as the
underlying transaction actually running (no blocking conflict, `dryRun` false), regardless of
whether the tag matched zero, some, or all resources — SHALL write exactly one audit event with
action `workspace.teardown`, `resource_type` `workspace`, and `resource_id` set to the tag. The
event's `metadata` SHALL carry `sourcesDeleted`, `pipelinesDeleted`, and `typesDeleted` counts,
which MAY all be zero when the tag matched no resources.

#### Scenario: A committed teardown writes one audit row with deletion counts
- **WHEN** a workspace teardown for a tag with no conflicts is submitted with `dryRun` unset/false
- **THEN** exactly one audit event is written with action `workspace.teardown`, `resource_type`
  `workspace`, `resource_id` equal to the tag, and `metadata` carrying the actual
  `sourcesDeleted`/`pipelinesDeleted`/`typesDeleted` counts

#### Scenario: A committed teardown of a tag matching nothing still writes one audit row
- **WHEN** a workspace teardown is submitted for a tag that matches zero resources, with `dryRun`
  unset/false and no blocking conflict
- **THEN** exactly one audit event is written with action `workspace.teardown` and `metadata`
  carrying all three deletion counts as `0`

### Requirement: A dry-run or blocked teardown writes no audit row
Neither a `dryRun` teardown request nor a teardown that is blocked by a resource conflict (and
therefore deletes nothing) SHALL write a `workspace.teardown` audit event, since no destruction
occurred.

#### Scenario: A dry-run teardown writes no audit row
- **WHEN** a workspace teardown is submitted with `dryRun: true`
- **THEN** no `workspace.teardown` audit event is written

#### Scenario: A blocked teardown writes no audit row
- **WHEN** a workspace teardown for a tag with a shared/blocking resource is submitted and the
  repository reports the call as blocked
- **THEN** no `workspace.teardown` audit event is written

### Requirement: A first-time Google OAuth signup writes an auth.register event
`AuthService.completeOAuth` SHALL write an `auth.register` audit event, in addition to its existing
login-outcome event, when the underlying `upsertGoogleUser` call creates a new account. A returning
Google login (an existing account) SHALL write no `auth.register` event.

#### Scenario: First-time Google signup writes both auth.register and a login row
- **WHEN** a Google OAuth exchange completes for an email/googleId with no existing account
- **THEN** exactly one `auth.register` audit event is written, and exactly one login-outcome event
  (`auth.login` or `auth.login.challenged`) is also written

#### Scenario: Returning Google login writes no auth.register row
- **WHEN** a Google OAuth exchange completes for an email/googleId that already has an account
- **THEN** no `auth.register` audit event is written, and exactly one login-outcome event is
  written

### Requirement: DataSourceService.refresh writes exactly one audit event per call, on success only
`DataSourceService.refresh` SHALL write exactly one audit event with action `data_source.refresh`
for a successful refresh, regardless of which source kind (static, csv, text, pdf, image) it
dispatched to. A failed refresh SHALL write no audit event.

#### Scenario: A successful refresh of any source kind writes exactly one row
- **WHEN** `DataSourceService.refresh` is called for a static, csv, text, pdf, or image source and
  the underlying refresh succeeds
- **THEN** exactly one audit event is written with action `data_source.refresh`, `resource_type`
  `data_source`, and `resource_id` equal to the source id

#### Scenario: A failed refresh writes no audit event
- **WHEN** `DataSourceService.refresh` is called and the underlying refresh fails
- **THEN** no `data_source.refresh` audit event is written for that call

### Requirement: SourceService.refresh writes exactly one audit event per call, on success only
`SourceService.refresh` SHALL write exactly one audit event with action `data_source.refresh` for a
successful refresh, for both sql and rest sources. A failed refresh SHALL write no audit event.

#### Scenario: A successful sql or rest refresh writes exactly one row
- **WHEN** `SourceService.refresh` is called for a sql or rest source and the underlying refresh
  succeeds
- **THEN** exactly one audit event is written with action `data_source.refresh`, `resource_type`
  `data_source`, and `resource_id` equal to the source id

#### Scenario: A failed sql or rest refresh writes no audit event
- **WHEN** `SourceService.refresh` is called and the underlying refresh fails
- **THEN** no `data_source.refresh` audit event is written for that call
