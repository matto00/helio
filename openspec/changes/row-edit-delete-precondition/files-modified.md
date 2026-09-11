## Files modified

- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — added `patchRow`/`deleteRow` (`lockSource` + row-and-source-scoped conditional `UPDATE`/`DELETE`, shared `recomputeAfterMutation` helper) and the `RowMutationFailure` sealed trait (`SourceNotFound`/`RowNotFound`/`ValidationFailed`/`StalePrecondition`).
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — added `patchRow`/`deleteRow` (D6 precedence: malformed `updatedAt` → ACL lookup → kind check → repository outcome mapping), `parseInstant` helper, and the `RowMutationResult` result type.
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — added `PATCH`/`DELETE /api/data-sources/:id/rows/:rowId`, including the explicit `.optional` handling for DELETE's `updatedAt` query param (Pekko's default `MissingQueryParamRejection` handling completes `404`, not `400` — found live during gate verification).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — added `RowPatchRequest`, `RowResponse`, `RowResponseRow` wire types + Spray JSON formats.
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — PATCH/DELETE route test coverage (tasks 5.1–5.7, 5.9–5.11) plus the real-concurrency regression test for `appendRows` (task 5.10).
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` — non-superuser RLS coverage for `patchRow`/`deleteRow` cross-owner attempts (task 5.8).
- `schemas/sources/row-patch-request.schema.json`, `schemas/sources/row-response.schema.json`, `schemas/sources/row-response-row.schema.json` — new JSON Schemas mirroring the new wire types (task 3.1).
- `frontend/src/features/sources/types/dataSource.ts` — added `RowResponseRow`/`RowResponse` TypeScript types.
- `frontend/src/features/sources/services/dataSourceService.ts` — added `patchSourceRow`/`deleteSourceRow` typed service calls (task 4.1).
- `openspec/changes/row-edit-delete-precondition/tasks.md` — all tasks marked complete.

## Verification evidence

- `cd backend && sbt test` — 4160/4160 passed, exit 0.
- `npm run lint` — clean (zero-warnings).
- `npm run format:check` — clean.
- `npm run check:schemas` — 87 case classes checked, in sync.
- `npm run check:scala-quality` — clean (163 pre-existing soft file-size warnings, no violations).
- `npm run check:no-credential-leak` — 0 violations.
- `npm test` — 248 (helio-mcp) + 3198 (frontend) passed.
- `npm --prefix frontend run build` — succeeded.

## Debugging note (systematic-debugging.md)

- **Root cause:** Pekko HTTP's default `RejectionHandler` completes a `MissingQueryParamRejection` with `404 Not Found`, not `400 Bad Request` — a DELETE with no `updatedAt` query param therefore returned `404` instead of the `400` design.md D3 requires.
- **Probe:** ran the "reject a missing updatedAt query parameter with 400" test with the response body printed; observed `status=404 Not Found body={"message":"Request is missing required query parameter 'updatedAt'"}` — confirming the rejection reached the handler but was mapped to the wrong status code.
- **Fix:** route now uses `parameter("updatedAt".optional)` and completes `400` explicitly on `None`, bypassing the default handler's surprising status choice for this rejection type.
