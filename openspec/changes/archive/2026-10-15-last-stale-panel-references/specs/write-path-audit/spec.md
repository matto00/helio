## MODIFIED Requirements

### Requirement: Write path audit document exists
The codebase SHALL contain a `write-path-audit` spec that enumerates every PATCH/POST call
issued during a normal dashboard editing session, including the endpoint, triggering user action,
request payload shape, and estimated call frequency per session.

#### Scenario: Audit covers all dashboard-level write paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list PATCH /api/dashboards/:id for layout updates, appearance updates, and renames

#### Scenario: Audit covers all panel-level write paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list POST /api/panels/updateBatch for staged panel title and appearance edits (flushed by the auto-save tick, Save now, or unmount), and PATCH /api/panels/:id for Output swaps (`config.outputId`)

#### Scenario: Audit covers creation and duplication paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list POST /api/panels (create), POST /api/panels/:id/duplicate, and POST /api/dashboards/:id/duplicate

#### Scenario: Audit documents payload shapes
- **WHEN** a developer reads the audit for any write path
- **THEN** the spec SHALL describe the JSON request body fields sent in that call

#### Scenario: Audit documents call frequency
- **WHEN** a developer reads the audit
- **THEN** the spec SHALL include a per-interaction frequency estimate (e.g., 1 call per drag-stop, 1 call per rename commit) suitable for estimating batch API savings
