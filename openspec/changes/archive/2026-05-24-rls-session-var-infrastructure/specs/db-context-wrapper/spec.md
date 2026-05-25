## ADDED Requirements

### Requirement: DbContext wraps DBIO actions with a transaction-scoped session variable
The backend SHALL provide a `DbContext` class in `com.helio.infrastructure` that offers `withUserContext(userId: String)(action: DBIO[R]): Future[R]` and `withSystemContext(action: DBIO[R]): Future[R]`. Each method SHALL prepend `SET LOCAL app.current_user_id = '<value>'` as the first statement in an explicit Slick `.transactionally` block before executing the caller's action.

#### Scenario: User context is set before action executes
- **WHEN** `withUserContext("user-123")(someDbioAction)` is called
- **THEN** the action executes inside a transaction where `current_setting('app.current_user_id')` returns `'user-123'`

#### Scenario: System context uses sentinel value
- **WHEN** `withSystemContext(someDbioAction)` is called
- **THEN** the action executes inside a transaction where `current_setting('app.current_user_id')` returns `'system'`

### Requirement: Session variable does not leak across pooled connections
The `app.current_user_id` session variable SET by `withUserContext` SHALL NOT be visible on any subsequent `db.run` call that does not explicitly set it, even when HikariCP hands out the same underlying connection.

#### Scenario: Session variable cleared after transaction commit
- **WHEN** `withUserContext("user-A")(action)` completes (COMMIT)
- **AND** a subsequent `db.run(sql"SELECT current_setting('app.current_user_id', true)".as[Option[String]])` is executed without a wrapper
- **THEN** the result is `None` or an empty string — not `'user-A'`

#### Scenario: Session variable cleared after transaction rollback
- **WHEN** `withUserContext("user-A")(DBIO.failed(new Exception("boom")))` fails (ROLLBACK)
- **AND** a subsequent `db.run(sql"SELECT current_setting('app.current_user_id', true)".as[Option[String]])` is executed without a wrapper
- **THEN** the result is `None` or an empty string — not `'user-A'`

### Requirement: All ACL'd repository reads and writes use DbContext
Every method in `DashboardRepository`, `PanelRepository`, `DataTypeRepository`, `DataSourceRepository`, and `PipelineRepository` that reads or writes ACL'd data SHALL execute through `DbContext.withUserContext` (passing the caller's user ID) or `DbContext.withSystemContext` (for privileged/internal callers). No raw `db.run(action)` SHALL remain in those repositories.

#### Scenario: Dashboard findAll routes through DbContext
- **WHEN** `DashboardRepository.findAll(ownerId)` is called
- **THEN** the Slick action executes inside a transaction with `app.current_user_id` set appropriately

#### Scenario: Panel insert routes through DbContext
- **WHEN** `PanelRepository.insert(panel, userId)` is called
- **THEN** the Slick action executes inside a transaction with `app.current_user_id` set to the user's ID

### Requirement: DbContext connection-leak regression test exists and passes
A ScalaTest spec named `DbContextSpec` in `com.helio.infrastructure` SHALL use EmbeddedPostgres to verify that the session variable set by `withUserContext` is not visible on a connection returned to the pool after the transaction commits.

#### Scenario: Regression test passes in CI
- **WHEN** `sbt test` runs
- **THEN** `DbContextSpec` passes, including the connection-leak scenario
