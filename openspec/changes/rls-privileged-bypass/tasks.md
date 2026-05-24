## 1. Database Migration

- [ ] 1.1 Add V34__rls_privileged_role.sql: CREATE ROLE IF NOT EXISTS helio_privileged BYPASSRLS NOLOGIN; GRANT helio_privileged TO current_user

## 2. Backend — Infrastructure

- [ ] 2.1 Refactor Database.scala: rename init → initApp; add initPrivileged (no migrations, reads helio.db.privileged stanza)
- [ ] 2.2 Add helio.db.privileged stanza to application.conf (inherits url/driver/stringtype, sets connectionInitSql = "SET LOCAL ROLE helio_privileged", same pool sizing)
- [ ] 2.3 Refactor DbContext.scala: accept two JdbcBackend.Database args (db, privilegedDb); remove SystemUserId sentinel and setVar; withSystemContext runs on privilegedDb; withUserContext unchanged
- [ ] 2.4 Update Main.scala: call Database.initApp + Database.initPrivileged, pass both to DbContext constructor

## 3. Backend — Callsite Audit

- [ ] 3.1 Verify ResourceTypeRegistry resolvers (DashboardRepository.findByIdInternal, PanelRepository.findByIdInternal, DataSourceRepository.findByIdInternal, DataTypeRepository.findByIdInternal, PipelineRepository.findByIdInternal) route through withSystemContext and carry justification comments
- [ ] 3.2 Verify SourceSchemaHealthCheck.findOrphans routes through withSystemContext with justification comment
- [ ] 3.3 Verify DashboardRepository.count, delete, duplicate, exportSnapshot, importSnapshot, updateName, findById (public-grant path) use withSystemContext and carry justification comments
- [ ] 3.4 Verify DataTypeRowRepository.overwriteRows and listRows use withSystemContext and carry justification comments
- [ ] 3.5 Verify PipelineRunRepository internal methods (insertRunInternal, insertDryRunInternal, updateRunTerminalInternal, deleteOldRunsInternal, deleteOldDryRunsInternal) use withSystemContext and carry justification comments
- [ ] 3.6 Verify SparkJobSubmitter uses only *Internal repository calls (already privileged-pool-routed) and carries justification comments
- [ ] 3.7 Verify PipelineRunService.upsertFieldsFromRows calls dataTypeRepo.findByIdInternal through withSystemContext and carries justification comment

## 4. Tests

- [ ] 4.1 Extend DbContextSpec: add test that withUserContext cannot read across users when RLS is enabled (ALTER TABLE ... ENABLE ROW LEVEL SECURITY inside the test); withSystemContext reads the row; withUserContext returns nothing
- [ ] 4.2 Run sbt test and confirm all existing and new tests pass
