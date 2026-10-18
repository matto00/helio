## Standing Constraints

- [C1] Worker caps: jest and Playwright at most 2 workers, under `nice -n 19`; full Playwright suites under
  `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`,
  `sbt testFull` under the same dir's `sbtfull.lock`; if 1-min load > 10, sleep 60s and recheck (up to 30 min).
- [C2] Never kill/pkill/pgrep/killall or signal a parent process; stop servers only with
  `scripts/concertino/stop-servers.sh`.
- [C3] Delete every test user/dataset/dashboard created for verification, by exact id, before handing back.
- [C5] The refresh line and the D2 effect decide with `panelsKnownFor`, never `panelsSettledFor` (design gate r4 note 1); e2e sampling starts once the routed dashboard is selected, and switch-back cases defeat the HEL-1575 warm restore so the slowed fetch is really exercised.
- [C4] Do not touch HEL-1668 (phone pipeline page) or HEL-1665 (Home on phones) files; desktop layout unchanged.

### Backend

## 1. Backend

- [x] 1.1 Compute `hasPipelineFedPanels` for a page of dashboards in one batched query mirroring `feedingOutputIds`; verify with a repository/service test (output panel -> true; markdown-only, form-only, no panels -> false), as a separate repository method called only from the list route
- [x] 1.2 Add `hasPipelineFedPanels: Option[Boolean] = None` to `DashboardResponse`, set it only on `GET /api/dashboards`; verify with a route test asserting presence on list items and absence on a create/rename response
- [x] 1.3 Declare the optional boolean in `schemas/dashboards/dashboard.schema.json` (+ any contract/schema-drift test); verify the schema-drift check and contract tests pass
- [x] 1.4 Update helio-mcp dashboard types/validators and any list-vs-schema test for the new field; verify helio-mcp tests pass

### Frontend

## 2. Frontend

- [x] 2.1 Add `hasPipelineFedPanels?: boolean` to `Dashboard`; apply one `withKnownFlag` helper at every replace site (upsertDashboardById replace branch + rename/appearance/layout incl. keepLocalLayout/repair); verify with `dashboardsSlice` unit tests incl. `dashboardUpserted`
- [x] 2.2 Extract `App.tsx`'s `currentDashboardPanelsReady` into exported `panelsSettledFor` (App only) and add `panelsKnownFor` (+ stale-empty disjunct) for the effect and the line; verify App tests unchanged plus unit tests (loading `[]`, stale items, pre-dispatch switch frame, restoring, settled-empty, delete-last stale-empty, failed fetch)
- [x] 2.2b Add `dashboardPipelineFedObserved` + the PanelList effect that syncs the flag from settled panels; verify with unit tests (fetch, panelsRestored, in-session add of an output panel, never writes false in a non-settled frame)
- [x] 2.3 `DashboardRefreshLine` reserves per design D3 (`panelsKnownFor` true -> panels; otherwise -> flag); verify with `DashboardRefreshLine.test.tsx` cases (flag true/false/absent, loaded panels override)

### Tests

## 3. Tests and evidence

- [x] 3.1 New `e2e/hel1646-skeleton-refresh-slot.spec.ts`: slowed panels fetch, per-frame placeholder vs real-card top + layout-shift probe, 375 and 430, light and dark, plus markdown-only, both dashboard-switch cases and delete-last-panel; show it red against the unfixed frontend, then green
- [x] 3.2 Re-run `e2e/hel1583-refresh-line-no-shift.spec.ts` and `e2e/hel1583-mobile-dashboard.spec.ts` green; desktop dashboard specs unchanged
- [x] 3.3 Screenshots of skeleton and loaded states (375/430, light/dark) saved to `/home/matt/Development/helio/.concertino/scratch/HEL-1646/`
- [x] 3.4 Pre-commit gates (lint, typecheck, prettier, jest, schema drift, openspec hygiene) and backend `sbt testFull` pass
