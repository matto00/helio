## ADDED Requirements

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
