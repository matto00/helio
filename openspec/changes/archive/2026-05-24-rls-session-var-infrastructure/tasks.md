## 1. Backend — DbContext infrastructure

- [x] 1.1 Create `backend/src/main/scala/com/helio/infrastructure/DbContext.scala` with `withUserContext(userId: String)(action: DBIO[R]): Future[R]` and `withSystemContext(action: DBIO[R]): Future[R]`; both prepend `SET LOCAL app.current_user_id = ?` inside `.transactionally`
- [x] 1.2 Add `ctx: DbContext` constructor parameter to `DashboardRepository`; replace all `db.run(...)` with `ctx` calls (use `withUserContext` for ACL'd methods, `withSystemContext` for `findByIdInternal`, `count`, `duplicate`, `exportSnapshot`, `importSnapshot`)
- [x] 1.3 Add `ctx: DbContext` to `PanelRepository`; migrate all `db.run(...)` to `ctx` calls (user context for findById/findAll/insert/update/delete, system context for findByIdInternal and batchUpdate internal reads)
- [x] 1.4 Add `ctx: DbContext` to `DataTypeRepository`; migrate all `db.run(...)` to `ctx` calls (user context for ACL'd methods, system context for `findByIdInternal` and privileged reads)
- [x] 1.5 Add `ctx: DbContext` to `DataSourceRepository`; migrate all `db.run(...)` to `ctx` calls
- [x] 1.6 Add `ctx: DbContext` to `PipelineRepository`; migrate all `db.run(...)` to `ctx` calls
- [x] 1.7 Add `ctx: DbContext` to `PipelineStepRepository`; migrate all `db.run(...)` to `ctx` calls
- [x] 1.8 Add `ctx: DbContext` to `DataTypeRowRepository`; migrate all `db.run(...)` to `ctx` calls
- [x] 1.9 Update `ResourcePermissionRepository` if it has ACL'd reads; migrate appropriately
- [x] 1.10 Wire `DbContext` in `Main.scala`: construct one `DbContext(db)` after `Database.init`, pass it to each repository constructor; update `DemoData` and `SourceSchemaHealthCheck` to use `ctx.withSystemContext` if they have direct `db.run` calls

## 2. Backend — Tests

- [x] 2.1 Create `backend/src/test/scala/com/helio/infrastructure/DbContextSpec.scala` using EmbeddedPostgres; test that after `withUserContext("user-A")(action)` commits, a bare `db.run(sql"SELECT current_setting('app.current_user_id', true)".as[Option[String]])` returns `None`/empty (not `"user-A"`)
- [x] 2.2 Add a rollback variant to `DbContextSpec`: `withUserContext` wrapping a failing DBIO rolls back, and the session var is not visible afterward
- [x] 2.3 Add a `withSystemContext` test: verify `current_setting('app.current_user_id')` returns `'system'` during the action and is cleared after commit

## 3. Docs

- [x] 3.1 Add "Database transactions & RLS context" section to `CONTRIBUTING.md`: explain `withUserContext`/`withSystemContext` contract, why `SET LOCAL` is required, and that raw `db.run` in ACL'd repositories is forbidden
