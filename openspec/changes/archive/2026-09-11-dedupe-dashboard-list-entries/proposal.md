## Why

`e2e/focus-presence-guard.spec.ts:163` fails intermittently (4/60 recent CI runs) with a Playwright
strict-mode violation: two `dashboard-list__button` elements resolve for the same dashboard name,
both `aria-pressed="true"`, right after create. Each e2e run registers a fresh user, so this cannot
be leftover test data — the dashboards list is holding a genuine duplicate entry for one dashboard.
This blocks `ci-complete` roughly 1 run in 15 and may be visible to real users, not just under test
timing.

## What Changes

- Root-cause the duplicate via a deterministic probe (not inference) — likely candidates: the
  `createDashboard.fulfilled` reducer appending without de-duping by id, a race with a concurrent
  `fetchDashboards` refetch, or a genuine double dashboard-create request landing two backend rows.
- Fix the dashboards slice (and any sibling slice — panels/sources/pipelines — found to share the
  same append shape) at the source so `items` can never hold two entries for the same dashboard id.
- Add a regression guard (unit/integration) that fails when the fix is reverted, plus keep the
  existing e2e assertion as an end-to-end backstop (no locator loosening).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `frontend-dashboard-creation`: the created dashboard MUST be added to frontend state without
  producing a duplicate entry, even under a concurrent list refetch or a duplicate create response.

## Impact

- `frontend/src/features/dashboards/state/dashboardsSlice.ts` (createDashboard/fetchDashboards
  reducers)
- Possibly `frontend/src/features/dashboards/ui/DashboardList.tsx` if the double-submit vector is
  implicated (see HEL-706 relation, to be confirmed or refuted during execution)
- `e2e/focus-presence-guard.spec.ts` (no behavior change expected — the existing strict-mode
  assertion should simply stop flaking)

## Non-goals

- Not fixing HEL-706 itself unless it is confirmed to be the exact same defect.
- Not adding de-dupe to other slices unless a probe confirms they share this defect (any such
  finding is flagged, not silently expanded into scope).
