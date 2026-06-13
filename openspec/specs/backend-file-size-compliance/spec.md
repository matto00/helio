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

