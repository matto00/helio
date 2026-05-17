# Tasks — panel-datatype-binding-fix

## 0. Bind to standards (cycle 1 — done)

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, plus cycle-1 written artifacts (`proposal.md`, `design.md`, `executor-report-1.md`)

## 1. Cycle 1 — investigation (done)

- [x] 1.1 Map the panel read path end-to-end (route → service → repo → frontend hook → render)
- [x] 1.2 Map the pipeline-run write path end-to-end (route → service → engine → `dataTypeRowRepo.overwriteRows`)
- [x] 1.3 Read `DataTypeRowRepository.scala` in full (overwriteRows is transactional DELETE+INSERT; listRows is unordered-safe)
- [x] 1.4 Verify or refute the recorded hypothesis with a live API probe (curl GET /api/dashboards/:id/panels as matt) — REFUTED for matt's normal flow
- [x] 1.5 Identify the actual gap (pagination cache never invalidated on pipeline-run completion) and document
- [x] 1.6 Write `executor-report-1.md`, `proposal.md`, `design.md`, `tasks.md`
- [x] 1.7 Verify gates (`sbt test`, `npm test`, `npm run build`, lint, format) pass on the cycle-1 commit

## 2. Cycle 2 — fix implementation

- [ ] 2.1 Add `markDataTypeRowsStale` action in `panelActions.ts` (createAction<string>)
- [ ] 2.2 Add reducer case in `panelsSlice.ts` `extraReducers` builder: iterate `state.items`, narrow via `isBoundCapablePanel`, delete `state.paginationState[panel.id]` for every match
- [ ] 2.3 Adjust `usePanelData.ts` dedupe guard: bypass the prevKey early-return when `paginationEntry == null` (so a cleared entry triggers a fresh fetch on the next render)
- [ ] 2.4 Dispatch `markDataTypeRowsStale(outputDataTypeId)` from `PipelineDetailPage.tsx` `onTerminal` when `event.status === "succeeded"` and `currentPipeline?.outputDataTypeId` is non-null

## 3. Cycle 2 — regression coverage

- [ ] 3.1 Add `panelsSlice.test.ts` cases for the reducer in isolation (selective clear, no-match no-op)
- [ ] 3.2 Add `usePanelData.test.ts` cases for the integration shape (dispatch action → cleared entry → re-fetch on next render → updated rows)
- [ ] 3.3 `PipelineDetailPage` does not currently have a unit test for `onTerminal`; if one exists, extend it; otherwise document that this is covered by manual + e2e Playwright

## 4. Cycle 2 — manual + verification gates

- [ ] 4.1 Playwright trace (or manual): log in as `matt@helio.dev / heliodev123`, run a pipeline whose output is bound to a panel on a dashboard the user has open in another tab area, observe panel updates without manual refresh
- [ ] 4.2 Manual verification across each bound panel type (metric, chart, table) — confirm rows render after pipeline run
- [ ] 4.3 Pre-commit gates: `npm run lint`, `npm run format:check`, `npm test`, `npm run check:openspec`, `npm run check:scala-quality` all clean
- [ ] 4.4 Backend `sbt test` clean (defensive — no backend changes expected)
- [ ] 4.5 Commit + push for evaluation
