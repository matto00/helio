## ADDED Requirements

### Requirement: Join secondary-input ownership is checked only for source-kind inputs, on creation
The backend SHALL verify that a `join` step's `config.secondaryInput`, when it is `source`-kind with a non-empty `dataSourceId`, refers to a data source owned by the authenticated caller on `POST /api/pipelines/:id/steps`. If the source does not exist or is not owned by the caller, the response SHALL be `404 Not Found` (existence-not-leaked semantics) and the step SHALL NOT be persisted. An empty `dataSourceId` is an incomplete draft and SHALL NOT trigger the check. A `lane`-kind `secondaryInput` SHALL NOT be routed into this check at all, and SHALL NOT be treated as a `source`-kind input with an absent or empty id.

#### Scenario: Cross-user source-kind join creation returns 404
- **WHEN** user A creates a `join` step whose `source`-kind `secondaryInput` names a data source owned by user B
- **THEN** the response is `404 Not Found` and no step row is inserted

#### Scenario: Own-source join creation succeeds
- **WHEN** user A creates a `join` step whose `source`-kind `secondaryInput` names a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step

#### Scenario: Non-existent source-kind reference returns 404
- **WHEN** a `join` step is created whose `source`-kind `secondaryInput` names a data source that does not exist
- **THEN** the response is `404 Not Found` and no step row is inserted

#### Scenario: Empty dataSourceId join creation succeeds
- **WHEN** a `join` step is created with `{"kind": "source", "dataSourceId": ""}`
- **THEN** creation succeeds with the second source unset and no ownership check runs

#### Scenario: Lane-kind input bypasses the source ownership check entirely
- **WHEN** a `join` step is created with a `lane`-kind `secondaryInput`
- **THEN** no data-source ownership lookup is performed
- **THEN** the request is not rejected on data-source ownership grounds

### Requirement: Join secondary-input ownership is checked only for source-kind inputs, on update
The backend SHALL apply the same `source`-kind ownership verification on `PATCH /api/pipeline-steps/:id`, with the same `404` semantics, the same empty-`dataSourceId` incomplete-draft exemption, and the same total exemption for a `lane`-kind `secondaryInput`.

#### Scenario: Cross-user source-kind update returns 404
- **WHEN** user A updates a `join` step's `secondaryInput` to a `source`-kind reference owned by user B
- **THEN** the response is `404 Not Found` and the step is not updated

#### Scenario: Own-source update succeeds
- **WHEN** user A updates a `join` step's `secondaryInput` to a `source`-kind reference owned by user A
- **THEN** the update succeeds

#### Scenario: Clearing the source back to empty on update stays allowed
- **WHEN** a `join` step's `secondaryInput` is updated to `{"kind": "source", "dataSourceId": ""}`
- **THEN** the update succeeds and no ownership check runs

#### Scenario: Updating to a lane-kind input performs no ownership lookup
- **WHEN** user A updates a `join` step's `secondaryInput` to a `lane`-kind reference within the same pipeline
- **THEN** the update succeeds and no data-source ownership lookup is performed

## REMOVED Requirements

### Requirement: JoinStep right-source must be caller-owned on creation

**Reason:** Restated in terms of the discriminated `secondaryInput` shape (HEL-911). The flat `rightDataSourceId` field this requirement and its scenario titles are written against is deleted by this change, so the requirement is replaced rather than edited — its scenario names embed the removed field name. The ACL behaviour itself is preserved unchanged, including HEL-950's empty-id incomplete-draft exemption, by "Join secondary-input ownership is checked only for source-kind inputs, on creation" above, which additionally states the `lane`-kind exemption.

**Migration:** None. Callers already sending an owned source see identical behaviour under the new config shape.

### Requirement: JoinStep right-source SHALL be caller-owned on update

**Reason:** Same as above, for the update path. Replaced by "Join secondary-input ownership is checked only for source-kind inputs, on update".

**Migration:** None.
