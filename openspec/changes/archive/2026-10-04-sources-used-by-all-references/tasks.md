## Standing Constraints

- [C1] Mutation evidence must mutate the NEW surface too (owned-id predicate dropped; hidden name serialised into the body) and show the new non-superuser cases go red, not only the finder's pool choice.

## 1. Backend

- [x] 1.1 `DataSourceRepository`: add owned-source-id read (user context, `owner_id = caller`, no paging); verify by 2.x spec
- [x] 1.2 `DataSourceService.findReferenceSummaries(user)`: owned ids → ONE `referenceRepo.find` call; verify 4 queries total by spec/inspection
- [x] 1.3 Protocol: `DataSourceReferencesResponse`/item case classes reusing the 409 pipeline/panel responses + JSON formats; compiles
- [x] 1.4 `DataSourceRoutes`: `path("references") { get }` before `path(DataSourceIdSegment)`; verify via route spec
- [x] 1.5 `schemas/sources/data-source-references-response.schema.json` (+ OpenAPI path if the repo's spec lists data-source routes); schema-drift check passes

## 2. Frontend

- [x] 2.1 `dataSourceService.fetchSourceReferences` + `SourceReferenceSummary` type; tsc passes
- [x] 2.2 `sourcesSlice`: `references`/`referencesStatus`, `fetchSourceReferences` thunk, drop entry on delete fulfilled, refetch on delete rejected; thunk `condition` skips when `referencesStatus === "loading"` (no double GET on cold /sources, per F-072); slice tests
- [x] 2.3 `features/sources/utils/sourceReferences.ts`: `summarizeSourceUsage` + `sourceDeleteWarning` (design D6); unit tests
- [x] 2.4 `SourceListTable`/`SourcesPage`: "Used by" from the summary ("—" until loaded), sort by total; remove `pipelineNamesBySourceId` prop
- [x] 2.5 `SidebarBody` + `EmptySchemaAffordance`: warning from `sourceDeleteWarning`; dispatch `fetchSourceReferences` per design D5
- [x] 2.6 Remove `selectPipelineNamesBySourceId` and pipelines fetches that only fed these sites (design D7 — grep first); lint/tsc clean

## 3. Tests

- [x] 3.1 `DataSourceRoutesSpec`: shape, every kind (root/join/lookup/union/upsertTarget/panel), unreferenced absent, foreign source absent, path not shadowed by id segment
- [x] 3.2 `DataSourceReferenceGuardNonSuperuserSpec` new cases (design D8): hidden counts with no hidden id/name in serialised body, granted named, foreign absent, on the NOBYPASSRLS app pool
- [x] 3.3 Record mutation evidence: finder run in user context → 3.2 hidden-count case red on app pool; restore → green
- [x] 3.4 Frontend tests: join-only / form-panel-only / upsert-only / hidden-only source → used + warning; not-loaded never "Unused"; update `SidebarBody.test.tsx`, `SourceListTable.test.tsx`, `SourcesPage.test.tsx` (explicit service mock factory), `App.test.tsx`, and any `sources: {` preloaded-state literals
- [x] 3.5 Gates: `nice -n 19 sbt testFull`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`
- [x] 3.6 Live check on the worktree's ports: R2-only and R4-only sources show used + warn, light and dark themes; residue deleted by exact id
