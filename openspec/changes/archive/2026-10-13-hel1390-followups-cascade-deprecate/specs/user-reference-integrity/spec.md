## ADDED Requirements

### Requirement: Pipeline-run rate-window rows are removed with their user

`pipeline_run_rate_window.user_id` SHALL reference `users(id)` with `ON DELETE CASCADE`. A rate-window row is
per-user rate-limit bookkeeping, not user content, so it SHALL never block deleting its user: deleting a user SHALL
delete that user's rate-window rows. Every other blocking reference (for example a `NO ACTION` FK on `pipelines`)
SHALL still reject the user delete as a whole. The user-reference inventory SHALL list the column as `CASCADE`.

#### Scenario: Deleting a user whose only reference is a rate-window row succeeds
- **WHEN** a user whose only referencing rows are in `pipeline_run_rate_window` is deleted
- **THEN** the delete succeeds and none of that user's rate-window rows remain

#### Scenario: Another user's rate-window rows are untouched
- **WHEN** a user with rate-window rows is deleted while a second user also has rate-window rows
- **THEN** every rate-window row of the second user still exists

#### Scenario: A remaining blocking reference still rejects the delete
- **WHEN** a user who has a rate-window row and also owns a dashboard is deleted
- **THEN** the delete fails and the user and the rate-window row both still exist

#### Scenario: Rate-window rows still require an existing user
- **WHEN** a `pipeline_run_rate_window` row is inserted whose `user_id` matches no `users.id`
- **THEN** the insert fails with a foreign-key violation
