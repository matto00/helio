## ADDED Requirements

### Requirement: Privileged HikariCP pool is sized for serverless deployment
The backend SHALL configure a second HikariCP pool (for `withSystemContext`) with
a maximum pool size of 5, minimum idle of 0, idle timeout of 30 000 ms, and max
lifetime of 60 000 ms — matching the app pool tuning. The two pools together bring
the total maximum connection count to 10 per instance.

#### Scenario: Privileged pool respects maximum connection limit
- **WHEN** the backend starts and `DbContext` initialises the privileged pool
- **THEN** HikariCP creates no more than 5 privileged-role connections to the database

#### Scenario: Privileged pool releases idle connections promptly
- **WHEN** a privileged-pool connection has been idle for 30 seconds
- **THEN** HikariCP closes and removes the connection from the pool
