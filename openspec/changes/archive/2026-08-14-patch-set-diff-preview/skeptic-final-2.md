## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review — no prior report or the round-1 skeptic's narrative taken on faith. Read
`ticket.md`, `proposal.md`, `design.md` (D1-D7 + D1a), `tasks.md` (26/26), `skeptic-final-1.md`
(round 1, REFUTE on CR1) fresh from the worktree, then independently re-derived every claim
against `git log`/`git show db182c63` and live source at HEAD = `db182c63` (working tree clean,
confirmed via `git status`).

### Round 1's defect, re-verified as genuinely fixed

**Source-level verification of the fix mechanism** (`patchSetsSlice.ts:129-172`):
`invalidateAffectedState` now takes a fourth `getState: () => RootState` parameter; inside the
`touchedPanelDashboardIds.forEach` loop, `if (getState().panels.loadedDashboardId !== dashboardId)
return;` gates BOTH `dispatch(markDashboardPanelsStale(dashboardId))` and
`dispatch(fetchPanels(dashboardId))` — the previously-unconditional `fetchPanels` call is now
inside the same guarded block as the already-safe `markDashboardPanelsStale` call, closing round
1's exact gap (`markDashboardPanelsStale` was self-guarded via its own reducer; `fetchPanels` was
not).

**The "read BEFORE markDashboardPanelsStale" ordering claim, checked against the real reducer**
(`panelsSlice.ts:85-87`):
```
.addCase(markDashboardPanelsStale, (state, action) => {
  if (state.loadedDashboardId !== action.payload) return;
  state.loadedDashboardId = null;
})
```
Confirmed: on a match, this reducer sets `loadedDashboardId` to `null`. The fix's guard check
executes as the FIRST line inside the loop body, before either dispatch — so it genuinely reads
the pre-dispatch value. Had the check instead been placed after `dispatch(markDashboardPanelsStale(...))`,
it would read `null` and always be false for the matching case, silently breaking the still-required
matching-dashboard refresh. The commit's own code comment (`patchSetsSlice.ts:160-162`) states this
reasoning explicitly and it holds up against the real reducer, not just the comment's own claim.

**The sole production call site**: `grep -rn "invalidateAffectedState" frontend/src` shows exactly
one caller (`applyPatchSet`'s thunk, `patchSetsSlice.ts:186`), correctly updated to pass `getState`
(already destructured from the thunk's `createAsyncThunk` callback args). No dangling caller left on
the old 3-arg signature — build/lint/tsc all clean (see Gate re-run below), which would have failed
loudly on a signature mismatch.

### Live reproduction — round 1's exact scenario, now fixed

Servers already running and healthy; confirmed via a fresh `scripts/concertino/assert-phase.sh
servers` → `PASS servers`.

Reused the same seed data round 1 used (persisted in this worktree's dev DB since round 1's own
session): "Revenue by Region" (id `ea1a1d3d-ff32-4985-b55c-c611f993c04d`, the demo/fixture's
`dashboards[0]` target) and "Skeptic Isolation Test" (id `ff4a44af-...`, 2 real panels: Isolation
Pie, Control Bar).

**Mismatched-dashboard case (the round-1 defect scenario):**
1. Client-side SPA navigation (no reload) to "Skeptic Isolation Test" — confirmed active in both
   breadcrumb and sidebar, "2 panels" (Isolation Pie, Control Bar) rendered.
2. Client-side navigation (`history.pushState` + manual `popstate` dispatch, avoiding a hard
   reload that would reset Redux state) to `/patch-sets/review` — sidebar/breadcrumb still show
   "Skeptic Isolation Test" as active (client routing preserved store state). The demo patch set's
   before/after JSON confirms `"dashboardId": "ea1a1d3d-..."` — "Revenue by Region," NOT the
   currently-displayed dashboard, exactly reproducing round 1's setup.
3. Clicked "Accept & apply." Network log: `POST /api/patch-sets/apply` (200) with **no** subsequent
   `GET /api/dashboards/ea1a1d3d-.../panels` request anywhere in the log (checked the full request
   list before/after the apply call — the only `GET .../panels` calls present are earlier,
   pre-Accept loads). Resulting page state: breadcrumb + sidebar still show "Skeptic Isolation
   Test," and the panel grid **still shows exactly 2 panels — Isolation Pie, Control Bar,
   unchanged** — no cross-dashboard corruption. Zero console errors.

This directly contradicts and fixes round 1's live-reproduced finding: the touched-but-not-displayed
dashboard's cache is now left alone entirely, and chrome/grid stay consistent.

**Matching-dashboard case (confirming no overcorrection — the fix must still refresh when the
touched dashboard IS on screen):**
1. Selected "Revenue by Region" (the dashboard the demo patch set actually targets) as the active
   dashboard.
2. Navigated (same client-side method) to `/patch-sets/review`, clicked "Accept & apply."
3. Network log: `POST /api/patch-sets/apply` (200) **immediately followed by** `GET
   /api/dashboards/ea1a1d3d-.../panels` (200) — a genuine refetch fired. The panel grid updated
   in place without a manual reload (title gained another "(previewed)" suffix, confirming a live
   re-render from the fresh fetch, not a stale cached value). Zero console errors.

This confirms the fix did not overcorrect into never refreshing — the original cycle-1 defect
(evaluation-1.md CR1: Accept not refreshing the visible dashboard) remains fixed for the case that
actually needs it.

### Regression tests — meaningfully assert the fixed behavior, not just code-path coverage

Read `patchSetsSlice.test.ts` and `PatchSetReviewPage.test.tsx` in full (not just the `db182c63`
diff) at HEAD:
- `patchSetsSlice.test.ts`'s `"does NOT touch panelsSlice when the patched panel's dashboard is NOT
  the one currently displayed"` asserts `dispatch` was never called at all (0 calls) when
  `loadedDashboardId` is a different id — a real negative assertion, not merely "no error thrown."
  A sibling test covers `loadedDashboardId: null` (no dashboard loaded) with the same zero-dispatch
  assertion.
- `PatchSetReviewPage.test.tsx`'s new end-to-end RTL test seeds a REAL, different dashboard's real
  cached panel (`preloadedState`), clicks Accept, and asserts `mockedFetchPanels` (the underlying
  HTTP service mock, not just the thunk) was never called, AND that
  `store.getState().panels.items`/`loadedDashboardId` are byte-for-byte unchanged from what was
  seeded — this is the strongest possible assertion for "nothing was overwritten," genuinely
  exercising the full thunk → guard → (no-op) path through a real configured Redux store, not a
  mocked `invalidateAffectedState`.
- The pre-existing matching-dashboard test was correctly retained/renamed (not deleted) and now
  explicitly seeds `loadedDashboardId` to the matching id via `preloadedState`, confirming the
  positive case is still asserted end-to-end (`mockedFetchPanels` called with the right id,
  `store.getState().panels.items` updated to the new fetch result).

These are not coverage padding — each assertion would fail if the guard were removed, inverted, or
placed after the `markDashboardPanelsStale` dispatch.

### Edge case: multiple touched dashboards in one patch set, some matching some not

Not covered by a dedicated new test, but verified correct by inspection of the real code shape:
`touchedPanelDashboardIds` is a `Set<string>`, and the guard is evaluated independently, fresh,
inside each `forEach` iteration (`getState()` is re-invoked per iteration, not hoisted before the
loop). Since `panelsSlice` models exactly one `loadedDashboardId` at a time, at most one entry in
the Set can ever match on a given iteration; every non-matching entry independently short-circuits
before either dispatch. There is no shared mutable state between iterations that could cause a
false match/miss for a different id (the one dispatch pair that DOES fire, for the matching id,
sets `loadedDashboardId` to `null` then back to itself via `fetchPanels.pending`, which cannot
retroactively make a different, already-`Set`-deduped id match on a later iteration). This is
architecturally sound, not merely "no test found it broken." A follow-on multi-dashboard test would
be nice-to-have but its absence doesn't leave a genuine gap given the independent-per-iteration
mechanics — non-blocking.

`dashboardUpserted`/`dashboardRemoved` (dashboard-kind edits) are correctly left unguarded — they
merge into `dashboardsSlice.items` by id, a list-shaped cache with no "single currently loaded"
concept the way `panelsSlice` has, so there's no analogous cross-dashboard corruption risk for
that path. Confirmed against the real reducers (`dashboardsSlice.ts:216-233`): `dashboardUpserted`
does a `findIndex`+replace-or-push; `dashboardRemoved` filters by id and only reselects
`selectedDashboardId` if it matched the removed id. Both are safe regardless of which dashboard is
displayed.

### Fresh gate suite re-run, this worktree, HEAD = `db182c63` (not taken from any report)

- `npm run lint` — clean, 0 warnings.
- `npm run format:check` — clean.
- `npm test` — 148 root + 1581 frontend = 1729 passed, 0 failed (frontend count matches the
  commit message's claimed 1581 exactly — 3 more than round 1's 1578, matching the 3 new/modified
  tests this fix added).
- `npm --prefix frontend run build` — succeeds (same pre-existing >500kB chunk-size advisory,
  unrelated).
- `cd backend && sbt test` — **2676/2676 passed**, 0 failed (unchanged — this fix is frontend-only,
  confirmed via `git show db182c63 --stat`: no `backend/` files touched).
- `npm run check:scala-quality` — clean (95 pre-existing informational file-size warnings, same
  count as round 1).
- `npm run check:schemas` — clean (46 protocols checked).
- `npm run check:openspec` — flags "complete (26/26) but not archived," the same precedented,
  non-blocking archive-is-a-later-phase note both prior evaluation cycles and round 1's skeptic
  already disclosed.
- `npx tsc --noEmit -p .` (extra check beyond the standard gate, run to double-check the
  `getState`-typed signature change): 54 pre-existing errors, ALL in
  `frontend/src/features/toasts/state/toastListeners.ts` and
  `frontend/src/store/listenerMiddleware.ts` — confirmed via `git log --oneline -1 -- <path>` that
  neither file has been touched since `ef463006` (HEL-245, unrelated, pre-dates this ticket). Zero
  errors anywhere in `patchSets/` — the signature change type-checks cleanly.

All figures match `db182c63`'s own commit message claims exactly.

### Backend re-spot-check (unchanged this round, re-grounded rather than re-trusted wholesale)

Since `db182c63` touches no backend file, I did not re-derive round 1's full backend verification
from scratch, but spot-checked the load-bearing claims directly against source rather than trusting
round 1's narrative: `PatchSetPreviewService.scala`/`PatchSetPreviewProjection.scala` contain no
`.update(`/`.create(`/`.delete(`/`.insert(`/`replace`/`Repository...insert` calls (grep, zero
matches — genuinely read-only, AC1). `PatchSetRoutes.scala:38-52` wires both `path("apply")` and
`path("preview")` in the same existing file (AC2/AC6, additive). `App.tsx:512-513` wires
`/proposals/review` and `/patch-sets/review` side-by-side (AC4 reachability).

### UI / design judgment (my domain) — re-verified live, screenshots taken

`PatchSetReview.css` unchanged since round 1 (confirmed — not in `db182c63`'s diff); re-screenshotted
both themes live rather than trusting round 1's description:
- **Dark theme**: clean, opaque modal, proper contrast, consistent chrome with the rest of the app.
- **Light theme**: clean, opaque surfaces, no contrast issues, consistent with `ProposalReview`'s
  established modal pattern.

Token audit: `grep -c "var(--"` → 38 hits; the two literal-`px` findings are a `2px` padding
component (`padding: 2px var(--space-2)`) that byte-for-byte matches
`frontend/src/features/dashboards/ui/ProposalReview.css:62`'s own established recipe, and ordinary
`1px solid` hairline borders — also the exact pattern `ProposalReview.css` itself uses throughout.
No new DESIGN.md violation introduced.

Reject flow re-verified live: closes the dialog and navigates home without ever calling
`POST /api/patch-sets/apply` (confirmed via network log).

One console-error artifact observed during my own testing method (`ReactDOMClient.createRoot()`
called twice) — traced to my use of raw `history.pushState` + manual `popstate` dispatch to
simulate SPA navigation without a hard reload (a testing technique, not a real user action); this
is a Vite HMR/dev-mode artifact of that method, not a defect in the shipped code — round 1's own
walkthrough via genuine UI interaction reported zero console errors, and my own genuine button-click
interactions (dashboard selection, Accept, Reject) also produced zero errors.

### Verdict: CONFIRM

Round 1's REFUTE finding is genuinely fixed, not merely reworded or narrowed: live-reproduced with
the identical scenario (same two dashboards, same demo patch set, same client-side-navigation
method), the cross-dashboard panel-grid corruption no longer occurs, and the original
matching-dashboard refresh behavior (evaluation-1.md's own CR1) still works correctly — confirming
no overcorrection. The regression tests added are meaningful (would fail if the fix were reverted
or misordered), the `getState`-before-`markDashboardPanelsStale` ordering reasoning holds up against
the real reducer, the sole call site was correctly updated, and the multi-touched-dashboard edge
case is architecturally sound by inspection even though untested directly. Full gate suite (lint,
format, tests, build, sbt test, scala-quality, schemas) is green and matches the commit's own
claims. No new defect found.

### Non-blocking notes

- (carried over, still open, still non-blocking) No dedicated test for a patch set touching
  MULTIPLE panel dashboards in one call, only one of which matches `loadedDashboardId` — verified
  correct by inspection (independent per-iteration `getState()` reads against a Set), but would be
  a genuinely cheap addition to close the gap between "verified by reading the code" and "verified
  by a test that would catch a regression here."
- (carried over from evaluation-1.md/evaluation-2.md/skeptic-final-1.md, still open, still
  non-blocking) No `PatchSetPreviewServiceSpec.scala` test exercises a D1a content-check rejection
  on a non-first edit in a multi-edit patch set.
- The documented `dataType`/`dataSource`/`pipeline` cache-staleness follow-on
  (`patchSetsSlice.ts:69-74`) remains honestly scoped out of this ticket, worth a tracked spinoff
  once a real NL-authoring caller can target those kinds.
- Environmental: this worktree's `scripts/concertino/` directory is missing
  `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (present in the main repo's
  `scripts/concertino/` but not synced into this worktree) — `start-servers.sh`/`assert-phase.sh`
  both printed a non-fatal `emit-event.sh: No such file or directory` warning before their `READY`/
  `PASS` output. Did not block this review (invoked the main repo's copies directly, which are
  read-only/pure-function scripts safe to run against this worktree's paths), but worth a sync fix
  so a future review in this same worktree doesn't need the same workaround.
