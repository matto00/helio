## ADDED Requirements

### Requirement: Output-removing deletes lock affected dashboards before deleting any Output
Every transaction that deletes an Output, directly or through a foreign-key cascade (an Output, pipeline, pipeline
step, pipeline root or data-source delete, or a workspace teardown), SHALL, immediately after it locks the panel rows
it may remove and before it deletes or locks any Output row, lock in a single statement ordered by dashboard id every
dashboard row those panels sit on, including dashboards the acting user cannot see under row-level security. The
resulting system-wide order is "panel rows by id, then dashboard rows by id, then Output rows", which a panel create
(dashboard row `FOR UPDATE`, then the Output's KEY SHARE through `panels.output_id`) already follows.

#### Scenario: Panel create racing a cascading delete of its bound Output
- **WHEN** a panel bound to Output O is created on dashboard D while a pipeline (or pipeline step, pipeline root, data
  source or workspace teardown) delete that removes O runs concurrently, and O is already bound to a panel on D
- **THEN** neither transaction fails with SQLSTATE 40P01

#### Scenario: Bound panels the deleting user cannot see
- **WHEN** the Output being deleted belongs to a pipeline owner and its bound panel sits on a grantee's dashboard that
  the grantee is adding a panel to concurrently
- **THEN** neither transaction fails with SQLSTATE 40P01
