## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review — no prior report taken on faith. Read `ticket.md`, `proposal.md`, `design.md`
(D1-D7 + D1a), `tasks.md` (26/26), `evaluation-1.md` (cycle 1, FAIL on CR1), `evaluation-2.md`
(cycle 2, PASS) fresh from the worktree, then independently re-verified against
`git diff 22de7331..HEAD` (both of this ticket's own commits: `0c3fc279` and `7e03dbbf`).

### What I verified (with evidence)

**Backend implementation matches design.md, verified against real source (not the design doc's
own claims):**
- `PatchSetPreviewService.preview` calls `PatchSetApplyResolvers.resolveAll` verbatim, then
  short-circuits on the first `Left` from `PatchSetPreviewProjection.project` via the same `loop`
  regardless of whether the `Left` originated from `resolveAll` or a projection-level content
  check (`PatchSetPreviewService.scala:47-71`) — matches D1/D1a's "whole-call failure" claim.
- `PatchSetPreviewProjection.dataTypeDeleteAfter` runs `checkSourceLink` BEFORE
  `existsBoundToAnyOwnedPanel` (`PatchSetPreviewProjection.scala:311-318`) — cross-checked against
  the real `DataTypeService.delete` (`DataTypeService.scala:126-141`): same order. D1's
  mutual-exclusivity justification for why this order doesn't matter holds up on inspection.
- D3's timestamp exclusion: `dashboardUpdateAfter`/`dataSourceUpdateAfter`/`dataTypeUpdateAfter`
  all leave `meta`/`updatedAt` at `prior`'s value (`PatchSetPreviewProjection.scala:199-204,
  226-238, 289-294`) — confirmed in code.
- D4's `PanelRepository.existsBoundToType` (`PanelRepository.scala:231-234`): genuinely
  RLS-scoped raw SQL with no `owner_id` predicate, run under `withUserContext`. Its test harness
  (`PatchSetPreviewServiceSpec.scala:1-140`) is a real, non-superuser `helio_app_test` dual-pool
  harness (`SET ROLE helio_app_test` on the app pool, a separate `helio_privileged` pool) —
  matches `WorkspaceTeardownServiceSpec`'s established pattern, not the RLS-bypassing
  `DbContext(db, db)` shortcut. Tests 6.5i/6.5j/6.5k/6.5l/6.5m (`PatchSetPreviewServiceSpec.scala:
  617-670`) genuinely distinguish "bound panel on a dashboard visible via a sharing grant" (→
  `true`) from "bound panel on an invisible dashboard" (→ `false`) — proving the RLS narrowing is
  real, not merely that the method compiles under a superuser connection.
- D6 route reachability: `/patch-sets/review` is wired into `App.tsx:513` alongside
  `/proposals/review:512`, confirmed live (see UI verification below).
- D5 route/protocol: `PatchSetRoutes.scala` adds `path("preview")` alongside the existing
  `/apply` in the same file; `PatchSetPreviewProtocol.scala`'s `EditPreview`/
  `PatchSetPreviewResponse` match `schemas/patch-set-preview-response.schema.json` field-for-field.
  `ApiRoutes.scala`/`JsonProtocols.scala` wiring confirmed (constructor param + trait mixin only,
  no existing route/protocol modified).
- No inline FQNs in the new backend files (`grep` for `com\.helio\.` outside `import` blocks in
  `PatchSetPreview*.scala` returns only import statements).

**Fresh gate re-run, this worktree, HEAD = `7e03dbbf` (not taken from any report):**
- `npm run lint` — clean, 0 warnings.
- `npm run format:check` — clean.
- `npm test` — 148 root + 1578 frontend = 1726 passed, 0 failed. Matches evaluation-2.md exactly.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size advisory only).
- `cd backend && sbt test` — **2676/2676 passed**, 0 failed.
- `npm run check:scala-quality` — clean (95 pre-existing informational file-size warnings).
- `npm run check:schemas` — clean (46 protocols checked).
- `npm run check:openspec` — flags "complete (26/26) but not archived," the same precedented,
  non-blocking archive-is-a-later-phase note both evaluation cycles already disclosed.

**Frontend design compliance:** `PatchSetReview.css` uses `--app-*`/`--space-*`/`--text-*` tokens
throughout; the one literal `2px` (in `.patch-set-review__op`) matches DESIGN.md's explicit
"optical tweaks ≤4px may be literal" allowance and is the exact same recipe
`ProposalReview.css:62` already uses. Verified live in both dark and light theme (screenshots
taken) — proper contrast, opaque surfaces, no accent misuse, consistent with `ProposalReview`'s
established modal chrome in both themes.

**Live UI verification (Playwright, servers already running, `PASS servers` via
`assert-phase.sh`):** navigated to `/patch-sets/review`, confirmed the demo/fixture entry point
renders a real diff (kind/op/impact/before/after), Accept/Reject wired correctly, no console
errors, light/dark parity holds.

### The fix commit (`7e03dbbf`) — genuine defect found

Per the orchestrator's explicit ask to scrutinize whether the panel/dashboard-only scoping is
"genuinely correct and non-misleading": the *kind* scoping (panel/dashboard now, dataType/
dataSource/pipeline deferred) is honestly documented and matches what's actually reachable
through this ticket's shipped surface (verified: `grep` for `patch-sets/review` outside tests
finds only the `App.tsx` route registration — no nav link exists, matching `/proposals/review`'s
own precedent). That part of evaluation-2.md's Phase 1 conclusion is correct.

But `invalidateAffectedState`'s panel-refresh logic (`patchSetsSlice.ts:139-148`) has a genuine,
**live-reproduced** bug that neither evaluation cycle caught:

```ts
touchedPanelDashboardIds.forEach((dashboardId) => {
  dispatch(markDashboardPanelsStale(dashboardId));
  dispatch(fetchPanels(dashboardId));   // <-- unconditional, no "is this the displayed dashboard?" guard
});
```

`markDashboardPanelsStale` is self-guarded — its reducer (`panelsSlice.ts:85-89`) no-ops unless
`state.loadedDashboardId === action.payload`. But the very next line, `dispatch(fetchPanels(dashboardId))`,
has **no such guard**: `fetchPanels`'s `condition` (`panelThunks.ts:69-78`) only dedupes a
redundant fetch for the *same* `dashboardId`; it does not check whether that dashboard is the one
currently displayed. `panelsSlice` models a single "currently loaded" dashboard (`items` +
`loadedDashboardId`, `panelsSlice.ts:29-38`), so this call **unconditionally overwrites the panel
grid with whichever dashboard the patch set touched — even when that's a different dashboard than
the one the user is currently viewing.**

The commit message justifies this by "mirroring `panelThunks.ts`'s `createPanel`/`duplicatePanel`
mark-then-refetch pattern" — but that precedent relies on an invariant that doesn't hold here:
`createPanel`/`duplicatePanel` are only ever invoked by UI affordances scoped to the *currently
displayed* dashboard (there's no "add a panel to some other dashboard" button), so their
`dashboardId` argument always equals the displayed one by construction. Patch-set apply has no
such constraint — the demo/fixture entry point itself (`PatchSetReviewPage.tsx`'s
`synthesizeDemoPatchSet`, `PatchSetReviewPage.tsx:147-166`) always targets `dashboards[0]` (the
*most-recently-updated* dashboard, per `fetchDashboards`' documented ordering), independent of
whatever `selectedDashboardId` currently is.

**Reproduced live:** with two dashboards seeded ("Revenue by Region," most recently updated, and
"Skeptic Isolation Test," 2 panels: Isolation Pie, Control Bar), I selected "Skeptic Isolation
Test" via a genuine client-side SPA navigation (no reload — confirmed the sidebar/breadcrumb both
showed it as the active dashboard), then client-navigated to `/patch-sets/review`
(`history.pushState` + `popstate`, avoiding a hard reload that would reset Redux state). The demo
patch set targeted "Revenue by Region"'s panel (confirmed via the rendered before/after JSON:
`"dashboardId": "ea1a1d3d-ff32-4985-b55c-c611f993c04d"`, the "Revenue by Region" id — not
"Skeptic Isolation Test"'s `ff4a44af-...`). Clicking "Accept & apply":
- Network log: `POST /api/patch-sets/apply` (200) immediately followed by
  `GET /api/dashboards/ea1a1d3d-ff32-4985-b55c-c611f993c04d/panels` (200) — the *wrong*
  dashboard's id, not `ff4a44af-...`.
- Resulting page state: breadcrumb and sidebar **both still show "Skeptic Isolation Test" as the
  active dashboard** (correct chrome), but the panel grid now shows **"1 panel" — "Total Revenue
  by Region (previewed)..."** — "Revenue by Region"'s panel, not "Skeptic Isolation Test"'s actual
  2 panels (Isolation Pie, Control Bar). No console errors — this fails completely silently.

This is a real, silent, cross-dashboard display-corruption bug: the app shows one dashboard's
chrome (sidebar/breadcrumb) while displaying a *different* dashboard's panel content, and this
state persists until the user manually switches dashboards or reloads (since `App.tsx`'s own
`fetchPanels` effect only re-fires when `selectedDashboardId` itself changes, `App.tsx:289-294`,
which this flow never touches). It is reachable through the ticket's own shipped demo/fixture
entry point today — no future NL-authoring caller is required — whenever a user's currently
selected dashboard is not the most-recently-updated one, which is a common, ordinary scenario
(anyone who has more than one dashboard and isn't currently viewing whichever was edited most
recently).

Neither evaluation cycle caught this because both live walkthroughs (evaluation-1.md, and
evaluation-2.md's re-test) happened to test with the demo's target dashboard being the currently
active one — the default state on a fresh page load, since `selectedDashboardId` is itself
initialized to the most-recently-updated dashboard (`getMostRecentDashboardId`,
`dashboardsSlice.ts:44-46`, applied on `fetchDashboards.fulfilled`). The new regression test added
by this fix (`PatchSetReviewPage.test.tsx`'s "Accept refreshes the touched dashboard's cached
panels" test) also only exercises the matching-dashboard case — there is no test anywhere in this
diff for the mismatched case, so this gap would not have been caught by the test suite either.

### Verdict: REFUTE

### Change Requests

1. **Fix `invalidateAffectedState`'s panel refetch to respect the currently-displayed dashboard**
   (`frontend/src/features/patchSets/state/patchSetsSlice.ts:139-148`). Guard the
   `dispatch(fetchPanels(dashboardId))` call so it only fires when `dashboardId` is the dashboard
   actually being displayed (e.g. check `getState().panels.loadedDashboardId === dashboardId`, or
   equivalently `getState().dashboards.selectedDashboardId === dashboardId`, inside
   `applyPatchSet`'s thunk before calling `invalidateAffectedState`, or by threading `getState`
   into `invalidateAffectedState` itself). `markDashboardPanelsStale` alone is already safe (it
   no-ops for a non-loaded dashboard via its own reducer guard, `panelsSlice.ts:85-89`) — it is
   specifically the unconditional `fetchPanels(dashboardId)` dispatch that needs the guard.
   Add a regression test that reproduces this scenario: apply an edit targeting a dashboard OTHER
   than the one currently loaded in `panelsSlice` (`loadedDashboardId` set to a different id before
   dispatching `applyPatchSet`/`invalidateAffectedState`), and assert `panelsSlice.items`/
   `loadedDashboardId` are left unchanged rather than overwritten with the touched-but-not-displayed
   dashboard's panels.

### Non-blocking notes

- (carried over from evaluation-1.md/evaluation-2.md, still open, still non-blocking) No
  `PatchSetPreviewServiceSpec.scala` test exercises a D1a content-check rejection on a non-first
  edit in a multi-edit patch set — verified correct by inspection (same short-circuit `loop`
  handles both cases identically), just untested for that specific shape.
- At the 430px breakpoint, `PatchSetReview.css`'s before/after JSON columns get visually dense
  (heavy mid-token wrapping in `--text-xs` mono) — contained, no overflow, a density judgment call
  rather than a violation.
- The documented `dataType`/`dataSource`/`pipeline` cache-staleness follow-on
  (`patchSetsSlice.ts:69-74`) is honestly scoped and correctly out of this ticket's reach today —
  worth a tracked spinoff ticket once a real NL-authoring caller can target those kinds, same as
  evaluation-2.md already noted.
