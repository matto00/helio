# hikaricp-pool-config Specification

## Purpose
Tunes the HikariCP connection pool for serverless deployment: max 5 connections, minimum idle of 2 warm connections, a short idle timeout to trim excess connections, and a 30-minute max lifetime that avoids connection exhaustion on Cloud Run without forcing unnecessary Cloud SQL TLS handshakes on idle, unused connections.
## Requirements
### Requirement: HikariCP pool is sized for serverless deployment
The backend SHALL configure HikariCP with a maximum pool size of 5, minimum idle of 2, idle timeout of 30 000 ms, max lifetime of 1 800 000 ms, and connection timeout of 5 000 ms to prevent connection exhaustion when many Cloud Run instances connect to Cloud SQL simultaneously, while avoiding unnecessary proactive connection recycling on idle, unused connections, and failing fast when the database is unreachable rather than hanging on HikariCP's default 30 000 ms connection-acquisition timeout.

#### Scenario: Pool respects maximum connection limit
- **WHEN** the backend starts and connects to PostgreSQL
- **THEN** HikariCP creates no more than 5 connections to the database

#### Scenario: Idle connections above the minimum are released promptly
- **WHEN** a connection above `minimumIdle` has been idle for 30 seconds
- **THEN** HikariCP closes and removes the connection from the pool

#### Scenario: Connections are not recycled on an aggressive fixed clock
- **WHEN** a connection reaches 1 800 000 ms (30 minutes) of age
- **THEN** HikariCP closes and replaces the connection, well within any Cloud SQL-imposed connection limit, without forcing a fresh Cloud SQL TLS handshake on every ~60-90s housekeeping sweep regardless of actual usage

#### Scenario: Connection acquisition fails fast when the database is unreachable
- **WHEN** the database is unreachable and a request attempts to acquire a connection from the pool
- **THEN** HikariCP surfaces a connection-acquisition failure within 5 000 ms rather than waiting for its 30 000 ms default

### Requirement: Privileged HikariCP pool is sized for serverless deployment
The backend SHALL configure a second HikariCP pool (for `withSystemContext`) with
a maximum pool size of 5, minimum idle of 2, idle timeout of 30 000 ms, max
lifetime of 1 800 000 ms, and connection timeout of 5 000 ms — matching the app pool tuning. The two pools together bring
the total maximum connection count to 10 per instance.

#### Scenario: Privileged pool respects maximum connection limit
- **WHEN** the backend starts and `DbContext` initialises the privileged pool
- **THEN** HikariCP creates no more than 5 privileged-role connections to the database

#### Scenario: Privileged pool releases idle connections above the minimum promptly
- **WHEN** a privileged-pool connection above `minimumIdle` has been idle for 30 seconds
- **THEN** HikariCP closes and removes the connection from the pool

#### Scenario: Privileged pool connection acquisition fails fast when the database is unreachable
- **WHEN** the database is unreachable and a privileged-context call attempts to acquire a connection from the privileged pool
- **THEN** HikariCP surfaces a connection-acquisition failure within 5 000 ms rather than waiting for its 30 000 ms default

