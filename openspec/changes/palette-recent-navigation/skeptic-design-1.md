## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Content self-authentication (before any visual observation).** No branch-unique app string exists yet
(`git diff --stat origin/main...HEAD` = openspec artifacts only), so I authenticated by Vite fs-root
discrimination instead:

```
$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5951/@fs<lane>/frontend/src/main.tsx"
/…/feature/elevation-border-radius-normalization/HEL-442 -> 403
/…/feature/in-panel-column-filtering/HEL-451        -> 403
/…/feature/palette-recent-navigation/HEL-519        -> 200
```
Port 5951 serves THIS worktree's `frontend/`; sibling lanes are `403 Restricted`. Failable by mutation
(point it at a foreign lane → 403). Proves: the server root is this worktree. Cannot prove: that the
browser tab is not stale — I re-navigated before every screenshot.

**Base.** `git log --oneline -1` and `origin/main` both `3a0c0fe8` (HEL-441). Motion guard
`frontend/src/theme/motionTokenGuard.css.test.ts` exists — D6 / task 5.4 handle it correctly.

**Premise corrections — independently checked, all CONFIRMED:**
- `type` is dead: `grep -rn "api/types"` across `frontend/src` + `backend/src` returns only comments and
  `ApiRoutesSpec.scala:3596` `"404 for every GET/PATCH/DELETE /api/types/* route"`. Dropping it is a
  correction, not a scope cut.
- **HEL-1038 is real, live, `Backlog`, `completedAt: null`**, titled "Panel visits in command-palette
  recents (requires selected-panel state + a panel registry)" — matches the deferral exactly. Deferral is
  genuine per evidence rule 4.
- The dashboard route carries no id: `app/AppRoutes.tsx:100` `<Route path="/" element={<PanelList />} />`;
  `:id` exists only at `AppRoutes.tsx:102,104` for sources/pipelines. D1's premise that a `navigate(path)`
  shape cannot express dashboards is TRUE.
- Route-param derivation: `shared/chrome/usePickerSelection.ts:75-76` (`pathname.split("/")[2]`).
- `SECTION_DISPLAY_ORDER` = `[Navigation, General, Create]` (`builtInActions.ts:25-29`); an unlisted section
  sorts after every listed one (`CommandPalette.tsx:45-51`) — D5's claim is exact.
- `ranking.ts:68-70` short-circuits an empty query to `[...actions]` unscored — no empty-query branch
  exists. D5 correct.
- `ThemeProvider` precedent: correct as stated (no try/catch on write; raw strings, no JSON).
- Lazy slices: `sourcesSlice.ts:30/43` and `pipelinesSlice.ts:75/125` both carry
  `status: "idle"|"loading"|"succeeded"|"failed"` starting `"idle"`. D4 is implementable — but see CR5.

**Visual cohesion (running app, both themes).** Logged in on 5951, opened the palette with Ctrl+K.
Evidence: `.concertino/runs/HEL-519/evidence/skeptic-palette-{light,light2}.png` (dark then light).
The HEL-516 family is uniform: uppercase mono `.eyebrow` section labels, a lucide icon per row, inline
KeyCaps, a single subtle row-highlight. A leading "Recent" section of icon + resource-name rows reads as a
member of that family in both themes. **No cohesion objection at the design gate**; the real judgment lands
at the final gate against rendered rows.

---

### Verdict: REFUTE

The plan is largely well-grounded, but Decision 2 — the load-bearing one — is wired to an action that does
not observe most dashboard arrivals. That is precisely the ticket's own defining hazard: it would ship, look
exactly like an empty history, and no grep or static check could see it.

---

### Change Requests

1. **D2's dashboard listener on `setSelectedDashboardId` MISSES most dashboard arrivals — the recording
   mechanism does not cover the kind it was designed around.**
   `state.selectedDashboardId` is written by **seven** reducers, only one of which is that action
   (`features/dashboards/state/dashboardsSlice.ts`):
   - `:249-263` `fetchDashboards.fulfilled` — **auto-selects the most recent dashboard when the current
     selection is absent.** This is the boot/reload/direct-`/` arrival path, and it dispatches no action a
     listener on `setSelectedDashboardId` can see.
   - `:281-283` `createDashboard.fulfilled`, `:306-309` `duplicateDashboard.fulfilled`,
     `:313-316` `importDashboard.fulfilled`, `:318-320` `applyProposal.fulfilled` — all land the user on a
     dashboard; none dispatch it. **The palette's own "New dashboard" action therefore would not record.**
   - `:238-239` `dashboardRemoved` / `:298-301` `deleteDashboard.fulfilled` — reselect.
   There are exactly **three** dispatch sites of `setSelectedDashboardId` in non-test source
   (`DashboardList.tsx:376`, `usePickerSelection.ts:104`, `combinedProposalsSlice.ts:36`). Everything else is
   invisible to the planned listener.
   **Required:** revise D2 and task 3.1 to observe the **state transition** of `state.dashboards.
   selectedDashboardId` (a `startAppListening` entry with a `predicate` comparing previous vs current state),
   not one action — this stays one explicit dashboard mechanism, so it does not violate the owner's no-
   unifying-abstraction ruling. Add a guard that dispatches `fetchDashboards.fulfilled` with no prior
   selection and asserts a visit was recorded; state that it PROVES boot-arrival recording and CANNOT prove
   ordering, and RUN the mutation (revert to an action-only listener → must go red).

2. **Task 6.2's evidence matrix is unsatisfiable as written for dashboards.** It demands "EACH of the three
   kinds, on EACH arrival path: list click, direct URL, browser back/forward, and via the palette". By D1's
   own premise the dashboard route is `/` with no id, so "direct URL to a dashboard" and "back/forward
   between two dashboards" **do not exist**. As written the executor must either fabricate those cells or
   stall. **Required:** write the 3×4 matrix explicitly into tasks.md with the N/A cells marked and the
   reason given, and replace the dashboard row's two impossible cells with the real equivalents that
   actually exercise CR1: (a) a full page reload landing on `/` (the `fetchDashboards.fulfilled`
   auto-select path) and (b) back/forward from `/sources/:id` back to `/`.

3. **D5 / task 5.3 contradict the spec on `matchesQuery`; as written the guard either breaks a spec
   scenario or cannot fail.** `features/commandPalette/model/types.ts:23-30`: `matchesQuery` makes the
   palette "show the action for the current query **without re-testing it**". Two readings, both broken:
   - If recent entries are registered actions carrying `matchesQuery: true`, they survive **every non-empty
     query** — contradicting `palette-recent-navigation` spec scenario "Typing a query leaves recents
     behind" and task 5.1's "a typed query returns to normal filtering".
   - If they are synthesized only inside the new empty-query branch, `matchesQuery` is never read
     (`ranking.ts:68-70` returns everything unscored on an empty query before any `matchesQuery` check), so
     5.3's "verify by test" is a check that **structurally cannot fail** — banned by the ticket's own rule.
   **Required:** design.md must pick one and say which, and task 5.3 must either be deleted with that
   reasoning recorded, or state what its guard proves and be shown red under mutation.

4. **The HEL-503 inheritance analysis is written against HEL-503's stale body; the retargeted ticket needs
   more than `{kind,id}`.** HEL-503 was retargeted 2026-08-30 and its live description reads: searchable
   entities are **dashboards / pipelines / outputs / sources / connectors**, and "**An Output result
   deep-links to its pipeline with the Output sheet open**". Two consequences the design does not address,
   while locking the published surface:
   - An Output target is **not** expressible as `{kind, id}` — it is a pipeline id plus an output id plus a
     sub-view state. "Adding a kind later is additive" is false for this known-today inheritor requirement.
   - An opaque `(ref) => void` can yield **no URL**, so no HEL-503 result row can support middle-click,
     open-in-new-tab, or copy-link — *even for sources and pipelines, which do have real URLs*.
   **Required:** design.md must either (a) publish an optional companion `hrefFor(ref): string | null`
   (`null` for dashboards, the real path for sources/pipelines) and say how a composite target will be
   expressed, or (b) record explicitly — quoting the retargeted HEL-503 text — that HEL-503 will inherit a
   surface with no per-row URLs and will have to change the shape for outputs, so that cost is a decision
   rather than a surprise.

5. **D4 and task 4.1 never name the status field and never mention dashboards.** Name them:
   `state.sources.status` (`sourcesSlice.ts:30`), `state.pipelines.status` (`pipelinesSlice.ts:75` — the
   **list** status specifically; that slice carries ~10 other `*Status` fields, `createStatus`,
   `currentPipelineStatus`, `updateStatus`, … , and picking the wrong one is a silent defect), and
   `state.dashboards.status`. Define "resolved" as `=== "succeeded"` **only** — `idle`, `loading` and
   `failed` must all RETAIN (a failed fetch is not evidence of deletion). And state whether dashboard
   entries are pruned at all, since the design discusses only sources/pipelines.

---

### Non-blocking notes

- `design.md` cites `dashboardsSlice.ts:201` correctly, but the file is at
  `frontend/src/features/dashboards/state/dashboardsSlice.ts`, not `store/`. Harmless; worth fixing.
- Task 6.1's content self-authentication is achievable *before* any code lands via the `/@fs` root
  discrimination shown above (sibling lanes 403); consider recording that recipe in tasks.md so the
  executor does not have to invent one.
- `matchesQuery`'s docstring does explicitly name "a usage-ranked recent" — D5 is right that this field was
  added for this consumer. That makes CR3 a question of *where* it applies, not whether it was intended.
