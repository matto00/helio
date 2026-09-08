## 1. The dispatcher — design the HARD case first (HEL-503 inherits this)

- [x] 1.1 Author `useResourceNavigator(): (ref: ResourceRef) => void` with
      `ResourceRef = { kind: "dashboard" | "source" | "pipeline"; id: string }` (design.md D1).
      **Write the dashboard branch FIRST**: `dispatch(setSelectedDashboardId(id))` plus navigate to `/` only
      if not already there — the dashboard route carries NO id, so a `navigate(path)` shape cannot express
      it. Then fit `source` -> `/sources/:id` and `pipeline` -> `/pipelines/:id` to that same opaque shape.
      The caller must NOT learn whether a kind is route-expressed or state-expressed.
      Verify: a unit test asserts all three kinds route correctly, INCLUDING that selecting a dashboard from
      a non-`/` route both selects it and lands on `/`.
- [x] 1.2 Also publish `hrefFor(ref: ResourceRef): string | null` — `"/sources/:id"`, `"/pipelines/:id"`,
      and **`null` for dashboards** (design.md D1, round-1 CR4). `null` is honest, not lossy: a dashboard
      has no address, and returning `"/"` would send a middle-click to the wrong place. Recents does not
      need this; HEL-503's search-result rows do (middle-click / open-in-new-tab / copy-link), and
      retrofitting it later would change a published surface. Verify by unit test for all three kinds.
- [x] 1.3 Document in-file that this is the interface HEL-503 consumes, and record — quoting HEL-503's LIVE
      retargeted body — that its searchable entities are dashboards/pipelines/outputs/sources/connectors and
      that "an Output result deep-links to its pipeline with the Output sheet open". **An Output target is
      NOT expressible as `{kind,id}`** (pipeline id + output id + sub-view state), so HEL-503 must WIDEN
      `ResourceRef` — that is a shape change, not an addition, and saying so now makes it a plan rather than
      a surprise. Do NOT try to build the output variant here; it is out of scope.

## 2. Visit history store

- [x] 2.1 Implement the store: entries of `{ kind, id, visitedAt }`, most-recent-first, de-duplicated by
      `kind+id` (a re-visit MOVES an entry, never duplicates it), capped at a fixed maximum with the least
      recent discarded. Verify: unit tests for ordering, de-duplication, and cap eviction.
- [x] 2.2 Persistence with the safety `ThemeProvider` does NOT supply (design.md D3 — say so in-file):
      `JSON.parse` in try/catch PLUS shape validation per entry (well-formed JSON of the wrong shape is not
      a valid history — discard the blob); `JSON.stringify`/`setItem` in try/catch (`setItem` throws on
      quota exhaustion and in some private modes); keep the SSR/no-window guard.
      **A failed write must NEVER break navigation** — the user's actual action still succeeds.
      Verify: unit tests for absent, malformed-JSON, well-formed-but-wrong-shape, and throwing-`setItem`,
      each asserting an empty-but-working history and no thrown error.

## 3. Recording — TWO mechanisms, THREE kinds, explicitly separate (no unifying seam)

- [x] 3.1 Dashboards: register a `startAppListening` entry observing the **STATE TRANSITION** of
      `state.dashboards.selectedDashboardId` (a `predicate` comparing previous vs current state).
      **NOT a listener on `setSelectedDashboardId`** — round-1 CR1 proved that misses most arrivals:
      `selectedDashboardId` is written by SEVEN reducers and only one is that action. Misses would include
      `fetchDashboards.fulfilled:249-263` (the boot/reload/direct-`/` auto-select) and
      `createDashboard`/`duplicateDashboard`/`importDashboard`/`applyProposal` `.fulfilled` — so even the
      palette's own "New dashboard" would not record.
      **Record ONLY when the NEW value is a non-null id** (round-2 CR2). `selectedDashboardId` legitimately
      goes to `null` (`dashboardRemoved:238-239`, `deleteDashboard.fulfilled:298-301`, or a fetch returning
      none). Firing on that would write a `null`-id entry, and because task 2.2's read-side validation
      DISCARDS THE WHOLE BLOB on any invalid entry, the next read would **wipe the user's entire history**.
      A transition to `null` is a deselection, not a visit.
      Verify with a guard that dispatches `fetchDashboards.fulfilled` with NO prior selection and asserts a
      visit was recorded, AND a second guard that a transition to `null` records NOTHING and leaves stored
      history intact — label the second as the anti-regression for history-wipe. State that it PROVES boot-arrival recording and CANNOT prove ordering. **RUN the
      mutation** (revert to an action-only listener) and see it go RED — do not assert that it would.
- [x] 3.2 Sources/pipelines: ONE route-watching effect matching `/sources/:id` and `/pipelines/:id`.
      Verify: arriving at each route records a visit.
- [x] 3.3 **Do NOT unify 3.1 and 3.2 behind a single abstraction** (design.md D2, owner ruling). An
      abstraction covering two of three kinds is indistinguishable from one covering three. Add an in-file
      comment stating this is two mechanisms for three kinds, deliberately, and why.
- [x] 3.4 Confirm the palette's own navigation needs NO extra recording call: it routes through
      `useResourceNavigator`, producing the same arrival 3.1/3.2 already observe. Verify by test, not by
      reasoning — if it needs a third mechanism, the arrival model is wrong; STOP and re-examine.

## 4. Pruning — retain when unsure

- [x] 4.1 Prune per kind ONLY when that kind's collection has genuinely resolved. **Named fields** (round-1
      CR5): `state.sources.status` (`sourcesSlice.ts:30`), `state.pipelines.status` (`pipelinesSlice.ts:75`
      — the **LIST** status; that slice has ~10 other `*Status` fields such as `createStatus`,
      `currentPipelineStatus`, `updateStatus`, and picking the wrong one is a silent defect), and
      `state.dashboards.status`. **"Resolved" means `=== "succeeded"` ONLY** — `idle`, `loading` AND
      `failed` all RETAIN, since a failed fetch is not evidence of deletion. **Dashboards prune on the same
      rule**, not exempt.
      Verify: a test per status value asserting entries are RETAINED for `idle`/`loading`/`failed` — this is
      the anti-regression for "an MRU that deletes your history on a cold load"; label it as such.
- [x] 4.2 A resource confirmed deleted (its collection loaded, id absent) is dropped. Verify by test.

## 5. Palette integration

- [x] 5.1 Add the empty-query branch (none exists — `ranking.ts` returns the whole registry unscored in
      registration order). It **PREPENDS, NEVER REPLACES** (round-2 CR1): when history is non-empty, the
      Recent section is prepended to the existing default presentation and **HEL-516's Create / Navigation /
      General sections still render**; when history is empty, today's default is returned COMPLETELY
      UNCHANGED. Replacing would regress a sibling ticket's just-merged sections, and would also make task
      5.2's ordering guard unfailable (there would be nothing left to order).
      **Mechanical seam, named so it is not a coin-flip** (round-4 nit): `rankActions(actions, query)` has
      NO access to visit history, so do NOT thread history into it. Substitute at the
      `CommandPalette.tsx:98` call site — build the Recent group there and prepend it to `rankActions`'
      output. This keeps `rankActions` a pure function of (actions, query).
      Verify: a test asserting that with a non-empty history the empty-query view contains Recent AND the
      three pre-existing sections; plus a test that a typed query returns to normal filtering.
- [x] 5.2 Add `"Recent"` to `SECTION_DISPLAY_ORDER` as the FIRST entry (`["Recent","Navigation","General","Create"]`).
      An unlisted section is not dropped — it sorts last — so omitting this would "work" while placing
      recents at the bottom, the opposite of intent. Verify: a test asserting declared position.
- [x] 5.3 **DELETED — recents do NOT set `matchesQuery`** (design.md D5, round-1 CR3). Recents are
      synthesized inside the empty-query branch and are NOT registered actions, so they cannot leak into a
      filtered query and "typing leaves recents behind" holds by construction. `ranking.ts:68-70` returns
      everything unscored on an empty query BEFORE any `matchesQuery` check, so the field is never read on
      this path — a test asserting it could not fail, and per task 7.2 a check that structurally cannot fail
      must not be written. Recorded here rather than silently dropped.
- [x] 5.4 Rows use `.eyebrow` section labels and tokens; any reveal/hover animation uses
      `var(--app-transition)` or `var(--transition-slow)` ONLY. `frontend/src/theme/motionTokenGuard.css.test.ts`
      FAILS THE BUILD on a literal duration — read it before writing CSS. Verify: that guard stays green.
- [x] 5.5 Verify every `var(--*)` introduced resolves against `theme.css` BY NAME — undefined custom
      properties fail open and are invisible to lint, types, and jest (lane A shipped `--weight-normal`
      where the token is `--weight-regular`, rendering at 600 instead of 400).

## 6. Real-browser evidence — the central hazard

- [x] 6.1 **CONTENT SELF-AUTHENTICATION FIRST.** Before ANY visual observation, `curl` this branch's dev
      server (5951) for a string that exists ONLY on this branch and confirm it is served. A port or URL
      check is NOT sufficient — it does not survive proxying, redirects, or a stale tab, and Vite
      auto-increments when a port is taken so the collision is symmetric. Recents are PER-USER state:
      another lane's palette would show another lane's recents and look like a working feature.
- [x] 6.2 Prove recording ACTUALLY FIRES, in a real browser. **Do not seed the store** — a fixture-fed list
      proves ordering logic and nothing about whether the app observes events; a feature that records
      nothing is indistinguishable on screen from an empty history. Commit as `e2e/hel519-*.spec.ts` (its
      own `registerAndLogin` MUST carry the post-mount precondition wait — `c317e244` fixed only 2 of the 8
      duplicated copies, and omitting it reintroduces the race that took main red).
      **The matrix is explicit, with N/A cells named** (round-1 CR2 — the round-1 "3 kinds x 4 paths"
      demand was UNSATISFIABLE, since by D1's own premise a dashboard has no URL, so "direct URL to a
      dashboard" and "back/forward between two dashboards" DO NOT EXIST; an executor would have had to
      fabricate them or stall):

      | kind | list click | direct URL | back/forward | via palette |
      |---|---|---|---|---|
      | dashboard | yes | **N/A — no URL id** -> instead: full page RELOAD landing on `/`, exercising the `fetchDashboards.fulfilled` auto-select (this is the CR1 path) | **N/A between dashboards** -> instead: back/forward from `/sources/:id` returning to `/` | yes |
      | source | yes | yes | yes | yes |
      | pipeline | yes | yes | yes | yes |

      The two dashboard substitutions are not weaker cells — they are the ones that actually exercise CR1's
      seven-reducer finding.
- [x] 6.3 Prove persistence across a real reload, and the empty-history fallback on a fresh profile.
- [x] 6.4 VISUAL COHESION (owner-mandated; a token check does NOT substitute). Screenshot the Recent section
      beside the existing palette sections, BOTH light and dark, at rest AND hovered AND focused (HEL-866:
      modal-hosted hover token collisions bite in light theme). Screenshots to
      `.concertino/runs/HEL-519/evidence/` ONLY — never `openspec/**`, never `git add -f`.

## 7. Gates and handoff

- [x] 7.1 Run lint, typecheck, `npm test`, format:check **from `frontend/`** — root `npm test` is
      `jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root turns silence into a
      pass. State what you ran and what it scanned.
- [x] 7.2 For EACH guard, state in-file what it PROVES and what it CANNOT, and make it failable by mutation
      — RUN the mutation and see it red; do not assert that it would. If a check structurally cannot fail,
      say so and DO NOT add it.
- [x] 7.3 Answer the two-axes question in `files-modified.md`: what does no source text carry (what can no
      grep or static check see), and what path did the gates not exercise?
- [x] 7.4 (orchestrator) Re-verify **HEL-1038** is still live and OPEN, and that its title matches the panel-recents
      deferral, before referencing it in the PR. A deferral that has silently gone Done reads as handled.
- [x] 7.5 (orchestrator) Write a note into **HEL-503** recording that HEL-519 authored `useResourceNavigator` and
      `hrefFor`, where they live, that HEL-503's ticket text has the dependency backwards, and that an
      Output target will require WIDENING `ResourceRef` (pipeline id + output id + sub-view state) — a shape
      change, not an addition.
- [x] 7.5a (orchestrator) Correct **HEL-1038**'s body: it currently describes HEL-519 as recording "at three explicit
      per-kind call sites", but the shipped design is TWO mechanisms for THREE kinds (a state-transition
      listener for dashboards; one route effect for sources/pipelines). Fix it so the follow-up ticket does
      not inherit a false description of its own predecessor.
- [x] 7.6 Re-check `origin/main` has not moved; if it has, rebase and RE-RUN the 6.4 visual comparison.
- [x] 7.7 Write `files-modified.md` (every path in FULL, bullet-prefixed — an abbreviated path fails the
      squash guard) and COMMIT. Staging without committing is an incomplete handoff.
