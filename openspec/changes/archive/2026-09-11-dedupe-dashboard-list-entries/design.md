## Context

`e2e/focus-presence-guard.spec.ts:163` intermittently (4/60 recent runs) finds two
`dashboard-list__button` elements for the same freshly-created dashboard name, both
`aria-pressed="true"`. `DashboardList` has exactly one mount point in the app
(`App` → `Sidebar` → `SidebarBody` → `DashboardList`), so a real duplicate render implies two
entries in `dashboardsSlice`'s `items` array (same id twice, or two backend rows with the same
name but different ids) rather than a double-mount.

Orchestrator premise-validation found `createDashboard.fulfilled` appends without de-duping by id,
and `fetchDashboards.fulfilled` fully *replaces* `items` (not merges) — so the exact race narrated
in the ticket (append + concurrent-refetch-append) is not obviously mechanical from reading the
reducers alone; a stale-vs-fresh fetch racing a create would more naturally cause the new dashboard
to disappear-then-reappear than to duplicate, unless the ordering is different from assumed, or the
duplicate instead comes from two distinct backend rows (e.g. a double POST from a UI double-submit
vector, per the open, possibly-related HEL-706).

## Goals / Non-Goals

**Goals:**
- Confirm the actual root cause with a deterministic, reproducible probe before writing any fix
  (`.concertino/laws/systematic-debugging.md`).
- Make it structurally impossible for `dashboardsSlice.items` to hold two entries with the same
  dashboard id, regardless of which network race produces the situation.
- Add a regression guard that fails (goes red) when the fix is reverted.
- Determine explicitly whether this is the same defect as HEL-706, and whether panels/sources/
  pipelines slices share the same at-risk shape.

**Non-Goals:**
- Fixing HEL-706 itself, unless the probe shows it is the literal same defect.
- Preemptively de-duping every other resource slice without evidence they share the defect.
- Loosening the e2e locator (`.first()`) or adding a wait/retry to paper over the flake.

## Decisions

1. **Probe first.** Reproduce the duplicate deterministically in a test — e.g. a store/thunk-level
   test that dispatches `createDashboard` and `fetchDashboards` with controlled resolution order
   (delay one relative to the other, and try both orderings), or an integration test that mocks the
   API layer to delay the list response past the create response. The test must go **red** against
   today's reducers before any fix lands, per AC1. If the probe instead points at a double
   dashboard-create request (two backend rows), reproduce that at the request layer (e.g. assert
   the create submit path can't fire twice) instead of forcing the slice narrative to fit.
2. **Fix at the reducer boundary, not the fetch race.** Whichever mechanism the probe confirms, the
   authoritative fix is de-duplication by id wherever `items` can gain an entry: `createDashboard.
   fulfilled`'s push and `fetchDashboards.fulfilled`'s replace should both guarantee no duplicate id
   survives (e.g. push-or-replace-by-id on create; the fetched list is already authoritative and
   inherently duplicate-free per dashboard id from the backend, so no change is needed there unless
   the probe shows otherwise). This is deliberately conservative — the fix should not be broader
   than what the probe justifies.
3. **Scope check, not blanket action.** Once the mechanism is confirmed, check whether
   `panelsSlice`/`dataSourcesSlice` (sources)/`pipelinesSlice` have an equivalent create-append
   reducer with the same risk shape. If yes, state so explicitly in the PR; only fix them in this
   same change if it's a small, mechanical, same-shape edit — otherwise file a follow-up ticket via
   the standard triage flow rather than silently widening scope.
4. **Regression guard.** A unit/integration test asserting no duplicate id can result from the
   confirmed race, written so that reverting the fix (removing the de-dupe check) makes it fail —
   state the exact mutation exercised (e.g. "removing the id de-dupe branch in `createDashboard.
   fulfilled` turns this red").

## Risks / Trade-offs

- If the probe surfaces a different root cause than either hypothesis above (e.g. a backend-side
  duplicate insert), the fix location changes; this design intentionally does not pre-commit to the
  frontend-only narrative — the probe governs, not this document.
- De-duplicating by id in the reducer is a small, low-risk change but must preserve existing
  ordering/selection semantics (`getMostRecentDashboardId`, `selectedDashboardId` assignment) —
  tests should cover that the fix doesn't change dashboard ordering for the non-race case.
