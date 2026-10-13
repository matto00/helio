# panel-row-lock-order Specification

## Purpose
Defines the single lock order every transaction that writes or deletes panel rows follows, so concurrent dashboard,
panel, output, pipeline, step, root, data-source and teardown writes never deadlock each other over shared panels.

## Requirements

### Requirement: Multi-panel writers lock panel rows in id order before any other row they lock
Every transaction that updates or deletes two or more existing panel rows, directly or through a foreign-key cascade,
SHALL first lock every panel row it may update or delete in a single statement ordered by panel id, before it locks
any dashboard row or deletes or updates anything. This SHALL include panels the acting user cannot see under row-level
security that a cascade would still delete. The resulting system-wide order is "panel rows by id, then dashboard rows
by id".

#### Scenario: Dashboard delete racing a contents replace over two shared panels
- **WHEN** a dashboard delete and a contents replace of the same dashboard run concurrently and the dashboard has two
  or more panels
- **THEN** neither transaction fails with SQLSTATE 40P01

#### Scenario: Dashboard delete racing a batch panel update in descending id order
- **WHEN** a batch update names two panels of a dashboard in descending id order while that dashboard is being deleted
- **THEN** neither transaction fails with SQLSTATE 40P01

#### Scenario: Dashboard delete racing a cascading delete
- **WHEN** a dashboard holding two or more panels bound to one output (or to outputs of one pipeline, pipeline step,
  pipeline root or data source) is deleted while that output, pipeline, step, root or data source is being deleted
- **THEN** neither transaction fails with SQLSTATE 40P01

#### Scenario: Cascade reaches a panel the deleting user cannot see
- **WHEN** a pipeline owner deletes a shared pipeline whose output is bound to two panels on a grantee's dashboard,
  while the grantee deletes that dashboard
- **THEN** neither transaction fails with SQLSTATE 40P01
