## MODIFIED Requirements

### Requirement: HikariCP pool is sized for serverless deployment
The backend SHALL configure HikariCP with a maximum pool size of 5, minimum idle of 2, idle timeout of 30 000 ms, and max lifetime of 1 800 000 ms to prevent connection exhaustion when many Cloud Run instances connect to Cloud SQL simultaneously, while avoiding unnecessary proactive connection recycling on idle, unused connections.

#### Scenario: Pool respects maximum connection limit
- **WHEN** the backend starts and connects to PostgreSQL
- **THEN** HikariCP creates no more than 5 connections to the database

#### Scenario: Idle connections above the minimum are released promptly
- **WHEN** a connection above `minimumIdle` has been idle for 30 seconds
- **THEN** HikariCP closes and removes the connection from the pool

#### Scenario: Connections are not recycled on an aggressive fixed clock
- **WHEN** a connection reaches 1 800 000 ms (30 minutes) of age
- **THEN** HikariCP closes and replaces the connection, well within any Cloud SQL-imposed connection limit, without forcing a fresh Cloud SQL TLS handshake on every ~60-90s housekeeping sweep regardless of actual usage

### Requirement: Privileged HikariCP pool is sized for serverless deployment
The backend SHALL configure a second HikariCP pool (for `withSystemContext`) with
a maximum pool size of 5, minimum idle of 2, idle timeout of 30 000 ms, and max
lifetime of 1 800 000 ms — matching the app pool tuning. The two pools together bring
the total maximum connection count to 10 per instance.

#### Scenario: Privileged pool respects maximum connection limit
- **WHEN** the backend starts and `DbContext` initialises the privileged pool
- **THEN** HikariCP creates no more than 5 privileged-role connections to the database

#### Scenario: Privileged pool releases idle connections above the minimum promptly
- **WHEN** a privileged-pool connection above `minimumIdle` has been idle for 30 seconds
- **THEN** HikariCP closes and removes the connection from the pool
