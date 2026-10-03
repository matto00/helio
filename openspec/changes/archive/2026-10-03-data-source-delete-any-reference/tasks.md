## 1. Backend

- [x] 1.1 Add `DataSourceRepository.rootReferences` (privileged distinct-pipeline total + visible named subset via `findReadEdgesVisibleToFuture`); remove the two sole-root pre-check methods
- [x] 1.2 Rewire `DataSourceService.delete`: any-reference check before `deleteFileF`; new reason text; keep P0001 recover
- [x] 1.3 Add additive `pipelines` field to `DataSourceDeleteConflict`/`DataSourceDeleteConflictResponse` + JSON format
- [x] 1.4 Verify rollback/first-run/proposal cleanup callers of `DataSourceService.delete` do not newly 409 (order of pipeline vs source deletion); log a 409 there
- [x] 1.5 Update `datasource-edit-delete` doc comments citing sole-root-only (DataSourceRepository/Service/Routes)

## 2. Frontend

- [x] 2.1 `deleteSource` thunk keeps 409 reason + pipelines via rejectValue; suppress generic toast for it
- [x] 2.2 Render the conflict with pipeline links in SidebarBody and EmptySchemaAffordance (tokens, both themes)
- [x] 2.3 helio-mcp: rewrite `delete_data_source` description and `HelioApi.deleteDataSource` comment; test the 409 text

## 3. Tests

- [x] 3.1 Backend route spec: multi-root + placed panel -> red on main (panel destroyed), green 409 naming pipeline with source/root/Output/panel intact
- [x] 3.2 Backend: sole-root 409 shape with `pipelines`; unreferenced 204; hidden-pipeline 409 with no id/name (flip V100 spec 3.7f)
- [x] 3.3 Mutation check: revert any-reference predicate to sole-root and show 3.1 fails
- [x] 3.4 Frontend unit tests (thunk 409, rendering links); mcp test
- [x] 3.5 Live check against running app (confirm dev server cwd is the worktree), both themes
