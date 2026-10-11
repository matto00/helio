## ADDED Requirements

### Requirement: Deleting a dashboard does not deadlock with a concurrent delete of one of its panels
Deleting a dashboard SHALL take its panel rows' locks before the dashboard row, so a concurrent delete of one of its
panels never fails with a deadlock error; both requests complete.

#### Scenario: Concurrent dashboard and panel delete both succeed
- **WHEN** a dashboard and one of its panels are deleted in two concurrent transactions
- **THEN** neither transaction fails with SQLSTATE 40P01, and afterwards neither the dashboard nor the panel exists
