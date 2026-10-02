# Execution progress — HEL-1071

## Write-path enumeration (task 3.8, re-derived from code)

Derived with `grep -rn "dashboardRepo\.\(update\|insert\|replaceContents\|importSnapshot\|duplicate\|updateName\)\|dashboardService\.update"` over `backend/src/main/scala` plus a scan of `infrastructure/` for raw layout SQL (none besides the repo `update`/`DashboardContentsOps.replaceContents`).

| Path | Where | Handling |
|---|---|---|
| `PATCH /api/dashboards/:id` and batch `PATCH /api/dashboards/:id/update` (also MCP `update_dashboard_layout`, patch-set forward edits) | `DashboardService.update` | `LayoutPolicy` (D2/D3): identical passes, absent preserved, changed must be valid or whole write 400. Layout resolved BEFORE the rename write, so a rejected layout saves nothing |
| `POST /api/dashboards/:id/auto-layout` (MCP `auto_layout_dashboard`) | `AutoLayoutService` | per-breakpoint pack at own column count (D5), packed items below kept panels, result through `LayoutPolicy` |
| Panel create (`POST /api/panels`) | `PanelService.placeDefaultLayout` | x=0 below THAT breakpoint's own bottom; returns `layouts` (D4/D11) |
| `POST /api/panels/batch` (`place_outputs`) | `PanelService.batchCreate` | **Design said it uses placeDefaultLayout; the code does not**: batch create writes no layout at all (the MCP `place_outputs` follows up with `auto_layout_dashboard`). No change needed |
| apply proposal | `DashboardProposalService.createAll/applyLayout` | lg validated in `validateStructure` (so also at propose time via `validate`, shared with `DashboardAuthoringService`), md/sm/xs by `LayoutReflow`, write via `DashboardService.update`; failure now surfaced and rolls the new dashboard back (no longer swallowed) |
| `PUT /api/dashboards/:id/contents` | `DashboardContentsService` -> `repo.replaceContents` | same `ProposalLayoutSupport` pre-validation + reflow, before anything is written |
| import | `DashboardServiceValidation.validateSnapshotPayload` | every supplied breakpoint validated against an empty stored layout (D7) |
| duplicate | `DashboardSnapshotRepository.duplicate` | faithful copy, ids remapped, unvalidated (D7); tested |
| patch-set rollback / undo | `PatchSetApplyRollback`, `PatchSetUndoService` | `LayoutWritePolicy.RestorePriorStored` (`private[services]`, unreachable from a route/body); service-level test |
| patch-set PREVIEW | `PatchSetPreviewProjection.dashboardUpdateAfter` | **Found beyond the design table**: it mirrored `applyUpdate`'s layout merge; now uses `LayoutPolicy` so a preview of an invalid layout 400s like the apply |
| first-run / persona dashboards | `FirstRunPlanner.dashboardProposal` -> proposal apply | audited: `FirstRunLayoutValiditySpec` asserts all four persona templates validate at lg and derive valid md/sm/xs |
| `DashboardService.create` | `DashboardLayout.Default` (empty) | nothing to validate |

## Deviations from the design (all conservative)
- `RequestValidation.normalizeLayoutCoordinate/Span` are no longer applied to layout payloads (they silently clamped negatives / sub-1 spans; the owner ruling is reject, never clamp). The functions themselves are untouched.
- `cols > 12` on auto-layout (no `breakpoint`) is now a 400 ("cols must be at most 12"), per D5's "cols>12 -> 400".
- Removed the now-dead proportional scaling helpers from `LayoutBreakpointScaling` (nothing referenced them; keeping them invited re-use of the collapse projection). `breakpointCols` stays the single Scala source.
- `ProposalLayoutSupport.buildLayout` takes panel ids (not `Panel`s) so the persona audit test needs no panel fixtures.
- `DashboardService.scala` is now 431 lines (406 before): over CONTRIBUTING's ~400 "propose a split" line; the import-geometry check already lives in `DashboardServiceValidation`. Split proposal for the PR description: move `validateImportPanels` out into its own collaborator (pre-existing bulk, unrelated to this change).
- Frontend: `useLayoutSave` gained `panels`/`panelsLoaded` options; `layoutPatch.ts` holds the pure patch builder; the thunk re-syncs through the existing `dashboardUpserted` (replace-by-id) action rather than `fetchDashboards`, because `fetchDashboards`'s `condition` guard (`status !== "succeeded"`) would silently skip a re-fetch.

## 3b.4 `setDashboardLayoutLocally` callers (frontend)
| Caller | Why it cannot persist an invalid CHANGED breakpoint |
|---|---|
| `panelThunks.createPanel` | now adopts the server's per-breakpoint `layouts` verbatim (appended below each breakpoint's own bottom, so valid by construction); the client scale projection is deleted. When `layouts` is absent nothing is written locally |
| `DesktopPanelGrid` (drag/resize commit) | RGL runs with `preventCollision` on the RESOLVED layout, so an interaction cannot create an overlap; only the active breakpoint changes; `persistLayout` sends only changed breakpoints and substitutes the resolved one if a changed breakpoint is invalid |
| `useLayoutUndoRedo` x2, `CommandBar` x2 | restore snapshots that may be stored-bad; `persistLayout`'s substitution sends the displayed (resolved) breakpoint (test: undo to a stored-bad snapshot persists a valid sm), the store then converges on the server answer |
| `dashboardsSlice` reducer | the definition; no caller logic |

Design-gate round-2 notes (3b.6): (i) partial PATCH of changed breakpoints only (`DesktopPanelGrid.layoutPatch.test.tsx`, `layoutPatch.test.ts`); (ii) baseline set from the server response (`dashboard.layout`), not `nextLayout`; (iii) substitution only when `panelsStatus === "succeeded"` (test: panels not loaded sends as authored); (iv) 400 message forwarded via `extractErrorMessage` into the rejection payload the existing toast listener already shows, re-sync via `dashboardUpserted` (`dashboardsSlice.layoutReject.test.ts`); (v) `layout` retained and documented as the lg item next to authoritative `layouts` in `schemas/panels/panel.schema.json`.

## Mutation checks (task 1.4) — fixture parity
Both sides, each of the four strict inequalities in the overlap predicate flipped to `<=`/`>=`. The first attempt (only `a.x < b.x + b.w`) passed because the original fixture only had "earlier item on the left/top" touching cases; added two cases (earlier item on the right, earlier item below) and re-ran:

Frontend (`breakpointLayout.ts`, `breakpointLayout.fixture.test.ts`, 28 cases):
- `a.x < b.x + b.w` -> `<=`: 1 failed, 27 passed
- `a.x + a.w > b.x` -> `>=`: 5 failed, 23 passed
- `a.y < b.y + b.h` -> `<=`: 1 failed, 27 passed
- `a.y + a.h > b.y` -> `>=`: 2 failed, 26 passed

Backend (`LayoutValidator.rectsOverlap`, `LayoutValidatorSpec`, 28 tests):
- `a.x < b.x + b.w` -> `<=`: 1 failed, 26 passed
- `a.x + a.w > b.x` -> `>=`: 5 failed, 22 passed
- `a.y < b.y + b.h` -> `<=`: 1 failed, 26 passed
- `a.y + a.h > b.y` -> `>=`: 2 failed, 25 passed
Unmutated: frontend 28/28, backend 28/28. Both files restored (verified by diff/`git status`).

## Lockout / policy mutation checks
- Identity rule disabled (`sameItems` -> `false`): 7 tests fail, including the route-level lockout cases "accept an lg edit while a stored-bad xs rides along reordered, leaving xs byte-identical" (both routes), "whitespace-padded identical panelId is unchanged" (both routes), the service-level grandfathering test, and `LayoutPolicySpec`.
- Validation disabled (`LayoutPolicy.apply` never sees violations): 14 tests fail (all reject-400 route cases on both routes, service-level Validate rejection, `LayoutPolicySpec`, the undo-after-repair seam test).
- Client: `persistLayout`'s resolved-breakpoint substitution disabled -> `DesktopPanelGrid.layoutPatch.test.tsx` 2 of 4 fail (undo-to-bad persists the bad breakpoint).

## Live e2e on the worktree backend (task 6.2)
Backend started with `scripts/concertino/start-servers.sh` (ports 6503/9410) with **`RATE_LIMIT_REQUESTS_PER_WINDOW=2000`** (raised from the 120/60s default for the e2e). Results against the real dev DB as `matt@helio.dev`:
- create output panel response carries `layout` and per-breakpoint `layouts` (md w=5, sm w=3, xs w=1)
- PATCH overlapping xs -> 400 `Layout rejected: breakpoint 'xs': panels '79de..' and '81cb..' overlap`
- PATCH valid xs only -> 200, lg/md/sm unchanged (compared before/after)
- PATCH out-of-bounds xs (x=1,w=2) -> 400 `... is out of bounds (x=1, y=0, w=2, h=2 in a 2-column grid)`
- batch route `PATCH /update` overlapping sm -> 400
- auto-layout, three 4-wide Outputs, no breakpoint -> 200, valid at every breakpoint (xs w=2 stacked)
- auto-layout `breakpoint:"xs"` -> 200, lg/md/sm unchanged
- auto-layout `breakpoint:"xs", cols:12` -> 400 `cols must equal 2 for breakpoint 'xs'`

### Dev-DB rows created (exact ids) and cleaned
- dashboard `d1ef15b1-685a-48b9-8950-b88e93084246` (name "HEL-1071 e2e (delete me)")
- panels `79de9427-10a6-4785-abfa-f4e013f867d9`, `81cb6f31-0de6-475b-88e1-c5b94dbe3ab2`, `b5d253db-2af9-48dc-bb7e-8bbd833db655`
All four deleted via the API by exact id (HTTP 204 each); a re-list confirmed the dashboard absent. Not cleaned (side effects of API use, no API to remove them): one `user_sessions` row from the login (ended with `POST /api/auth/logout`, HTTP 204, so it is revoked rather than deleted) and the `audit_events` rows the API writes for the create/update/delete calls above. No triggers/FKs touched; dashboard 7ad267a8 not touched; no production/gcloud; nothing under `infra/`.

## Ask 4 (production dashboard 7ad267a8, OUT OF SCOPE): what fixing it would take
With this change an agent can repair the roadmap dashboard's xs without touching lg/md/sm: `update_dashboard_layout` with `breakpoint: "xs"` and the full xs item list for all of its panels in 2 columns, e.g. metric tiles as pairs per row (`x:0,w:1` / `x:1,w:1`, distinct `y` per row) and any odd tile or wide panel full width (`x:0,w:2`) on its own row, with `y` offsets so no cell is shared. Because the stored xs is currently bad, the new xs is validated in full (it must be fully valid), and the unchanged lg/md/sm pass untouched. Needs: the production PAT in the MCP, the current panel list/ids/heights (`get_dashboard`), and owner confirmation before writing to production. Alternative: `auto_layout_dashboard breakpoint=xs` with sizes for every panel — but note omitted panels keep their stored xs position and the stored-bad kept panels would make the call 400, so ALL panels must be listed.
