# backend-file-size-compliance Specification

## Purpose
Defines file-size budget limits for backend service and repository files, ensuring no single file grows past the 300L (service) / 250L (repository) soft budget or the 400L hard BLOCKER threshold.
## Requirements
### Requirement: Repository and service files SHALL not exceed file-size budgets
Service files SHALL be ≤300L. Non-service backend files (repositories) SHALL be ≤250L.
All files introduced by this split SHALL also respect these budgets.

#### Scenario: DashboardRepository within budget
- **WHEN** the split is applied
- **THEN** `DashboardRepository.scala` SHALL be ≤250 lines

#### Scenario: PanelRepository within budget
- **WHEN** the split is applied
- **THEN** `PanelRepository.scala` SHALL be ≤250 lines

#### Scenario: DashboardService within budget
- **WHEN** the split is applied
- **THEN** `DashboardService.scala` SHALL be ≤300 lines

#### Scenario: PanelService within budget
- **WHEN** the split is applied
- **THEN** `PanelService.scala` SHALL be ≤300 lines

#### Scenario: New split files within budget
- **WHEN** new files are created by the split
- **THEN** each new file SHALL be ≤300 lines

### Requirement: The split SHALL be behavior-preserving
All existing functionality SHALL work identically after the split.
No API contracts, response shapes, or test expectations SHALL change.

#### Scenario: All tests pass after split
- **WHEN** `sbt test` is run after the split
- **THEN** all 715 tests SHALL pass

#### Scenario: Service constructor signatures unchanged
- **WHEN** reviewing `Main.scala` after the split
- **THEN** `DashboardService` and `PanelService` constructor call sites SHALL be unmodified

### Requirement: Apply-proposal test suite SHALL respect the file-size budget

The `DashboardApplyProposalSpec.scala` route-level test suite SHALL be split into
cohesive sibling spec files so that no single file exceeds the ~250-line soft budget
enforced by `npm run check:scala-quality` (`scripts/check-scala-quality.mjs`), which
scans `backend/src/test/scala`. (~400 lines is CONTRIBUTING.md's separate "must propose
a split" trigger, not the post-split target.) The split SHALL be behavior-preserving:
every test case moves verbatim with
its exact description string and body, no test semantics are added, removed, or
altered, and shared fixture setup (embedded-Postgres + real-RLS pools, seeded data,
request helpers) is extracted into a shared base trait rather than duplicated. No
production code, schema, migration, or API contract SHALL change.

#### Scenario: Each apply-proposal spec file within budget

- **WHEN** the split is applied and `npm run check:scala-quality` is run
- **THEN** `DashboardApplyProposalSpec.scala`, the shared base trait, and each new
  sibling spec file SHALL be comfortably under the ~250-line soft budget with zero new
  soft warnings

#### Scenario: Shared fixture is not duplicated

- **WHEN** reviewing the split spec files
- **THEN** the embedded-Postgres/RLS setup, seeded data, and request helpers SHALL live
  in a single shared base trait extended by each concrete spec

#### Scenario: Total test count is preserved

- **WHEN** `sbt test` is run before and after the split
- **THEN** the total number of executed tests SHALL be identical and all SHALL pass

