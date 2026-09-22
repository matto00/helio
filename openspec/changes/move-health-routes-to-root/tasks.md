## 1. Backend

- [x] 1.1 `git mv backend/src/main/scala/com/helio/api/routes/workspace/HealthRoutes.scala backend/src/main/scala/com/helio/api/routes/HealthRoutes.scala` and verify `git status` shows a rename, not an add+delete
- [x] 1.2 Update `HealthRoutes.scala`'s `package` declaration from `com.helio.api.routes.workspace` to `com.helio.api.routes` and verify `grep -n "^package" backend/src/main/scala/com/helio/api/routes/HealthRoutes.scala` shows the new package
- [x] 1.3 Add `import com.helio.api.routes.HealthRoutes` to `ApiRoutes.scala` (keep the existing `import com.helio.api.routes.workspace._`, still needed for `WorkspaceRoutes`) and verify `sbt compile` succeeds
- [x] 1.4 Update `backend/src/main/scala/com/helio/api/routes/README.md`: (a) list `HealthRoutes` as a second named-shared-file exception at root, alongside `ServiceResponse.scala`, with rationale, AND (b) rewrite the pre-existing summary sentence "No other file lives directly in `api/routes/` — every route class belongs under one of the 13 domain subdirectories" so it no longer contradicts the new bullet (it must acknowledge `HealthRoutes` as the one route class exceptionally placed at root) — verify by re-reading the file top-to-bottom and confirming no sentence asserts "every route class belongs under one of the 13 domain subdirectories" without qualification
- [x] 1.5 Update `backend/src/main/scala/com/helio/api/routes/workspace/README.md` to remove `HealthRoutes` from its "Holds" list and adjust its explanatory sentence accordingly

## 2. Tests

- [x] 2.1 Run `sbt test` and verify the full backend suite passes unchanged, including `ApiRoutesSpec`'s `"return health status"` test and `ApiRoutesCorsErrorHandlingSpec`'s `/health` CORS-rejection tests
