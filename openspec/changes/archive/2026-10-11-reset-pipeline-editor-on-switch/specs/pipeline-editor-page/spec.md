## ADDED Requirements

### Requirement: Editor state is scoped to the current route pipeline

The pipeline editor at `/pipelines/:id` SHALL display and operate on only the pipeline named by the current `:id`. When the route changes from one pipeline id to another without a full page reload (pipelines list or sidebar, command palette, recent visits, or browser back/forward), the editor SHALL discard the previous pipeline's local editor state (step cards, pending step-config debounces, open per-pipeline sheets/dialogs, the editable name field) and SHALL render the new pipeline's persisted steps. The editor SHALL seed its steps from a steps fetch issued for the current mount, never from a cached copy that pre-dates it. No request issued from the new pipeline's editor SHALL carry any of the previous pipeline's step ids (in the URL or the body), and no late-resolving request for the previous pipeline (pipeline load, steps, analyze, or run) SHALL replace the new pipeline's displayed state. A load failure for the previous pipeline SHALL NOT prevent the new pipeline from loading.

#### Scenario: In-app switch shows the new pipeline's steps

- **WHEN** the user has pipeline A (3 steps) open and navigates in-app to pipeline B (1 step)
- **THEN** the editor shows exactly B's 1 step card and none of A's

#### Scenario: Browser back returns to the previous pipeline's steps

- **WHEN** the user edits a step's config on pipeline A, the edit is saved, the user navigates in-app to pipeline B, and then presses browser back
- **THEN** the editor shows exactly A's persisted steps, including the saved edit

#### Scenario: No cross-pipeline write after a switch

- **WHEN** the user edits a step config on pipeline A and switches to pipeline B before or while that edit is being saved
- **THEN** no request issued after the switch carries any of A's step ids in its URL or body, and B's displayed steps are unchanged by A's save

#### Scenario: Analyze after a switch uses the new pipeline's steps

- **WHEN** the user switches in-app from pipeline A to pipeline B
- **THEN** any `/analyze` request issued for B reflects B's steps, and B's step cards render B's analyze result

#### Scenario: A failed load does not block the next pipeline

- **WHEN** pipeline A fails to load (not found or forbidden) and the user navigates in-app to pipeline B
- **THEN** pipeline B is fetched and its editor renders, not A's error

#### Scenario: A late run result does not land on the next pipeline

- **WHEN** a run of pipeline A is in flight, the user navigates in-app to pipeline B, and A's run then completes
- **THEN** B's page shows no run result, run status, or row counts from A's run
