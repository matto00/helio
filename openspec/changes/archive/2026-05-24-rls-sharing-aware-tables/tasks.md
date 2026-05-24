## 1. Backend — Flyway migration

- [ ] 1.1 Create `V36__rls_sharing_aware_tables.sql` with SECURITY DEFINER function `helio_can_access_dashboard(TEXT)` encoding owner OR named grantee OR anonymous public-viewer predicate
- [ ] 1.2 Add FORCE RLS + SELECT/UPDATE/DELETE policies on `dashboards` using the helper function
- [ ] 1.3 Add FORCE RLS + SELECT/UPDATE/DELETE policies on `panels` using the helper function
- [ ] 1.4 Add FORCE RLS + SELECT/INSERT/UPDATE/DELETE policies on `resource_permissions` (SELECT: owner OR grantee; writes: owner only)
- [ ] 1.5 Grant EXECUTE on `helio_can_access_dashboard` to `helio_app_test` and `helio_privileged` roles (for tests and production)

## 2. Backend — Repository cleanup

- [ ] 2.1 Remove `-- Placeholder until HEL-275/276` comments from `DashboardRepository` mutation methods (delete, duplicate, exportSnapshot, importSnapshot, updateName)
- [ ] 2.2 Remove `-- Placeholder until HEL-275/276` comments from `PanelRepository` mutation methods (delete, duplicate, updateTitle, updateAppearance, replace)

## 3. Tests

- [ ] 3.1 Create `RlsSharingAwareTablesSpec` with EmbeddedPostgres + `helio_app_test` (non-privileged) + `helio_privileged` pools following the RlsOwnerTablesSpec pattern
- [ ] 3.2 Add test: dashboards — owner sees own rows, non-grantee sees nothing, grantee sees shared rows, privileged pool sees all
- [ ] 3.3 Add test: dashboards — anonymous (no SET LOCAL) sees only rows with public-viewer grant
- [ ] 3.4 Add test: panels — owner sees panels, grantee sees panels, non-grantee sees nothing
- [ ] 3.5 Add test: resource_permissions — owner sees all grants for own dashboard, grantee sees own grant row, unrelated user sees zero rows
- [ ] 3.6 Verify `DashboardPanelAclSpec` (HEL-265 CS4) passes unchanged with new migration applied
