# HEL-969: Repair the Create Pipeline flow for multi-root: post a one-element roots[]

## Description

HEL-913 (merged as `4b953460`) replaced `pipelines.source_data_source_id` with a `pipeline_roots` table and changed `POST /api/pipelines` to take a non-empty `roots[]` array. Per the remodel's decision 11 (no deprecation), the scalar `sourceDataSourceId` request field was removed outright — no alias, no dual-read path — so a body carrying it is a hard `400`. `PipelineSummaryResponse` and the workspace-context `PipelineEntry` likewise dropped BOTH `sourceDataSourceId` and `sourceDataSourceName`, replacing them with `roots: [{ id, dataSourceId, dataSourceName }]`.

`frontend/**` was off limits to the HEL-913 run (HEL-912 owned it in a parallel run), so the frontend was left posting and reading fields the API no longer accepts or returns. `main` is therefore knowingly broken in the Create Pipeline flow. This is a bounded, deliberate, owned window; this ticket ends it.

This ticket restores the pre-existing SINGLE-source authoring experience on top of the new wire shape, and nothing more.

## Verified premise (re-enumerated from the tree at `4b953460`, not taken from the ticket)

- `CreatePipelineRequest(name, roots: Vector[CreatePipelineRootRequest], tag, steps, outputs)` — `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:78`.
- `PipelineRootSummaryResponse(id, dataSourceId, dataSourceName)` — same file, `:87`. This is the read shape.
- `PipelineSummaryResponse` carries `roots: Vector[PipelineRootSummaryResponse]` and NO scalar — same file, `:100`.
- Exactly **21** files under `frontend/src` reference `sourceDataSourceId`; **16** reference `sourceDataSourceName`. (The ticket's "at least 10" for the latter is a floor, not the count.)
- `CreatePipelineModal.tsx:90` posts the scalar in the POST body.
- `pipelineService.ts:33` declares the scalar on the request type.
- Two consumers OUTSIDE `features/pipelines` read the scalar for real (not just in doc comments): `frontend/src/features/sources/ui/EmptySchemaAffordance.tsx:30` and `frontend/src/shared/chrome/SidebarBody.tsx:90`, both `pipelines.filter((p) => p.sourceDataSourceId === source.id)` dependent-count computations. These are in scope under AC4 and must resolve through `roots[]`. Note their semantics under multi-root: a pipeline depends on a source if **any** root references it — use `.some(...)` over `roots`, not `roots[0]`, for these two. `AddSourceModal.tsx:49` is a doc comment only.

## CORRECTION to the ticket text (verified by the coordinator from the CI log on 4b953460's PR)

The ticket predicts `e2e/hel813-mobile-touch-target-floor.spec.ts` is also red. **It is NOT — it passes.** The break window is narrower than the ticket claims.

- Only `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` is red on `main`.
- A red hel910 at the START of this run is the pre-existing condition being fixed, not damage caused by this change.
- **hel813 passing is NOT evidence this fix worked.** Do not cite it as such. Do not go hunting a second failure that does not exist.
- `e2e/hel908-full-flow.spec.ts` is a separately quarantined flake (HEL-964), unrelated to this window.

## Acceptance criteria

- [x] AC1: Creating a pipeline from the UI succeeds against the multi-root API, posting `roots: [{ sourceId }]`.
- [x] AC2: The pipeline detail header displays the source resolved from `roots[0]`.
- [x] AC3: No file under `frontend/src` references `sourceDataSourceId` **or** `sourceDataSourceName`. Prove this with the grep itself (zero hits, both scalars), not a hand-kept tally. Doc comments count as hits and must be updated too.
- [x] AC4: Anything reading the pipeline's source for display resolves it from `roots[]` (`roots[0]` where a single source is being named; `roots.some(...)` for the dependent-count filters) rather than a scalar.
- [x] AC5: `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` green again. (This is the load-bearing proof.)
- [x] AC6: `e2e/hel813-mobile-touch-target-floor.spec.ts` green — already green on the base branch; this AC is a no-regression check only.
- [x] AC7: `npm run lint` / `typecheck` / `test` / `check:e2e-types` green.

## Why the typecheck gate cannot catch this defect class

The frontend's types are **not compile-time-coupled** to the backend JSON, which is exactly why these consumers stayed green while reading fields the API no longer returns. **Never cite a green `npm run typecheck` as evidence the frontend survived.** The only proof here is a running app or a green hel910.

## Out of scope

**Any multi-root UI.** No "+ root" affordance, no root columns in the river, no multi-root editing — all of that is HEL-968 (P2.3b). If a change starts looking like editor work, STOP and escalate rather than absorbing it.

## Delivery-hygiene note for this run

HEL-913's last two gate rounds both refuted on artifacts the orchestrator created while delivering (the archive, its forward pointers, a spec edit) while the actual diff had been clean for two cycles. Treat `files-modified.md`, the archive, and the PR body as unreviewed code.

`scripts/concertino/squash-branch.sh` on this branch carries the OLD parse (the grouped-bullet fix is unmerged, in PR #544). **Declare exactly one path per bullet in `files-modified.md`.**

## Merge expectation

`ci-complete` is red until this fix lands. Expect the merge to need the coordinator's intervention; hand it back rather than attempting an override.
