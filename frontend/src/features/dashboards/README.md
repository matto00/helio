# Dashboards

Dashboard CRUD, layout, appearance, and NL authoring/refinement:
`state/dashboardsSlice.ts` and `state/dashboardLayout.ts`; `state/repairPatch.ts` builds the
owner's one-time stored-bad-or-incomplete-breakpoint repair body (sent by `useStoredLayoutRepair` in `panels`); services for CRUD
(`dashboardService.ts`), NL authoring (`authoringService.ts`,
`proposalService.ts`) and conversational refinement (`refinementService.ts`);
`types/` for dashboard, proposal, authoring, and refinement wire shapes;
`hooks/` for dashboard-creation and refinement actions; `utils/` for
authoring/refinement summary text; `ui/` for the list, appearance editor,
proposal review, and refinement chat drawer; `state/dashboardFoldersSlice.ts` and
`services/dashboardFolderService.ts` hold the user's per-user folders (HEL-1574), rendered by `ui/DashboardList`.
`tabs/` is the open-dashboard tab set (HEL-1575): `dashboardTabsSlice.ts` (tabs, active id, change signals), `dashboardTabsListeners.ts`
(selection sync, hydration trigger, persistence), `hydrateTabs.ts`, `tabsPersistence.ts` (coalesced `dashboardTabs` preference
writes), `tabsBrowserTriggers.ts` (hidden/pagehide, signal refresh, sweep), `dashboardChangesService.ts`/`refreshChangeSignals.ts`
(`GET /api/dashboard-changes`) and `dashboardTabsSelectors.ts` (the changed-dot rule); `tabs/warm/` is the warm cache that makes a
return to a tab within 15 minutes render without a refetch (in-memory plus a per-user IndexedDB copy, cleared on logout).

**Belongs here:** dashboard-level state, layout persistence, and the
NL-authoring/refinement flows scoped to a dashboard.
**Does not belong here:** individual panel state/rendering, which lives in
`panels`; combined (dashboard+pipeline) proposal review, which lives in
`proposals`.
