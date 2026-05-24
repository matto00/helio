## 1. Backend — Flyway Migration

- [ ] 1.1 Create `backend/src/main/resources/db/migration/V35__rls_owner_only_tables.sql` enabling RLS + FORCE and creating owner policies on all six tables

## 2. Backend — Repository Write Path Migration

- [ ] 2.1 Update `DataSourceRepository.insert` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.2 Update `DataSourceRepository.update` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.3 Update `DataSourceRepository.updateStaticPayload` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.4 Update `DataSourceRepository.delete` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.5 Update `DataTypeRepository.insert` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.6 Update `DataTypeRepository.update` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.7 Update `DataTypeRepository.delete` to accept `user: AuthenticatedUser` and call `withUserContext`
- [ ] 2.8 Update `PipelineStepRepository.insert` to accept `user: AuthenticatedUser` and call `withUserContext`

## 3. Backend — Service Layer Call-site Updates

- [ ] 3.1 Update all `DataSourceService` callers of `dataSourceRepo.insert/update/updateStaticPayload/delete` to pass `user`
- [ ] 3.2 Update all `DataTypeService` callers of `dataTypeRepo.insert/update/delete` to pass `user`
- [ ] 3.3 Update `DataSourceService.upsertSourceDataType` callers of `dataTypeRepo.insert/update` to pass `user`
- [ ] 3.4 Update `SourceService` callers of `dataSourceRepo.insert` and `dataTypeRepo.insert/update` to pass `user`
- [ ] 3.5 Update `PipelineRunService.upsertFieldsFromRows` — this calls `dataTypeRepo.update` on the privileged background path; leave on `withSystemContext` via `DataTypeRepository.updateInternal` (new privileged variant) with justification comment
- [ ] 3.6 Update `PipelineService.addStep` caller of `pipelineStepRepo.insert` to pass `user`
- [ ] 3.7 Update `DemoData` (seeder) callers of any affected repos to use `withSystemContext` variants (already privileged path)

## 4. Tests

- [ ] 4.1 Create `RlsOwnerTablesSpec` with EmbeddedPostgres + full Flyway, two synthetic users, covering: fail-closed (no SET LOCAL → error), single-user isolation (withUserContext sees own rows only), cross-user isolation, withSystemContext bypass on all six tables
- [ ] 4.2 Run existing repository specs and confirm they still pass with RLS enabled (DataSourceRepositorySpec, DataTypeRepositorySpec, PipelineRepositorySpec, PipelineStepRepositorySpec, PipelineRunRepositorySpec, DataTypeRowRepositorySpec, DbContextSpec)
