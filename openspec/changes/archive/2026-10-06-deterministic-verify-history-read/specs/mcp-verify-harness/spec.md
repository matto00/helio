## ADDED Requirements

### Requirement: Isolated verify run is immune to other backends' retention purges

The helio-mcp package SHALL provide an isolated verify run that executes the existing harness against a backend
connected to a dedicated database that no other backend connects to, created fresh for that run and named uniquely.
That backend SHALL run with an Output-history purge interval and lock-retry window long enough that no pass can fall
inside the run after its startup pass, and the harness SHALL start only after that startup pass has completed. The run SHALL record the database name, every process id it starts, and the bootstrap user
and token it creates, and SHALL stop each started process by its recorded id and drop the database by its recorded
name before exiting, whether the harness passed, failed or was interrupted, reporting any removal it could not confirm and exiting
non-zero in that case.

#### Scenario: Another backend's purge cannot thin the isolated fixture

- **WHEN** an isolated verify run executes while a different backend, on a different database, runs retention passes
  every minute
- **THEN** the one `get_output_history` call returns 30 points and 30 numeric sparkline values and the run exits zero

#### Scenario: The shared-database setup is thinned by a second backend

- **WHEN** the harness runs against a backend whose database is also used by a second backend running retention
  passes every minute
- **THEN** the history read returns fewer than 30 points and the harness exits non-zero naming the count observed

#### Scenario: Isolated run leaves no database or process behind

- **WHEN** an isolated verify run exits, passed or failed
- **THEN** the dedicated database no longer exists and no process it started is still running
