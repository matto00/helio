## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope reviewed: `22338656` (implementation) + `26b520ec` (Linear task ticks, no code) vs base `3a0c0fe8`.

### Content self-authentication (before any visual observation)

`curl http://localhost:5951/src/features/commandPalette/model/recentHistoryStore.ts` returns the
transformed module containing `RECENT_HISTORY_STORAGE_KEY` (3 occurrences); the same fetch re-run
**from inside the browser page** returned `BRANCH-CONTENT-CONFIRMED`. Port 5951 is serving THIS
branch's source, not another lane's. All visual observation below post-dates that check.

### Phase 1: Spec Review — PASS

Issues: none.

- All six ticket ACs addressed; `openspec validate palette-recent-navigation --strict` → valid.
- tasks.md: 28/28 ticked, zero `- [ ]` remaining; ticks match the diff.
- Premise corrections honoured: three kinds only (`ResourceKind = dashboard|source|pipeline`);
  `panel` deferred to HEL-1038 and named in `resourceNavigation.ts`; HEL-503 inherits
  `useResourceNavigator`/`hrefFor` authored here (dashboards branch designed first — `hrefFor`
  returns `null` for it rather than a lossy `"/"`).
- No scope creep: zero CSS files changed, `ranking.ts` untouched, no backend/schema changes.

### Phase 2: Code Review — FAIL (one change request)

Gates I re-ran MYSELF, from `frontend/` (never the worktree root, per the ticket's rule 1):

| Gate | Command (cwd `…/HEL-519/frontend` unless noted) | Result |
|---|---|---|
| lint | `npm run lint` (`eslint src --max-warnings=0`) | PASS, 0 warnings |
| format | `npm run format:check` | PASS |
| typecheck | `npm run typecheck` | PASS |
| unit | `npm test` | PASS — **285 suites / 2892 tests**, incl. `motionTokenGuard.css.test.ts` |
| build | `npm --prefix frontend run build` (worktree root) | PASS (exit 0) |
| e2e | `DEV_PORT=5951 BACKEND_PORT=8858 npx playwright test e2e/hel519-recent-navigation.spec.ts` | **7/7 passed (22.6s)** |

I did not take the executor's gate report on trust; the numbers above are from my own runs.

#### The six planning-defect regressions — each verified BY MUTATION

1. **State-transition listener, not action listener** — VERIFIED. `recentVisitsListeners.ts:30-32`
   predicate compares `currentState.dashboards.selectedDashboardId !== previousState…`.
   *Mutation run*: replaced it with `predicate: (action) => action.type === "dashboards/setSelectedDashboardId"`
   → **2 tests red**. Guard is failable. PROVES the seven-writer coverage incl.
   `fetchDashboards.fulfilled`; CANNOT prove ordering/capping (that is `recentHistoryStore.test.ts`).
2. **Null transitions do not record** — VERIFIED. `recentVisitsListeners.ts:39` `if (nextId === null) return;`.
   *Mutation run*: removed the guard (with an `as unknown as string` cast so it still type-checks,
   since a bare removal only fails the compiler) → **1 test red** ("does NOT record a transition to
   null … leaves existing history intact"). The most damaging available defect (whole-blob wipe via
   read-side shape validation) is genuinely guarded, and the guard genuinely fails.
3. **Prepend, never replace** — VERIFIED IN THE RUNNING APP, not only in a test. On `/sources/:id`
   the palette rendered group labels `["Recent","Navigation","General","Create"]` — HEL-516's
   sections all intact beneath a leading Recent. Screenshots in evidence dir.
4. **Prune only on `succeeded`, and on the LIST status** — VERIFIED. The predicate reads
   `currentState[slice].status`, i.e. `dashboards.status` / `sources.status` /
   `pipelines.status` — for pipelines that is the `fetchPipelines` list status
   (`pipelinesSlice.ts:405-419`), NOT one of that slice's ~10 other `*Status` fields (`runStatus`,
   save/delete statuses etc.). *Mutation run*: loosened to `status !== "loading"` → red at
   `recentVisitsListeners.test.ts:175` (the idle/loading/failed retention case).
   **On the executor's own in-file comment**: it says the retention case is asserted "with a plain
   `pruneMissing` call, since a predicate keyed on `=== "succeeded"` structurally never fires for
   those values". The *reasoning* is correct, but the comment **misdescribes its own test** — the
   test actually drives a real store and dispatches `sources/fetchSources/pending` / `…/rejected`,
   which is strictly stronger and, as the mutation shows, genuinely failable. Comment drift only
   (non-blocking suggestion below).
5. **Recents set no `matchesQuery` and are not registered actions** — VERIFIED. `useRecentPaletteActions.ts`
   emits `CommandAction`s with no `matchesQuery` field; they are synthesized at the
   `CommandPalette.tsx:107-116` call site and prepended; `rankActions`/`ranking.ts` is not in the
   diff at all and stays pure in (actions, query).
6. **Two mechanisms, three kinds, deliberately not unified** — VERIFIED, with the in-file rationale
   in `RecentVisitsRouteObserver.tsx` (and the reciprocal note in `recentVisitsListeners.ts`).

#### Evidence scrutiny

- **"7/7 e2e, none seeded the store" — claim VERIFIED by reading the spec, then re-running it.**
  No test touches `recentHistoryStore` or `localStorage`; every one drives a real arrival (list
  click, direct URL, `goBack()`, full reload auto-select, palette selection) and reads the rendered
  Recent section. The reload test is the correct substitution for the impossible "dashboard by
  direct URL" cell.
- **`registerAndLogin` post-mount precondition** — present IN the helper and AFTER `waitForURL("/")`
  (`hel519-recent-navigation.spec.ts:32-33`, and again in `hel519-screenshots.spec.ts:18-19`). The
  `c317e244` race is not reintroduced.
- **HEL-441 motion guard** — green inside the 285-suite run. Vacuously safe here besides: the diff
  changes **zero CSS files**, so no new literal duration and no new `var(--*)` token exists to
  mis-name (the `--weight-normal`-style hazard has no surface on this branch — the only `var(--…)`
  strings in the diff are prose inside markdown).
- **`any` in `e2e/hel519-screenshots.spec.ts:7,22`** — copied from the existing
  `hel516-screenshots.spec.ts` precedent; `e2e/**` is outside `eslint src` and the frontend
  tsconfig. Pre-existing pattern, non-blocking.

#### The sixth false-passing assertion — FOUND (this is the change request)

`CommandPalette.test.tsx` "typing a query leaves recents behind (task 5.1/D5)" is **structurally
unfailable**. It calls `recentHistoryStore.recordVisit("source", "s1")` but renders via
`renderPalette()`, whose store has `sources.items === []`, so `resolveTitle` returns `null` and the
recent row **never renders in that tree at any query** — empty or not.

*Mutation run (proof)*: I deleted the empty-query condition entirely in `CommandPalette.tsx:112`
(`if (query.trim() === "" && recentActions.length > 0)` → `if (recentActions.length > 0)`), i.e.
recents now leak into every filtered result — **all 13 `CommandPalette.test.tsx` tests still passed.**
The test's own comment ("recents contribute nothing once typing starts") therefore asserts something
it cannot observe. The ticket's rule is explicit: *"a check that structurally cannot fail must not be
added — say so instead."*

Mitigating: the behavior IS genuinely covered, in a real browser, by
`hel519-recent-navigation.spec.ts:204` ("typing a query hides the Recent section"), which uses a
resolvable source name and would go red under that same mutation. So this is a misleading guard, not
a coverage hole.

Everything else in the code review is clean: DRY (reuses `commandRegistry`'s observable-store shape
and the existing palette row markup — no new component, no new CSS), readable, modular, no `any` in
`src/`, storage boundary fully defensive (try/catch on read AND write, whole-blob shape validation),
no dead code, no TODO/FIXME, no over-engineering (the non-unification is deliberate and documented),
no drive-by behavior change outside recents.

### Phase 3: UI Review — PASS

Issues: none blocking.

Observed live on port 5951 (content-authenticated first), logged-in session:

- **Happy path E2E in the real browser**: clicked a source in `/sources` → detail route →
  `Ctrl+K` → `Recent` section leads with that source, then the auto-selected dashboard; selecting a
  recent row navigates (also covered by e2e test 5).
- **Prepend, both themes**: light and dark both render
  `Recent / Navigation / General / Create`. Recents reuse the existing `.command-palette__item`
  markup and the `.eyebrow`-style group label, so light/dark parity is inherited, not re-derived.
  Kind icons (`LayoutDashboard`/`Database`/`Workflow`) match the icons the Navigation rows already
  use for the same destinations.
- **Hover AND focus (HEL-866)**: hovered row 1 while row 1 was also keyboard-active
  (`ArrowDown`) — highlight treatment identical to the pre-existing rows, no double-emphasis
  artifact. Screenshot captured.
- **Empty state / no crash**: a fresh profile shows no Recent group and the default presentation
  unchanged (e2e test 6, re-run green).
- **Console**: 0 errors across every flow. The single warning is the pre-existing RTK
  `SerializableStateInvariantMiddleware took 35ms` dev-mode notice, unrelated to this change.
- **Accessibility/keyboard**: recent rows are `role="option"` with their resource name as the
  accessible name, reachable by ArrowDown, activatable by Enter/click.
- **Breakpoints** 1440 / 1100 / 768 / 360: no layout breakage, `documentElement.scrollWidth ===
  innerWidth` at 768 and 360 (no horizontal overflow); rows measured 678px @768 and 280px @360,
  both inset within the viewport.

Screenshots written to `.concertino/runs/HEL-519/evidence/` ONLY
(`eval-cycle1-palette-recent-current-theme.png`, `eval-cycle1-palette-recent-dark-hover-focus.png`).
Nothing written under `openspec/**`; no `git add -f`.

**Cohesion call is NOT ruled here** — per instruction it is escalated to the skeptic. My objective
observation: a Recent section leading HEL-516's Create/Navigation/General reads as coherent because
it introduces no new visual vocabulary at all (same row component, same group label, same icon
family, zero new CSS). Whether "Recent first" is the right *ordering* is a judgment call the skeptic
and the owner own.

### Two-axes question (answered explicitly)

- **What no source text carries**: whether recording ever *fires*. Every recorder is a side effect
  of a runtime transition — a Redux state delta and a `useEffect` on `location.pathname`. No grep,
  type, or lint can distinguish "listener registered and firing" from "listener registered and
  never reached"; a store-seeded unit test cannot either. Only the 7 non-seeding browser tests
  (which I re-ran) carry that evidence. Second item no text carries: whether a `var(--*)` resolves
  — moot here, since the diff adds no CSS.
- **What path the gates did not exercise**: **the palette on `/` with a not-yet-loaded sibling
  list.** I drove it manually. `localStorage` correctly still held both entries
  (`[{kind:"dashboard",…},{kind:"source",…}]` — nothing pruned, D4 holds), but the Recent section
  rendered **only the dashboard**: `sources.items` is empty on `/`, so `resolveTitle` returns
  `null` and the source row is omitted. This is the documented, deliberate degrade (omit rather
  than show a blank title, and never delete), and it is strictly the safe direction — but no unit
  or e2e test covers it, and to a user it makes recents look shorter on the default route than on
  `/sources`. Reported as an observation/follow-up candidate, not a defect against any AC.

### Overall: FAIL

One change request; everything else is clean and the feature itself is proven working in a real
browser. This is a cheap, contained fix.

### Change Requests

1. `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` — the test
   `"typing a query leaves recents behind (task 5.1/D5)"` is unfailable and its comment asserts a
   behavior it cannot observe (proof: removing `query.trim() === "" &&` from
   `CommandPalette.tsx:112` leaves all 13 tests in that file green). **Either** render it through a
   store whose `sources.items` contains `{ id: "s1", name: "My Source" }` — the same
   `preloadedState` the sibling "prepends Recent AND still renders the pre-existing sections" test
   already builds — and assert `screen.queryByText("My Source")` is present on an empty query and
   **absent** after `fireEvent.change(input, { target: { value: "dashboards" } })`; **or** delete
   the test and replace it with a comment naming
   `e2e/hel519-recent-navigation.spec.ts:204` as the real owner of this assertion. Re-run the
   mutation above afterward and confirm it goes red.

### Non-blocking Suggestions

- `frontend/src/features/commandPalette/state/recentVisitsListeners.ts:57-59` — the doc comment
  says the idle/loading/failed retention is asserted "with a plain `pruneMissing` call". It isn't;
  `recentVisitsListeners.test.ts` dispatches real `pending`/`rejected` actions through a real
  store, which is stronger. Correct the comment so it doesn't undersell (and misdescribe) its own
  guard.
- `e2e/hel519-screenshots.spec.ts:7,22` — `page: any` / `request: any`. `e2e/**` is unlinted and
  untypechecked so nothing catches it, and it mirrors `hel516-screenshots.spec.ts`, but the sibling
  `hel519-recent-navigation.spec.ts` already imports `type Page, type APIRequestContext` from
  `@playwright/test`. Cheap to match.
- Consider a follow-up ticket for the `/`-route observation above (Recent silently shorter when a
  kind's list has not been fetched). Options include fetching sources/pipelines lists on palette
  open, or rendering an un-resolved entry with its kind label. Deliberately NOT proposed as a
  change here — it would touch the D4 boundary the design gate spent four rounds settling.
