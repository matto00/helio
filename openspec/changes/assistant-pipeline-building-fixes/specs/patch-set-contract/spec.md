## ADDED Requirements

### Requirement: Output create edits and intra-set Output references
A patch set SHALL accept an `output` create edit whose `target.parentId` is an existing pipeline id and whose `patch`
is the create-Output request shape (name, kind, nodeStepId, fieldMapping). Any create edit MAY carry `target.ref`, a
short identifier unique within the set. A `panel` create's `patch.config.outputId` MAY be `"$ref:<ref>"`, which SHALL
name an earlier `output` create in the same patch set; otherwise preview SHALL reject the edit with an error naming the
refs that do exist.

#### Scenario: Add a chart Output and a panel in one patch set
- **WHEN** a patch set creates an Output at an existing step that has the mapped columns, with ref "wins", and then
  creates a panel on an existing dashboard with `config.outputId` "$ref:wins"
- **THEN** preview succeeds and shows both pending creates

#### Scenario: Dangling ref is rejected
- **WHEN** a panel create references "$ref:missing"
- **THEN** preview fails with an error naming the edit index and the valid refs

### Requirement: Panel create shape errors name the fix
A `panel` create SHALL take its dashboard from `patch.dashboardId`; a `target.parentId` on a panel create SHALL be
rejected with an error that says to use `patch.dashboardId`.

#### Scenario: parentId on a panel create
- **WHEN** a panel create sets `target.parentId` to a dashboard id
- **THEN** preview fails with an error naming `patch.dashboardId`
