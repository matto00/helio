## Why

HEL-913 (`4b953460`) replaced the scalar pipeline-source pair with a `roots[]` array on both the request
(`POST /api/pipelines`) and the response (`PipelineSummaryResponse`, workspace-context `PipelineEntry`),
removing `sourceDataSourceId`/`sourceDataSourceName` outright with no alias and no dual-read path.
`frontend/**` was off limits to that run, so the frontend still posts a scalar the API now rejects with
`400` and still reads two fields the API no longer returns. `main` is knowingly broken in the Create
Pipeline flow; `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` is red because of it. This change ends that
bounded, owned window.

## What Changes

- The Create Pipeline flow posts `roots: [{ sourceId }]` — a one-element array — instead of a scalar
  `sourceDataSourceId`. The user-facing flow is unchanged: still exactly one source picker, still one
  `POST /api/pipelines` call.
- Everything that displays a pipeline's source name resolves it from `roots[0].dataSourceName` instead of
  the removed `sourceDataSourceName` scalar.
- The two source-dependency counters (sidebar delete warning, empty-schema affordance) match a source
  against **any** root (`roots.some(r => r.dataSourceId === source.id)`), not against `roots[0]`. Under
  multi-root, a pipeline depends on a source if any of its roots reads from it; keying on the first root
  alone would silently under-count and under-warn.
- Frontend request/response types and their test fixtures adopt the `roots[]` shape. Zero occurrences of
  either scalar remain anywhere under `frontend/src` (including doc comments).
- **BREAKING** — none for consumers. This is a client catching up to an already-shipped server contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-new-flow`: the single `POST /api/pipelines` call carries a one-element `roots[]`, not a scalar
  `sourceDataSourceId`.
- `pipeline-editor-page`: the header's read-only bound-source display resolves name and kind from
  `roots[0]` rather than the two removed scalars.
- `datasource-edit-delete`: the dependent-pipeline delete warning matches a source against any root.

## Impact

- `frontend/src/features/pipelines/` — `ui/CreatePipelineModal.tsx`, `ui/PipelineDetailHeader.tsx`,
  `ui/PipelineDetailPage.tsx`, `ui/PipelineListTable.tsx`, `services/pipelineService.ts`,
  `types/pipelineStep.ts`, `state/pipelinesSlice.ts`, `hooks/usePipelineDetailPage.ts`, plus tests.
- `frontend/src/features/sources/ui/EmptySchemaAffordance.tsx`, `frontend/src/shared/chrome/SidebarBody.tsx`
  — the two dependency counters.
- Test fixtures across `features/panels`, `features/proposals`, `app/App.test.tsx`.
- No backend change. No migration. No API change.

## Non-goals

- **Any multi-root UI** — no "+ root" affordance, no root columns in the river, no multi-root editing.
  That is HEL-968 (P2.3b). This restores the pre-existing single-source authoring experience on the new
  wire shape and nothing more.
- Repairing `openspec/specs/pipeline-list-api` and `openspec/specs/pipeline-edit-flow`, which still document
  the removed scalars in **backend** response-shape requirements. That is HEL-913 spec drift on the server
  side, outside this frontend change's diff; filed as HEL-976.
- Renaming `RootSourceSchemaResponse.sourceDataSourceName` to match its sibling's `dataSourceName`. A backend
  wire change; filed as HEL-975. This change omits the unconsumed field frontend-side instead (design D4).
- `e2e/hel813-mobile-touch-target-floor.spec.ts` is already green on the base branch (the ticket's claim
  that it is red is stale). Nothing here targets it; it is a no-regression check only.
