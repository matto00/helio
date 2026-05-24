## 1. Backend

- [x] 1.1 Add `findByIdsOwned(ids: Seq[DataTypeId], user: AuthenticatedUser): Future[Map[DataTypeId, DataType]]` to `DataTypeRepository` using a single `WHERE id IN (...) AND owner_id = ?` Slick query
- [x] 1.2 Refactor `PanelService.resolveBindingsForRead` to collect distinct typeIds, short-circuit if empty, call `findByIdsOwned` once, and resolve each panel via the returned Map
- [x] 1.3 Verify `resolveSingleBinding` (used by `PanelService.update`) is unchanged and still calls `findByIdOwned`

## 2. Tests

- [x] 2.1 Add a `DataTypeRepository` integration test for `findByIdsOwned`: insert two types owned by user A, verify both are returned; insert one owned by user B, verify it is excluded
- [x] 2.2 Add a `PanelService` unit test for `resolveBindingsForRead` with a multi-panel fixture: assert that only one call to the (mocked) repo method is made and that unowned typeIds are cleared
- [x] 2.3 Run `sbt test` in the worktree and confirm all tests pass
