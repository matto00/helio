# Home

The Home page at `/home` (HEL-1578): the opening line, the dashboard shelf, the 24h pipeline-run timeline, Needs
attention and Up next. One request of its own, `GET /api/home-summary`; the dashboards list comes from the shell.

- `services/homeService.ts`, `state/homeSummarySlice.ts` (the one thunk, `loadHomeSummary`), `types/homeSummary.ts`.
- `ui/`: `HomePage`, `HomeOpeningLine`, `DashboardShelf` + `LayoutThumbnail`, `PipelineRunsCard` over `RunTimeline` (pointer
  devices, roving tabindex) or `RunDisclosureList` (coarse pointer / phone), `NeedsAttention`, `UpNext`.
- `utils/`: pure, unit-tested helpers (`buildSummarySentence`, `shelfOrder`, `timelineScale`, `timelineMarks`, `relativeShelfTime`).
- `hooks/`: `useCoarsePointer`, and `useChangedDashboardIds` (the Phase B seam for the changed dot).

Per-dashboard "last seen" stamps (`helio.dashboardSeen`) live beside the palette's recent-visit list in
`features/commandPalette/model/dashboardSeenStore.ts`; `features/dashboards/hooks/useDashboardViewStamp.ts` writes them.

**Belongs here:** the Home page's own UI, state and helpers.
**Does not belong here:** the shelf's first-run drop zone (`features/onboarding`) or the guarded run submit
(`features/pipelines/services/runToUpdate.ts`), which Home only calls.
