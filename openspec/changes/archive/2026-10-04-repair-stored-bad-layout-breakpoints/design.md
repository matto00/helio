## Context

See `proposal.md` (Why) and `ticket.md` (owner ruling). Relevant current state on `main` (d4e53e82):

- "Bad" is already defined twice, identically: frontend `features/dashboards/state/breakpointLayout.ts`
  (`isLayoutValid`, `findOverlaps`, `isItemInBounds`) and backend `services/panels/LayoutValidator.scala`, both pinned to
  `shared-test-fixtures/layout-validity.json`. `LayoutPolicy.violations` skips a breakpoint identical to stored — the
  HEL-1071 grandfathering this ticket clears.
- The displayed layout is `resolveDashboardLayout(panels, layout)` (`dashboardLayout.ts`): drops entries for non-live
  ids, compacts an in-bounds overlapping breakpoint, re-derives an out-of-bounds one from the nearest authored
  breakpoint, places panels with no item. The server has no port of it; `LayoutReflow` is a different, shelf-flow
  algorithm used for system-computed layouts.
- Ownership: `DashboardResponse` already carries `ownerId` (the FE `Dashboard` type does not declare it).
  `GET /api/dashboards` lists owned dashboards only (`DashboardRepository.findAll` filters `owner_id`), so the
  authenticated grid only ever opens owned boards today; grantees and public viewers go through
  `PublicDashboardViewerPage` (`/dashboards/:id/panels`). `DashboardService.update` lets editor grantees PATCH layout,
  so PATCH cannot carry an owner-only rule.
- Store-layout classification contract: header of `features/panels/hooks/useLayoutSave.ts` (classes 1-4) and
  `features/layout/README.md`. Persistence is deferred; `buildLayoutPatch` already substitutes the resolved layout for a
  changed-and-invalid breakpoint on a user edit.
- Import: `DashboardServiceValidation.validateImportedLayoutGeometry` 400s on any invalid breakpoint.

## Goals / Non-Goals

**Goals:** owner-only, write-once repair whose stored result equals what the owner already sees; server-enforced
ownership; import stores repaired; seam proof that client output passes the server validator.

**Non-Goals:** fixing the Text-panel-create missing layout item (HEL-1230 finding); persisting derived (merely missing)
breakpoints; repairing via PATCH, MCP or agents; a bulk maintenance job; touching pipelines/sources code (HEL-958,
HEL-1258 lanes). No Flyway migration (V116 stays unused).

## Decisions

**D1 — Client computes the repair, the server authorises and validates it.** The ticket asks for the "resolved
(displayed) layout". Only the client's `resolveDashboardLayout` defines that, so computing it there makes "stored ==
displayed" true by construction. Alternative: server-side repair on read with a Scala port of the resolver. Rejected:
~150 lines of order-sensitive geometry (fixpoint compaction, nearest-breakpoint derivation, panel-order-dependent
placement) duplicated with its own parity fixture, plus a write on a GET. The trust gap of client-supplied geometry is
closed by D2's server checks, so the server never stores something it has not validated.

**D2 — Dedicated endpoint `POST /api/dashboards/:id/layout/repair`, not PATCH.** Body is a bare
`DashboardLayoutPatchPayload` (`{lg?, md?, sm?, xs?}`, item shape via `validateDashboardLayoutItems`); response is
`DashboardResponse`. Both case classes already have schemas (`schemas/dashboards/dashboard-layout-patch.schema.json`,
`dashboard.schema.json`), so no new schema file and no new protocol case class; `npm run check:schemas` must stay green.
New `DashboardService.repairLayout(id, patch, user)`:
1. `dashboardRepo.findById(id, Some(user))` → `None` → 404; `ownerId != user.id` → 403 (mirrors `delete`/`duplicate`;
   editors refused although PATCH admits them). This is the ownership decision; the client check (D4) only avoids calls.
2. Drop supplied breakpoints whose stored value is already valid (`LayoutValidator.isValid`): idempotence, and the
   endpoint can never overwrite a good breakpoint.
3. For each remaining breakpoint: `LayoutValidator.violations` empty; panel ids unique; ids ⊆ P; ⊇ (stored ids ∩ P),
   where P is the dashboard's full panel-id set from a new **`DashboardRepository.panelIdsInternal(dashboardId):
   Future[Set[PanelId]]`** — unpaged `SELECT id FROM panels WHERE dashboard_id = ?` under `withSystemContext`, called
   only after step 1's owner check (the repository's existing `*Internal` convention; `DashboardRepository` already
   maps the panels table). No new `DashboardService` collaborator, so the ~20 fixtures that construct
   `new DashboardService(repo, checker)` are unaffected. Failure → 400 naming the breakpoint, nothing written.
4. Nothing left → 200 with the stored dashboard, no write. Else write through a new **layout-only, compare-and-set**
   `DashboardRepository.updateLayoutIfUnchanged(id, ownerId, expected, next): Future[Boolean]` — `UPDATE dashboards SET
   layout = next WHERE id = ? AND layout = expected` under the owner's `withUserContext`, touching neither `name`,
   `appearance` nor `last_updated` (the list sorts by it; a repair is not an edit). A concurrent rename/appearance change
   therefore survives, and a concurrent layout change makes it affect 0 rows → **409**, nothing written (client logs,
   no retry; the next open re-evaluates). On success, re-read and return the dashboard; audit `dashboard.layout.repair`
   (added to `frontend/src/features/audit/ui/actionLabels.ts`).
Alternative: a flag on PATCH. Rejected: PATCH is editor-reachable and its grandfathering is a contract other callers
(MCP, undo restore) rely on.

**D3 — What RLS gates here, and the non-BYPASSRLS proof.** The 403 for grantees is application logic, not RLS, and is
proven by ordinary route specs. RLS is involved in three places, each proven in a spec on an RLS-enforced connection
(`SET ROLE helio_app_test`, the `RlsOwnerTablesSpec`/`ApiTokenAuthSpec` harness), each with a named red:
(a) the owner's `findById` sharing-aware read returns the row (red: same call as a stranger returns `None`);
(b) `panelIdsInternal` returns every panel id (red: the same query under a stranger's `withUserContext` returns none —
proving the system context is load-bearing, not incidental); (c) `updateLayoutIfUnchanged` as the owner updates 1 row
under policy `dashboards_update` (V36) (red: under a stranger's user context it updates 0 rows, proving the harness
really enforces RLS rather than bypassing it), and with a stale `expected` it updates 0 rows. End to end, one route
test runs the owner's repair against the RLS-enforced pool and asserts the stored breakpoint changed.

**D4 — Client trigger: `useStoredLayoutRepair`, mounted in `PanelGrid` (width-independent).** Fires when: the
dashboard's `ownerId === auth.currentUser.id`; the panels slice is loaded for this dashboard id (the `panelsLoaded`
signal `useLayoutSave` uses — never on an empty/stale list); at least one breakpoint fails `isLayoutValid(stored, cols)`;
and this dashboard id has not been attempted in this mount. Patch = `{bp: resolveDashboardLayout(panels, stored)[bp]}`
for those breakpoints only, built by a pure `buildRepairPatch(panels, layout)` in `features/dashboards/state/`. A failure
(400/403/404/409/network) is `console.warn`-logged once, never toasted, never sets `state.error`, never retried in that
mount; display keeps render-time repair. A >200-panel board (client list paged at `Page.Default`) gets a 400 from D2
step 3 — pinned by a test (no crash, no retry).
**HEL-301 hazard §4.1 — deliberate, single exception.** `PanelGrid.tsx`'s header and `PanelGrid.test.tsx`
("phone width — mobile stack (hazard §4.1)") assert phone width cannot persist layout. The ruling says "opens", not
"opens on desktop", so the repair runs at every width and becomes the one documented exception: phone width still
never PATCHes (`updateDashboardLayout`), never sets pending (`setLayoutPending`) and never runs a user-edit path; its
only possible layout write is the owner's one-time stored-bad repair POST. The `PanelGrid` header, that test block's
contract comment, and `features/layout/README.md` are updated to say exactly this, and a phone-width test proves the
POST is the only write, only for the owner and only for a stored-bad layout (`notes/` is historical and left as is).

**D5 — Store write is class 4 (server truth), applied only over an unchanged layout.** New thunk
`repairDashboardLayout({dashboardId, layout, expectedLayout})` in `dashboardsSlice`; `fulfilled` replaces the
dashboard's layout with the response **only if** the store layout still equals `expectedLayout` (the layout the patch
was computed from) — otherwise it keeps the local layout (D5 of HEL-1230 for PATCH, same idea). It never touches
`layoutHistorySlice` (no undo entry) and never dispatches `setLayoutPending`. In `useLayoutSave` the write is not
class 1 (no local commit equals it), not class 2 (revision unchanged), and cannot be class 3: a stored-bad breakpoint
can only become valid by moving or dropping an existing item, so the old breakpoint is never an exact prefix of the
new one. It therefore re-baselines (pending stays false). The header contract gains an explicit line for it, and a test
pins: no pending, no history entry, no PATCH after the repair, and a subsequent drag persists normally.

**D6 — Import repairs by self-reflow.** `validateImportedLayoutGeometry` stops rejecting geometry;
`DashboardService.importSnapshot` replaces each invalid breakpoint with
`LayoutReflow.reflow(fromItems(items), cols, cols)` before `importSnapshot` writes (reference validation stays a 400).
Self-reflow is valid by construction and keeps exactly the breakpoint's own items. Alternative: client-style
resolution. Rejected: an import has no prior display to match, and it would need the D1-rejected port. Duplicate
(`POST /duplicate`) stays a faithful copy (HEL-1071 exemption); the owner's next open repairs it via D4.

**D7 — Seam test.** `shared-test-fixtures/layout-repair-seam.json`: cases `{name, panels: [ids in order], layout,
expectedRepair}` covering overlap, out-of-bounds, a stale (deleted-panel) entry, a panel with no stored item, and a
dashboard with two bad breakpoints. Jest asserts `buildRepairPatch(panels, layout)` deep-equals `expectedRepair` and
each repaired breakpoint passes `isLayoutValid`. ScalaTest seeds each case (panels created, stored-bad layout written
directly through the repository, never through a validating HTTP path), POSTs `expectedRepair` to the endpoint and asserts 200, stored == expected, and
`LayoutValidator.isValid`. A Jest run against a mutated `buildRepairPatch` (e.g. returning the stored layout) must fail.

## Risks / Trade-offs

- [Client panel list truncated at 200 (`Page.Default`) or stale] → the repair could omit a live panel; D2 step 3
  rejects it with 400, nothing written. Logged, not retried (test-pinned).
- [Import self-reflow (D6) differs from what the exporter saw] → accepted under the ruling "stored repaired"; PR says so.
- [Repaired breakpoint becomes a derivation source for another breakpoint's missing panels] → a *derived* panel at a
  non-repaired breakpoint may move after repair. Stored and repaired positions do not change. Accepted, noted in PR.
- [Two tabs open the board] → second call finds the breakpoint valid and is a 200 no-op (D2 step 2).
- [User drags before the response lands] → D5 keeps the local layout; the server already holds the repair, and the
  next flush sends only changed breakpoints, validated against the repaired stored value.
- [Undo stack holds a pre-repair (bad) layout from earlier in the session] → undo then flushes through
  `buildLayoutPatch`, which substitutes the displayed layout for a changed-and-invalid breakpoint (existing behaviour).

## Migration Plan

No schema change. Deploys as an ordinary backend+frontend release; existing stored-bad boards repair as owners open
them. Rollback: revert; already-repaired breakpoints are simply valid layouts.

## Planner Notes

- Self-approved: D1 client-compute over a server port; D4 viewport-independent trigger; D6 self-reflow on import;
  no `lastUpdated` bump. None is a new dependency, breaking API change, or scope beyond the ticket.
- Driver claims checked: "owner server-side" — payload exposes `ownerId`, server enforces in D2; "server on read" —
  weighed in D1; "Text panel has no layout item" — handled by D2 step 3 and a seam fixture case.
- Tests that rely on current behaviour (grep at design time): `DashboardLayoutValidationSpec` "reject an imported
  snapshot with an overlapping breakpoint" must flip to "stored repaired"; `DesktopPanelGrid.derivedLayout.test.tsx`
  "viewing ... no PATCH" stays true (repair is a POST and its fixtures are valid or non-owner — the executor must
  confirm each viewing test's fixture ownership and stored validity).
