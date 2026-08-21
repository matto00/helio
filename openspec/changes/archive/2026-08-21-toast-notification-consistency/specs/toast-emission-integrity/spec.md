## ADDED Requirements

### Requirement: One user action SHALL produce at most one toast per outcome
A single user action SHALL NOT produce more than one toast for the same outcome, regardless of how many code paths
participate in carrying it out. Where an action is completed by dispatching a thunk that already reports the outcome,
the initiating component SHALL NOT additionally report the same outcome itself.

#### Scenario: Creating a SQL data source produces one success toast
- **WHEN** a SQL data source is created successfully through the add-source modal
- **THEN** exactly one success toast is present in toast state

#### Scenario: Creating a static data source produces one success toast
- **WHEN** a static data source is created successfully through the add-source modal
- **THEN** exactly one success toast is present in toast state

#### Scenario: A create path that dispatches no thunk still produces exactly one
- **WHEN** a data source is created through a path that does not dispatch a create thunk
- **THEN** exactly one success toast is present in toast state

### Requirement: One user action SHALL produce one wording regardless of internal path
Every internal code path completing the same user-facing action SHALL emit the same toast message, so that the wording
does not depend on which implementation branch ran. Where the message names the affected resource, every path SHALL
name it.

#### Scenario: Every create path in one modal reads identically
- **WHEN** a data source is created through any of the add-source modal's paths
- **THEN** the success toast message is identical across all of them and names the created source

### Requirement: A failure that no surface reports SHALL emit an error toast
A failure that is reported by no inline surface and no other visible indication SHALL emit an error toast, so that no
failed operation is silently swallowed. This SHALL hold for writes issued automatically by continuous editing, whose
save-state indicator has no failure state, and for discrete mutations dispatched without a rejection handler.

#### Scenario: A rejected layout or batched panel save is reported
- **WHEN** a dashboard layout write, a batched panel write, or a panel column-width write is rejected
- **THEN** exactly one error toast is emitted

#### Scenario: A rejected schedule toggle is reported
- **WHEN** enabling or disabling a pipeline schedule from its header control is rejected
- **THEN** exactly one error toast is emitted

#### Scenario: A rejected metric delete is reported
- **WHEN** deleting a metric is rejected
- **THEN** exactly one error toast is emitted

#### Scenario: A successful metric delete is reported
- **WHEN** a metric is deleted successfully
- **THEN** exactly one success toast is emitted

### Requirement: An optimistically-applied change SHALL be reverted when its request fails
Where a surface applies a change to its local view before the request confirming it succeeds, a rejection SHALL restore
the previous local state as well as reporting the failure, so that the reported failure and the visible state agree.

#### Scenario: A failed step delete restores the step
- **WHEN** deleting a pipeline step is rejected after the step was removed from the local view
- **THEN** the step is restored to the view
- **AND** exactly one error toast is emitted
