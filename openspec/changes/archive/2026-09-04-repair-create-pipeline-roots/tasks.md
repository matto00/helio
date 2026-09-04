## 1. Baseline evidence

- [x] 1.1 Run `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` on the unmodified branch and capture its RED output verbatim as the pre-existing-condition baseline.
- [x] 1.2 Run `grep -rn "sourceDataSourceId\|sourceDataSourceName" frontend/src | wc -l` and record the starting hit count.

## 2. Frontend types

- [x] 2.1 Add `PipelineRoot { id: string; dataSourceId: string; dataSourceName: string }` to `frontend/src/features/pipelines/types/pipelineStep.ts`.
- [x] 2.2 Replace `sourceDataSourceId`/`sourceDataSourceName` on `PipelineSummary` with `roots: PipelineRoot[]`.
- [x] 2.3 Replace `PipelineAnalyzeResponse.sourceDataSourceName`/`sourceSchema` with `sourceSchemas: RootSourceSchema[]` where `RootSourceSchema { rootId: string; sourceDataSourceName: string; sourceSchema: SchemaField[] }` — matching `RootSourceSchemaResponse` on the wire (D4).
- [x] 2.4 Change `CreatePipelinePayload` in `services/pipelineService.ts` from `sourceDataSourceId: string` to `roots: { sourceId: string }[]`; leave `outputDataTypeName` untouched (D5).

## 3. Frontend create path

- [x] 3.1 In `ui/CreatePipelineModal.tsx`, send `roots: [{ sourceId: <picked id> }]` instead of the scalar; keep the local picker state name-agnostic but scalar-free, and keep the flow single-source (no add-root affordance).
- [x] 3.2 Update the `createPipeline` thunk argument type in `state/pipelinesSlice.ts:273` to the new payload shape.
- [x] 3.3 Update the modal's doc comments (lines ~22 and ~33) so no scalar name survives.

## 4. Frontend read paths

- [x] 4.1 `hooks/usePipelineDetailPage.ts:354` — resolve the bound source via `currentPipeline?.roots?.[0]?.dataSourceId`, guarded (D3).
- [x] 4.2 `ui/PipelineDetailPage.tsx:151` — pass `sourceName` from `currentPipeline.roots[0]?.dataSourceName ?? ""`.
- [x] 4.3 `ui/PipelineDetailHeader.tsx` — update the `sourceName`/`source` prop doc comments to name `roots[0]`.
- [x] 4.4 `ui/PipelineListTable.tsx:104` — render `pipeline.roots[0]?.dataSourceName ?? ""`.

## 5. Frontend dependency counters

- [x] 5.1 `shared/chrome/SidebarBody.tsx:90` — count dependents with `p.roots.some((r) => r.dataSourceId === item.id)` (D2), not `roots[0]`.
- [x] 5.2 `features/sources/ui/EmptySchemaAffordance.tsx:30` — same `.some(...)` change against `source.id`.
- [x] 5.3 `state/pipelinesSlice.ts:598-611` — `selectPipelineNamesBySourceId` indexes every root, deduping so a pipeline with two roots on one source is listed once.
- [x] 5.4 `features/sources/ui/AddSourceModal.tsx:49` — update the doc comment naming the scalar.

## 6. Tests

- [x] 6.1 Update every affected fixture to the `roots[]` shape across `features/pipelines`, `features/panels`, `features/proposals`, `shared/chrome`, and `app/App.test.tsx`.
- [x] 6.2 Add a `CreatePipelineModal` test asserting the POST body carries `roots: [{ sourceId }]` and contains no `sourceDataSourceId` key.
- [x] 6.3 Add a `SidebarBody` (or `EmptySchemaAffordance`) test whose fixture pipeline matches the source on its SECOND root — must fail against a `roots[0]` implementation (D2 / stated risk).
- [x] 6.4 Add a `PipelineDetailPage`/header test covering an empty `roots` array rendering with no source name and no throw (D3).

## 7. Verification

- [x] 7.1 `grep -rn "sourceDataSourceId\|sourceDataSourceName" frontend/src` returns ZERO hits; paste the empty result as AC3 evidence.
- [x] 7.2 `npm run lint`, `npm run typecheck`, `npm test`, `npm run check:e2e-types` all green.
- [x] 7.3 Re-run `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` against a running backend: RED (1.1) to GREEN. This is the load-bearing proof; a green typecheck is not evidence (D6).
- [x] 7.4 Re-run `e2e/hel813-mobile-touch-target-floor.spec.ts` as a no-regression check only — it was already green before this change and is NOT evidence the fix worked.
- [x] 7.5 Write `files-modified.md` with exactly ONE path per bullet (the branch carries the old squash-parse).
