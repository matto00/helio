## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Content self-authentication.** No app code exists on this branch yet (artifacts only), so I used the
round-1 Vite fs-root discrimination again:
`GET /@fs<lane>/frontend/src/main.tsx` on 5951 → this lane `200`, sibling lane HEL-442 `403 Restricted`.
Port 5951 serves THIS worktree. Failable by mutation (point at a foreign lane → 403). Cannot prove a browser
tab is not stale; no visual claim below depends on one.

**Base.** `git log --oneline -1` = `3a0c0fe8` (HEL-441), matching the stated base.

**CR1 — RESOLVED, and the mechanism is implementable.** `@reduxjs/toolkit@^2.12.0`
(`node_modules/@reduxjs/toolkit/dist/index.d.ts:2123`):
`AnyListenerPredicate<State> = (action, currentState, originalState) => boolean` — a predicate genuinely
receives previous state, so transition observation is expressible with `startAppListening`
(`store/listenerMiddleware.ts` exports it `.withTypes<RootState, AppDispatch>()`; `store.ts:19,23` is the
toast precedent as claimed). I re-read `dashboardsSlice.ts` extraReducers myself: `fetchDashboards.fulfilled`
(from :249) really does auto-select via `getMostRecentDashboardId` when the selection is absent, and
`createDashboard`, `duplicateDashboard`, `importDashboard`, `applyProposal` `.fulfilled` plus
`deleteDashboard.fulfilled` all write `selectedDashboardId` without dispatching `setSelectedDashboardId`.
A previous-vs-current transition predicate covers all of them by construction. Task 3.1 carries the finding,
the boot-arrival guard, its PROVES/CANNOT statement, and a run mutation. Good.

**CR2 — RESOLVED.** tasks.md 6.2 now contains the explicit 3×4 matrix with the two dashboard cells marked
N/A and the reason, substituted by a full reload landing on `/` (the `fetchDashboards.fulfilled` path) and
back/forward from `/sources/:id` to `/`. Both substitutions do exercise CR1's finding.

**CR3 — DECIDED.** D5 picks synthesis inside the empty-query branch, not registered actions, `matchesQuery`
untouched; task 5.3 is explicitly deleted with the reasoning recorded. Verified against the tree:
`ranking.ts:66-69` short-circuits `trimmed === ""` to `[...actions]` before any `matchesQuery` read
(`ranking.ts:72-75`), so an assertion on that field on this path indeed could not fail. Not registering the
entries does make "typing leaves recents behind" hold structurally.

**CR4 — ADDRESSED; I judge `hrefFor` the right call.** It is one pure total function, the inheritor is named
and real, and retrofitting it would change a published surface. `null` for dashboards is honest, not
awkward: `AppRoutes.tsx` gives dashboards no addressable route, so `"/"` would be a wrong middle-click
target. D1 also records the Output-variant shape change instead of the false "additive" claim. Accepted.

**CR5 — field paths VERIFIED CORRECT.** `sourcesSlice.ts:30` `status: "idle"|"loading"|"succeeded"|"failed"`;
`pipelinesSlice.ts:75` is the LIST `status` (`createStatus` is :78, the other `*Status` fields follow);
`dashboardsSlice.ts:30` `status`. "Resolved = `succeeded` only, idle/loading/failed RETAIN" and "dashboards
prune on the same rule" are both stated in D4 and task 4.1.

**Deferral (evidence rule 4).** HEL-1038 re-fetched live: `status: Backlog`, `completedAt: null`,
`archivedAt: null`, titled "Panel visits in command-palette recents (requires selected-panel state + a panel
registry)". Genuine.

**Motion guard.** `frontend/src/theme/motionTokenGuard.css.test.ts` exists; D6 / task 5.4 handle it.

---

### Verdict: REFUTE

CR1–CR5 are all genuinely resolved in tasks.md (the artifact that gets built), not just in design.md. But
the round-2 D5 rewrite sharpened one half of the empty-query behavior and left the other half self-
contradictory, and the new transition-observing listener has an unstated null case that can wipe the whole
history. Both are cheap to fix and both would be invisible to any static check.

---

### Change Requests

1. **D5 contradicts itself and task 5.2 on whether recents REPLACE or PREPEND to the empty-query list —
   one reading silently regresses HEL-516, which shipped two commits ago.**
   - Replacement reading: D5 ¶1 "when history is non-empty, the empty-query presentation *is* the Recent
     section; otherwise the existing default is returned unchanged"; proposal "Show a 'Recent' section on
     empty query, **falling back** to the static list when history is empty"; spec delta
     `command-action-registry` "When a contributor supplies entries for the empty query, **those** SHALL be
     presented". Under this reading, the moment a user has any history the empty palette **loses** every
     Navigation action, Toggle theme, Open assistant, and HEL-516's whole Create section
     (`builtInActions.ts` `SECTION_DISPLAY_ORDER`) — a regression of a just-merged feature (`201fd5f9`).
   - Coexistence reading: D5 ¶2 and task 5.2 require `"Recent"` to be the FIRST entry of
     `["Recent","Navigation","General","Create"]` and a test asserting that declared position. Section
     ORDER is only meaningful if the other three sections are still rendered alongside Recent —
     `groupBySection` (`CommandPalette.tsx:33-53`) sorts groups that exist; with recents alone there is
     exactly one group and 5.2's guard asserts nothing.
   So the two artifacts require mutually exclusive behaviors, and 5.2's guard is either load-bearing or
   unfailable depending on which an implementer picks — the ticket's own "a check that cannot fail must not
   be written" rule cannot be applied until this is decided.
   **Required:** decide explicitly in design.md D5 and restate it in task 5.1, and reconcile the
   `command-action-registry` spec delta and proposal wording with the decision. If the answer is coexistence
   (Recent prepended above the unchanged default list), say so and keep 5.2's guard; if it is replacement,
   record why losing HEL-516's Create/Navigation sections on the empty query is acceptable, and delete
   5.2's position guard as unfailable.

2. **The transition listener has an unstated null case that can silently DESTROY the stored history.**
   `selectedDashboardId` transitions to `null` on real paths: `fetchDashboards.fulfilled` with an empty
   payload (`dashboardsSlice.ts:254-257` `state.selectedDashboardId = null; return;`) and
   `deleteDashboard.fulfilled` / `dashboardRemoved` when `getMostRecentDashboardId` finds nothing. A
   predicate written as "previous !== current" (which is exactly what D2 and task 3.1 say, with no further
   qualification) fires on those, and the effect records the current value — an entry with a null id.
   D3's read-side shape validation then "discard[s] the whole blob if it cannot be trusted", so one
   dashboard-deletion-to-empty wipes the user's entire sources/pipelines history too. This is precisely a
   defect no grep can see and no fixture-fed ordering test would catch.
   **Required:** D2 and task 3.1 must state that only a transition to a **non-null** id records a visit
   (transitions to `null` are ignored), and task 3.1's guard set must include a case dispatching
   `fetchDashboards.fulfilled` with an empty payload asserting **no** entry is written and prior history
   survives — failable by mutation (drop the null check → red).

---

### Non-blocking notes

- Task 5.1 says the empty-query branch lives in `ranking.ts`, but `rankActions(actions, query)` has no
  access to visit history and `CommandPalette.tsx:98` is its only caller. Whether the recents entries are
  passed into `rankActions` or substituted in `CommandPalette` is left open; either is workable, but naming
  the seam would save the executor a coin-flip.
- HEL-1038's own body says HEL-519 "records visits at **three explicit per-kind call sites**", while this
  design is two mechanisms for three kinds. Harmless drift; worth correcting in HEL-1038 when task 7.5's
  sibling note is written.
- A delete-triggered reselect records a visit the user did not deliberately navigate to. Defensible (the app
  does land them there), but worth one sentence in D2 so it is a decision rather than a side effect.
- design.md D1 still cites `dashboardsSlice.ts:201` for `setSelectedDashboardId`; the reducer is in
  `features/dashboards/state/`, which round-1 already noted. Cosmetic.
