## ADDED Requirements

### Requirement: Teardown locks every panel its deletes can reach before deleting
A committing teardown SHALL lock, in one panel-id-ordered statement before its first delete, every panel on a tagged
dashboard and every panel bound to an output of a tagged pipeline or reachable from a tagged data source, including
panels on untagged dashboards and on other users' dashboards.

#### Scenario: Tagged pipeline's output bound on an untagged dashboard
- **WHEN** a teardown deletes a tagged pipeline whose output is bound to two panels on an untagged dashboard, while
  that untagged dashboard is being deleted
- **THEN** neither transaction fails with SQLSTATE 40P01
