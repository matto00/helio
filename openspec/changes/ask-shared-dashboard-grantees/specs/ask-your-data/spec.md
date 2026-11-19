## ADDED Requirements

### Requirement: Dashboard grantees ask under row-level security

A dashboard ask by a caller holding only a named grant on the dashboard SHALL be answered under the application's
non-BYPASSRLS database role exactly as under a superuser: the in-scope Outputs' rows and history reach the model only
through the scope-checked tool calls, a caller with no pipeline grant on any in-scope Output SHALL NOT be offered
`get_history_rows` and SHALL NOT receive any history payload row, and the response's `pin` SHALL be `null` unless the
caller can edit the one cited pipeline. A dashboard `editor` grant SHALL NOT by itself make `pin` non-null.

#### Scenario: Dashboard-only viewer under the app role

- **WHEN** a beta-tier dashboard-only viewer asks the dashboard on the non-BYPASSRLS app pool and the model reads an
  on-board Output's rows and history
- **THEN** the tool results carry that Output's data, the response is `200` with a grounded answer and `pin: null`, and
  `get_history_rows` is not among the offered tools

#### Scenario: Dashboard editor without a pipeline grant

- **WHEN** a beta-tier user holding an editor grant on the dashboard and no grant on the cited pipeline asks and the
  answer cites that pipeline's Outputs
- **THEN** the response is `200` with `pin: null`, equal to the committed no-pin fixture
