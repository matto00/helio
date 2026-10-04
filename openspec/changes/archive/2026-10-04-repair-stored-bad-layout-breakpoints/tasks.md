## Standing Constraints

- [C1] Every red/green claim names the exact mutation and shows the failing run; seed stored-bad layouts via the
  repository or raw SQL, never a validating HTTP path.

## 1. Backend repair endpoint

- [x] 1.1 `DashboardRepository.panelIdsInternal` (unpaged, system context) and `updateLayoutIfUnchanged` (layout column
      only, `WHERE layout = expected`, owner user context) per design D2
- [x] 1.2 `DashboardService.repairLayout(id, patch, user)` per design D2 (404 no access, 403 non-owner incl. editor;
      skip already-valid stored breakpoints; validate geometry + id uniqueness + ⊆ dashboard panels + no live panel
      dropped; no-op 200 when nothing to write; compare-and-set write, 0 rows → 409; audit `dashboard.layout.repair`)
- [x] 1.3 Route `POST /api/dashboards/:id/layout/repair` in `DashboardRoutes`, body bare `DashboardLayoutPatchPayload`,
      response `DashboardResponse`; no new schema file (both already in `schemas/dashboards/`); `npm run check:schemas`
      green
- [x] 1.4 Route/service specs: owner repair stored; editor grantee 403; viewer grantee 403; stranger 404; drop-a-live-panel
      400; stale-entry drop allowed; panel-with-no-item added; already-valid breakpoint ignored; second call no write;
      name/appearance/`lastUpdated` unchanged (incl. a rename landing between read and write); stale `expected` → 409;
      good breakpoints untouched; a stored-bad layout seeded by raw SQL with different key order/spacing still
      matches the compare-and-set (skeptic-design-2 note)
- [x] 1.5 Non-BYPASSRLS spec per design D3 (`helio_app_test` harness): (a) sharing-aware read, (b) `panelIdsInternal`
      system context, (c) owner-context compare-and-set write, each with its named red; plus one end-to-end owner repair
      on the RLS-enforced pool

## 2. Import repairs

- [x] 2.1 `validateImportedLayoutGeometry` no longer rejects geometry; `importSnapshot` self-reflows each invalid
      breakpoint with `LayoutReflow` (design D6); reference validation still 400s
- [x] 2.2 Flip `DashboardLayoutValidationSpec`'s import-overlap rejection test to "stored repaired, both panels kept,
      other breakpoints as supplied"; add out-of-bounds import case

## 3. Frontend

- [x] 3.1 Declare `ownerId` on the frontend `Dashboard` type (and any fixtures/factories that must supply it)
- [x] 3.2 Pure `buildRepairPatch(panels, layout)` in `features/dashboards/state/` (stored-bad breakpoints only, value =
      `resolveDashboardLayout(panels, layout)[bp]`) with unit tests
- [x] 3.3 `repairDashboardLayout` service call + thunk; `fulfilled` applies only when the store layout still equals
      `expectedLayout` (design D5); never touches history or `setLayoutPending`; rejection never toasts or sets
      `state.error`
- [x] 3.3a Add `"dashboard.layout.repair"` to `frontend/src/features/audit/ui/actionLabels.ts`
- [x] 3.4 `useStoredLayoutRepair` hook mounted in `PanelGrid` (design D4): owner check, panels-loaded check, once per
      dashboard per mount, no retry after failure; update `PanelGrid.tsx` header and the "phone width — mobile stack
      (hazard §4.1)" test-block contract comment to name the repair POST as the single deliberate exception (design D4)
- [x] 3.5 Extend the HEL-1230 classification contract in `useLayoutSave.ts`'s header and `features/layout/README.md`
      with the repair write (class 4, why it cannot match 1-3)
- [x] 3.6 Tests: owner + bad → one POST with only bad breakpoints, no PATCH, no pending, no history entry, displayed
      positions unchanged; owner + valid → no POST; non-owner → no POST; panels not loaded → no POST; local edit before
      response → local layout kept; drag after repair persists normally; phone width: the repair POST is the only write
      (no `updateDashboardLayout`, no `setLayoutPending`), owner-only, stored-bad-only; >200-panel 400 → no crash, no
      retry, no toast
- [x] 3.7 Re-check every existing "viewing writes nothing" test (e.g. `DesktopPanelGrid.derivedLayout.test.tsx`,
      `PanelGrid.test.tsx`, `MobilePanelStack.test.tsx`) still holds and why

## 4. Seam proof

- [x] 4.1 `shared-test-fixtures/layout-repair-seam.json` per design D7 (overlap, out-of-bounds, stale entry, panel with no
      stored item, two bad breakpoints)
- [x] 4.2 Jest seam test: `buildRepairPatch` output equals fixture and is valid; record a red run against a mutation
- [x] 4.3 ScalaTest seam test: each fixture's `expectedRepair` POSTed to the endpoint → 200, stored == expected, valid

## 5. Docs and gates

- [x] 5.1 Document the endpoint in `CLAUDE.md` Key endpoints and the relevant backend/frontend READMEs
- [x] 5.2 Gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`; backend `nice -n 19 sbt testFull`
      (Bash timeout 600000; known flakes rerun, not fixed); `sbt --client shutdown` as its own call
- [x] 5.3 Live UI check (light + dark) on this worktree's own ports: seeded bad-breakpoint dashboard opened as owner (one
      repair write, reopen none) and as a non-owner (no write); residue deleted by exact id
