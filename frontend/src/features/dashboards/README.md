# Dashboards

Dashboard CRUD, layout, appearance, and NL authoring/refinement:
`state/dashboardsSlice.ts` and `state/dashboardLayout.ts`; services for CRUD
(`dashboardService.ts`), NL authoring (`authoringService.ts`,
`proposalService.ts`) and conversational refinement (`refinementService.ts`);
`types/` for dashboard, proposal, authoring, and refinement wire shapes;
`hooks/` for dashboard-creation and refinement actions; `utils/` for
authoring/refinement summary text; `ui/` for the list, appearance editor,
proposal review, and refinement chat drawer.

**Belongs here:** dashboard-level state, layout persistence, and the
NL-authoring/refinement flows scoped to a dashboard.
**Does not belong here:** individual panel state/rendering, which lives in
`panels`; combined (dashboard+pipeline) proposal review, which lives in
`proposals`.
