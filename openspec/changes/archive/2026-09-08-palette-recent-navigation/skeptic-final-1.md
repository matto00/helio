## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### Content self-authentication (before any visual observation)

`curl http://localhost:5951/src/features/commandPalette/model/recentHistoryStore.ts` served
`RECENT_HISTORY_STORAGE_KEY = "helio.recentVisits"` — a string that exists only on this branch (3 matches).
`resourceNavigation.ts` was also served with this branch's `hrefFor`/`useResourceNavigator` bodies inline.
Port 5951 is this lane. All browser observations below are against that authenticated origin, logged in as
matt@helio.dev.

### What I verified (with evidence)

**Gates, re-run by me from `frontend/` (evidence discipline #1):**
- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npx eslint src --max-warnings=0` → exit 0.
- `npx jest` (full suite) → **285 suites / 2892 tests passed**. This includes
  `theme/motionTokenGuard.css.test.ts` (HEL-441).
- Motion guard / token audit is **vacuously satisfied**: `git diff main...HEAD -- '*.css'` is empty, and
  grepping added lines for `var(--`, `transition:`, `animation:`, `style=` returns **zero hits**. The Recent
  section introduces no CSS at all — it reuses HEL-516's existing section/row chrome by emitting
  `CommandAction`s with a `section` string. No new custom property is introduced, so there is nothing that
  could fail to resolve against `theme.css`.

**Mutation testing — five load-bearing assertions, each mutation verified to have LANDED before judging
(inheriting the evaluator's methodological note about a no-op `perl` pattern):**

| # | Mutation | Landed? | Result |
|---|---|---|---|
| M1 | remove `if (nextId === null) return;` | yes | fails to compile (`string \| null` rejected) — type system, not a test |
| M1b | `if (nextId === null) { recordVisit("dashboard","DESELECT"); return; }` (type-safe) | yes (grep) | **1 test failed** at `recentVisitsListeners.test.ts:88` |
| M2 | predicate → action-based (`_action.type === "dashboards/setSelectedDashboardId"`) | yes (grep) | **2 tests failed** |
| M3 | prune predicate → any status change | yes (grep) | **2 tests failed** |
| M4 | prepend → replace (`return [...recentActions];`) | yes (grep) | **1 test failed** |
| M5 | drop the empty-query condition (recents leak into a filtered query) | yes (grep) | **1 test failed** |

All five are genuinely discriminating. I looked specifically for a seventh unfailable assertion in the
load-bearing set and **did not find one**. Working tree restored and verified clean after each mutation.

**Hazard 1 — state transition, not action — PROVEN IN THE RUNNING APP.** I cleared
`localStorage["helio.recentVisits"]`, confirmed it read `null`, reloaded `/`, and after 2.5s storage held
`[{kind:"dashboard", id:"ad203213-…"}]`. That entry came from `fetchDashboards.fulfilled`'s boot auto-select
— exactly the writer an action-keyed listener would miss. Source confirms the predicate compares
`currentState.dashboards.selectedDashboardId !== previousState…`.

**Hazard 2 — null guard.** Present at `recentVisitsListeners.ts:41`, and mutation-failable (M1b). Doubly
defended: `recordVisit`'s signature makes a `null` id unrepresentable (M1). The history-wipe path
(`isRecentEntry` requires `id.length > 0`, and `loadRecentHistory` discards the WHOLE blob on any invalid
entry) is real, and the guard is what stops it.

**Hazard 3 — prepend, never replace — VERIFIED IN THE RUNNING APP.** Palette opened on `/`; group labels
read `["Recent","Navigation","General","Create"]` with all 13 sibling options intact. Not only in a test.

**Hazard 4 — prune only on the LIST status.** `registerPruneListener` reads `currentState[slice].status`.
Confirmed `pipelinesSlice.ts:75` `status` is the list status — it is the field set alongside
`state.items = action.payload` at lines 410-411 (`fetchPipelines`), distinct from the ~10 other `*Status`
fields. Predicate is `=== "succeeded" && previous !== "succeeded"`, so `idle`/`loading`/`failed` all retain.

**Hazard 5 — recording actually fires, no seeding.** `grep` of `e2e/hel519-recent-navigation.spec.ts` for
`localStorage|addInitScript|setItem` returns **no seeding call** (the one line-179 hit is a comment). I
independently drove all three kinds in a real browser: source click from `/sources`, direct-URL pipeline
arrival, dashboard auto-select. Storage afterwards held `dashboard` + `pipeline` + `source`. Recording works.

**HEL-503 inheritance, judged as a published surface.** The known limitation is **honestly handled, not
papered over**: design.md:52-56 states plainly that an Output target "is NOT expressible as `{kind, id}`" and
that HEL-503 "will have to widen `ResourceRef`". `hrefFor` returning `null` for `dashboard` (rather than a
lossy `"/"`) is the right call and is reasoned in-file. No objection here.

**HEL-1038 deferral is real (evidence discipline #4).** Fetched live: open, Backlog, titled "Panel visits in
command-palette recents (requires selected-panel state + a panel registry)", scoped to exactly the missing
infrastructure. Valid deferral.

**UI cohesion (light + dark, hover + focus).** Screenshots at `.concertino/runs/HEL-519/evidence/`:
`skeptic-palette-dark.png`, `skeptic-palette-light-hover.png`. The `RECENT` eyebrow is typographically
identical to `NAVIGATION`/`GENERAL`/`CREATE`; icon column, row height, spacing rhythm and the hover/selected
surface all match the sibling sections; light and dark are at parity. A Recent section leading HEL-516's
sections **reads as a coherent palette**. No cohesion objection — nothing here needs an owner tiebreak.

**Console:** one 404 on `/api/pipelines/:id/schedule` for a pipeline with no schedule — pre-existing and
unrelated to this diff.

### Two-axes question

- **What no source text carries:** that on `/` — the app's default landing route — `state.sources.items` and
  `state.pipelines.items` are *never populated*. Nothing in the HEL-519 diff shows this; it lives in
  `frontend/src/shared/chrome/SidebarBody.tsx:53-66`, an unmodified file, where the fetches are gated on
  `pickerIdForPathname(pathname)` being `"sources"`/`"pipelines"`. No grep of this change can see it. This is
  precisely "no wire impact != no downstream impact" (evidence discipline #5).
- **What path the gates did not exercise:** opening the palette **on `/`** with source/pipeline history.
  Every e2e assertion of a source/pipeline recent first routes through a slice-loading page
  (`navigateViaSidebar(page, "Data Pipelines")`, or an explicit `page.goto("/sources")`). The comment at
  spec line 177-180 names that dependency out loud — so the constraint was known and the tests were routed
  around it, but it was never surfaced as a limitation or a deferral.

### Verdict: REFUTE

One blocking defect. Everything else in this change is solid, well-reasoned and genuinely well-tested.

### Change Requests

1. **Source and pipeline recents are silently invisible on `/`, the route where the palette is most used —
   AC 1 fails for 2 of the 3 in-scope kinds.**

   *Reproduced twice, stably.* With storage holding
   `["dashboard:ad203213","pipeline:236b13e7","source:c554cc1e"]`, opening the palette on `http://localhost:5951/`
   renders a Recent section containing **exactly one row** (`SKF2-82col`, the dashboard). The pipeline and the
   source are omitted. Second run used a 4s settle before reading storage and a 1.5s settle after opening the
   palette; identical result. This is not a flaky measurement — it is corroborated by the source.

   *Root cause (probe-confirmed, not inferred):* `useRecentPaletteActions.ts:36` → `resolveTitle` returns
   `null` when the entry's id is absent from `state.<kind>.items`, and line 57 then does `continue`, dropping
   the row. On `/`, those slices are empty because the only dispatch sites for `fetchSources`/`fetchPipelines`
   are `SidebarBody.tsx:53-66`, gated on the pathname's picker section. `App.tsx:174` dispatches
   `fetchDashboards()` only. So on the dashboards route there is **no code path that will ever load them**,
   and the omission is permanent, not a race I failed to wait out.

   *Why this is blocking rather than a nit:* the feature's headline use case — "I was just looking at that
   source, I'm back on my dashboard, hit Cmd+K and jump back" — returns nothing. It also fails silently in the
   exact way the ticket warns about: an empty Recent list is indistinguishable from a feature that records
   nothing. And it runs against design.md D4's own stated value judgement ("showing a stale entry that 404s on
   click is a recoverable annoyance… When in doubt, retain") — storage is correctly retained, but the row is
   hidden anyway, which delivers the user the same experience as deletion.

   *Not a scope question.* This is inside the owner-ruled three kinds; no re-litigation of scope is involved.

   Either fix is acceptable — please pick one and record the trade in design.md:
   - **(a)** When the palette opens, ensure the two slices are loaded (dispatch `fetchSources()`/
     `fetchPipelines()` when the respective `status === "idle"`). This composes safely with D4: the prune
     listener fires only on the `→ "succeeded"` transition, so pruning stays correct. Costs two fetches on
     first palette open.
   - **(b)** Persist the resolved `title` in `RecentEntry` so a row can render from storage alone. Note this
     changes the stored shape and therefore `isRecentEntry`, and needs a decision on stale titles — but it is
     the only option that also works on a cold load before any fetch resolves.

   Whichever is chosen, add a test that **opens the palette on `/`** (not on a slice-loading route) with a
   source or pipeline in history and asserts the row is visible — the path no current gate exercises. Please
   confirm it is mutation-failable.

### Non-blocking notes

- A full page load re-records the auto-selected dashboard, bumping it to the head of the MRU. Defensible (the
  user *is* arriving there), but it means a reload-heavy session pushes sources/pipelines down the list faster
  than real usage warrants. Worth a sentence in design.md if intentional.
- HEL-1039 (the `isOpen`-independent test at `CommandPalette.test.tsx:256`) was already filed and was
  confirmed discriminating; not re-reported here, per instruction.
