# hikaricp-pool-config Specification

## Purpose
Tunes the HikariCP connection pool for serverless deployment: max 5 connections, zero minimum idle, short idle and max-lifetime timeouts to avoid connection exhaustion on Cloud Run.
## Requirements
### Requirement: HikariCP pool is sized for serverless deployment
The backend SHALL configure HikariCP with a maximum pool size of 5, minimum idle of 0, idle timeout of 30 000 ms, and max lifetime of 60 000 ms to prevent connection exhaustion when many Cloud Run instances connect to Cloud SQL simultaneously.

#### Scenario: Pool respects maximum connection limit
- **WHEN** the backend starts and connects to PostgreSQL
- **THEN** HikariCP creates no more than 5 connections to the database

#### Scenario: Idle connections are released promptly
- **WHEN** a connection has been idle for 30 seconds
- **THEN** HikariCP closes and removes the connection from the pool

#### Scenario: Connections are recycled before Cloud SQL timeout
- **WHEN** a connection reaches 60 seconds of age
- **THEN** HikariCP closes and replaces the connection, preventing Cloud SQL from forcibly closing it

