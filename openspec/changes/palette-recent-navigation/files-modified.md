# Files modified — HEL-519 palette recent navigation

## Cycle 3 — skeptic-final-1.md CR1 fix (BLOCKING)

**The defect:** on `/` (the app's default landing route), `state.sources.items` and
`state.pipelines.items` are never populated — the only fetches for them are in
`SidebarBody.tsx:53-66`, gated on the pathname's picker section. `useRecentPaletteActions.ts`'s
`resolveTitle` therefore returned `null` for any source/pipeline entry and silently dropped the
row: on `/`, with all three kinds recorded, the palette rendered exactly one (dashboards, which
DOES load unconditionally via `AppShell`'s boot effect). This is the exact silent-failure shape
the ticket was written to guard against.

**Fix — option (b), persist the resolved title on the entry (owner's choice):**

- `frontend/src/features/commandPalette/model/recentHistoryStore.ts` — `RecentEntry` gains an
  optional `title` field, persisted alongside `kind`/`id`/`visitedAt`. `recordVisit` takes an
  optional third `title` argument. `isRecentEntry`'s shape validation tolerates a MISSING title
  (migration: an entry written before this field existed) but still discards the whole blob on a
  present-but-malformed one (non-string/empty), per design.md D3's existing "discard the whole
  blob" rule — no per-field patch-up.
- `frontend/src/features/commandPalette/state/recentVisitsListeners.ts` — the dashboards listener
  now reads the dashboard's `name` off `state.dashboards.items` (the SAME state read that found
  `nextId`) and passes it to `recordVisit`.
- `frontend/src/features/commandPalette/RecentVisitsRouteObserver.tsx` — now reads
  `state.sources.items`/`state.pipelines.items` and passes the resolved name to `recordVisit` when
  available; the effect re-runs as those lists change, so a title unresolved at the moment of a
  first-ever visit (detail page's own fetch still in flight) gets backfilled once it resolves,
  self-healing within the SAME visit rather than only the next one.
- `frontend/src/features/commandPalette/useRecentPaletteActions.ts` — `resolveTitle` now checks
  the persisted `entry.title` FIRST; only an entry with no persisted title (legacy/defensive) falls
  back to the old resolve-from-slice path, which is the only path that can still return `null`.

**Why (b) over (a) (fetch-on-palette-open):** makes the Recent list's rendering independent of
slice load state entirely — same principle as design.md D4's "retain when unsure: a stale entry
beats a silently missing one." No network needed on palette open, works on every route including
`/`, and self-heals (a re-visit re-records the current title). (a) would have kept the row
dependent on a fetch completing — the same class of dependency that caused this defect.

**The missing test, added:** `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx`'s
"renders all three kinds on / with NO slice loaded" — opens the palette on `/` with all three
kinds recorded and `sources`/`pipelines`/`dashboards` slices left at their genuinely-empty initial
state (not preloaded), asserting all three render. Ran the exact mutation (omitting the title
argument from `recordVisit`, simulating pre-fix behavior) and confirmed RED (every recent row
vanished — a stronger red than production would show, since this test's own store, unlike
`AppShell`, never dispatches `fetchDashboards()` either); restored and confirmed GREEN. Also added
a real-browser e2e reproduction: `e2e/hel519-recent-navigation.spec.ts`'s "a source visited
earlier renders under Recent on / after a full reload" — visits a source, then a full page reload
lands fresh on `/` with an empty client-side Redux store (the precise condition), and asserts the
Recent row renders with its title. Building this test surfaced a genuine, separate write-ordering
race (documented in-file at that test): `RecentVisitsRouteObserver`'s `useEffect` write to
`localStorage` commits strictly after React's render/paint, so a REAL browser navigation
(`page.goto`) fired immediately after `waitForURL` can unload the page before that effect flushes,
silently dropping the write. Fixed the TEST by waiting on the detail page's own heading (a
post-mount settle signal) before navigating away — this is a test-timing fix, not a product fix;
the underlying effect-timing race is a pre-existing property of every `useEffect`-based write in
this design (also true before this cycle's change) and is noted here as a discovered-but-
out-of-scope finding, not silently absorbed.

Unit test coverage for the persisted-title mechanism itself:
`recentHistoryStore.test.ts` (persists/overwrites/omits a title; migration for a title-less
legacy entry; a malformed `title` discards the whole blob), `recentVisitsListeners.test.ts`
("persists the dashboard's title onto the recorded entry"), and
`RecentVisitsRouteObserver.test.tsx` ("persists the title when it's already resolvable in Redux";
"backfills the title once it becomes resolvable after mount").

## Cycle 2 — evaluation-1.md CR1 fix

`frontend/src/features/commandPalette/ui/CommandPalette.test.tsx`'s "typing a query leaves
recents behind" test was structurally unfailable (the evaluator ran the mutation and confirmed
it: deleting `CommandPalette.tsx:112`'s empty-query gate left all 13 tests green). Root cause was
two independent bugs, both fixed:

1. The test recorded a visit for a source id never present in any store's `sources.items`, so
   `useRecentPaletteActions`'s `resolveTitle` always returned `null` and `recentActions` was
   always empty regardless of the code under test.
2. The render tree never mounted `GlobalCommandShortcuts` (the only thing that wires Ctrl/Cmd+K to
   `open()`), so the keydown fired was a no-op and the palette's `<dialog>` never received its
   `open` attribute — every `getByRole` query would have silently found nothing regardless of
   which code path ran; `getByText`/`querySelector` (used elsewhere in the file) don't check
   visibility and would have stayed vacuously true either way.

Fix: preload a resolvable `sources.items` entry (matching the "prepends Recent" test's own store
shape) and mount `GlobalCommandShortcuts` so Ctrl+K genuinely opens the palette. Re-ran the exact
mutation (dropping the `query.trim() === ""` check) and watched it go RED
(`getAllByRole("option")` returns 2, "My Source" survives the "dashboards" filter); restored the
gate and watched it go back GREEN. Both runs observed directly — see the in-file comment above
the test for the full account of what the fixed version proves and cannot prove.

## New files

- `frontend/src/shared/chrome/resourceNavigation.ts` — `ResourceRef`, `hrefFor`, and
  `useResourceNavigator` (design.md D1). The opaque kind→navigate dispatcher HEL-503 inherits;
  `dashboard` dispatches `setSelectedDashboardId` + conditional `navigate("/")`, `source`/
  `pipeline` navigate to their real routes. `hrefFor` returns `null` for a dashboard (no route
  id) and the real path for the other two kinds.
- `frontend/src/shared/chrome/resourceNavigation.test.tsx` — unit tests for both (task 1.1/1.2):
  routing for all three kinds, and the dashboard-from-non-`/`-route case landing on `/`.
- `frontend/src/features/commandPalette/model/recentHistoryStore.ts` — the visit-history store
  (design.md D2/D3/D4): `RecentEntry`, `loadRecentHistory`/persistence with the try/catch +
  shape-validation safety `ThemeProvider` doesn't supply, `createRecentHistoryStore` factory, and
  the `recentHistoryStore` singleton the running app uses.
- `frontend/src/features/commandPalette/model/recentHistoryStore.test.ts` — unit tests: ordering,
  de-duplication, cap eviction (task 2.1); persistence safety across absent/malformed/wrong-shape/
  throwing-`setItem` (task 2.2); pruning (task 4.1/4.2).
- `frontend/src/features/commandPalette/state/recentVisitsListeners.ts` — the dashboards
  state-transition listener (design.md D2/round-1 CR1/round-2 CR2) plus the three per-kind prune
  listeners (design.md D4), registered via `startAppListening`.
- `frontend/src/features/commandPalette/state/recentVisitsListeners.test.ts` — unit tests
  including the round-1 CR1 mutation guard (an action-only listener misses
  `fetchDashboards.fulfilled`, run and confirmed red) and the null-transition anti-regression
  (round-2 CR2), plus the idle/loading/failed-retain anti-regression for pruning (task 4.1).
- `frontend/src/features/commandPalette/RecentVisitsRouteObserver.tsx` — the sources/pipelines
  route-watching effect (design.md D2's other mechanism), mounted unconditionally in `AppShell`.
- `frontend/src/features/commandPalette/RecentVisitsRouteObserver.test.tsx` — unit tests: records
  on `/sources/:id` and `/pipelines/:id`, records nothing on an unrelated route.
- `frontend/src/features/commandPalette/useRecentPaletteActions.ts` — the palette-facing hook that
  resolves each recorded entry's title from Redux and builds the `CommandAction[]` `CommandPalette`
  prepends on an empty query (design.md D5); omits an entry silently while its kind's collection
  hasn't resolved rather than rendering a blank title.
- `e2e/hel519-recent-navigation.spec.ts` — real-browser proof recording actually fires (task 6.2),
  covering the matrix's non-N/A cells (source list-click, pipeline direct-URL, pipeline
  back/forward, the dashboard reload substitution for CR1's `fetchDashboards.fulfilled` path, and
  selecting a recent FROM the palette), persistence across reload (task 6.3), the fresh-profile
  empty-history fallback, and "typing a query hides Recent" in a real browser.
- `e2e/hel519-screenshots.spec.ts` — visual-cohesion evidence generator (task 6.4); screenshots
  written to `.concertino/runs/HEL-519/evidence/` only.

## Modified files

- `frontend/src/features/commandPalette/model/builtInActions.ts` — added `RECENT_SECTION` export
  and prepended it to `SECTION_DISPLAY_ORDER` (task 5.2).
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx` — prepends
  `useRecentPaletteActions()`'s result ahead of `rankActions`' output on an empty, non-empty-history
  query only (design.md D5, task 5.1); never threaded into `rankActions` itself.
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` — added Redux `Provider` +
  `MemoryRouter` wrapping (now required by the palette's own recents dependency) and a new
  describe block covering prepend-not-replace, typing hides recents, and the empty-history
  no-op case.
- `frontend/src/app/App.tsx` — mounts `<RecentVisitsRouteObserver />` unconditionally in
  `AppShell`.
- `frontend/src/store/store.ts` — registers `addRecentVisitsListeners(startAppListening)` alongside
  `addToastListeners`.

## Task 7.3 — the two-axes question

**What does no source text carry (invisible to grep/static checks):** whether the dashboards
listener's `predicate` actually fires for all seven `selectedDashboardId`-writing reducers, and
whether a `null`-transition genuinely records nothing, are both facts about a *Redux state
transition over time* — no static scan of `dashboardsSlice.ts` or `recentVisitsListeners.ts` can
confirm it; only running the listener against dispatched actions (`recentVisitsListeners.test.ts`)
can. Likewise, whether the Recent section visually reads as part of the same palette (spacing,
icon alignment, hover/focus token parity across themes) is invisible to any source-text or
`jsdom` check — only the screenshots in `.concertino/runs/HEL-519/evidence/` speak to it.

**What path did the gates not exercise:** the unit/e2e suite never exercises a *third* browser tab
or a genuinely different device sharing the same account — cross-device merge of two independent
`localStorage` histories is architecturally impossible by design (this is per-browser-profile
state, not synced), so "another device's recents look stale/wrong" is an accepted, undocumented-
until-now limitation rather than a tested one. Similarly, no test exercises the palette showing a
recent entry for a kind whose collection has NEVER been loaded on the CURRENT client-side session
(e.g. landing straight on `/pipelines` after a fresh reload, having visited a source in a PRIOR
session) — `useRecentPaletteActions`'s `resolveTitle` silently omits such an entry until that
kind's list loads, which is the intended, conservative behavior (never guess a title), but no gate
proves a user actually sees it reappear once they do visit `/sources` again in the same session
(a manual/observational gap, not a broken guarantee — the e2e persistence test above proves
persistence itself, and the pruning tests prove no *deletion* happens in the unresolved case).

## Deferred / handoff items NOT completed by this run

- **Linear updates (tasks 7.4/7.5/7.5a)** — re-verifying HEL-1038 is still open with a matching
  title, correcting its "three explicit call sites" description, and writing the HEL-503
  cross-reference note, all require Linear write access this execution environment's tool set
  does not expose. Flagged explicitly rather than silently skipped or guessed at; left unchecked
  in `tasks.md`.
