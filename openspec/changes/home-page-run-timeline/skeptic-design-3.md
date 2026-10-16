## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/home-page-run-timeline/HEL-1578`.
- **openspec:** `openspec validate home-page-run-timeline --strict` → "Change 'home-page-run-timeline' is valid".
- **Owner answers:** these were re-read from the source.
  - `.concertino/runs/HEL-1578/events.jsonl` line 5:
    `["home-at-home","four-changed-first","top-8-failures-pinned","stuck-or-missed","keep-24h","build-now-wire-after-1575"]`.
  - HEL-1575 line 5 includes `data-or-edit`.
  - HEL-1574 `home-points-to-dashboards` (line 5) and `keep-six-1583-decides` (line 12) are present.
  - The option texts for questions 4-6 match D2's thresholds (15 min stuck, 10 min missed), D4 (10 ∪ 24h, cap 300) and
    the Phase A/B split.
  - The option text for `four-changed-first` reads "4 cards (one row at 1280; 2x2 at 768, **1 column at 375**)". See CR2.

**Round-2 change requests, each checked against code:**

1. **Own-write stamps per dashboard: resolved.** D5 Phase B writes `seen.ownWriteAt` from HEL-1575's
   `noteOwnDashboardWrite` path, whether or not a tab exists. Checks against code:
   - HEL-1575 `warmCache.ts:83-93`: `noteOwnDashboardWrite` runs `setOwnWriteAt` regardless of tabs. The
     `tabOwnWrite` call in it is the only no-op part.
   - `warmListeners.ts:84-145,159-174` (`OWN_WRITE_SOURCES`) includes `updateDashboardLayout.fulfilled`.
   - This branch's `useLayoutSave.ts:265-276,332`: the unmount flush dispatches `updateDashboardLayout`. The r2 case
     (edit X, plain-click to Y, open Home) therefore records X's own write.
   - A spec scenario ("Own edits never mark a dashboard") and task 3.3 were added.
2. **View stamps survive recordVisit and eviction: resolved.** The stamps move to a separate keyed store
   (`helio.dashboardSeen`) that `recordVisit` and the 10-entry cap never touch.
   - Confirmed against `recentHistoryStore.ts:154-162`, which rebuilds the list only.
   - Pruning reuses `registerPruneListener` (`recentVisitsListeners.ts:62-77`), which fires only on
     `status === "succeeded"`.
   - The bound (500) is stated. Task 1.9a tests stamp retention across boot auto-select, `recordVisit`, and pipeline
     visits.
3. **Coarse-pointer 44px rows: resolved.** D7 and the spec gate the ≥44px disclosure rows on `(pointer: coarse)` at
   any width, or on the phone shell. This is consistent with DESIGN.md §3 (lines 267-305) and §4 (width is not a touch
   proxy). The "Tablet touch uses rows" scenario and task 1.11a cover 820px with a coarse pointer.
4. **Step-by-step from Home: resolved.** Home dispatches `reopenOnboarding()` and navigates to `/dashboards` with
   `state: {stepByStep: true}`; `PanelList` seeds `stepByStep` from it.
   - Checked against `PanelList.tsx:58,162-163,355-368`. Seeding `useState` from the location state yields
     `showFirstRunDropZone = false` and `onboardingVisible`, so the checklist renders.
   - A spec scenario and task 1.13 were added.
5. **No second concurrent run: resolved for pipelines in the returned set.** The spec has the "Running now"
   requirement and the "No retry while a run is in flight" scenario; task 1.12 covers them. Edge case in the notes.

**New: owner scoping (D3), checked against the repo:**

- `PipelineRunRepository.scala` `listByPipeline` filters explicitly:
  `pipeline <- pipelinesTable if ... && pipeline.ownerId === ownerUuid`. `PipelineScheduleRepository.scala:63` does the
  same.
- CONTRIBUTING.md "ACL triad" requires an explicit `owner_id` predicate.
- MISTAKES.md:154-159: "RLS policies never run in dev or CI. Both connect as a superuser, which is BYPASSRLS."
- Probe on the shared dev DB as the app-pool user from `backend/.env` (`matt`), read-only:
  `select rolsuper, rolbypassrls ...` → `t|f`; `select count(distinct owner_id) from pipelines` → `2710`.

**Other checks:**

- **Migrations:** the latest on this branch is V134. HEL-1579's worktree holds `V135__pipeline_run_step_row_counts.sql`,
  so V136 is free today.
- **Retention call sites:** `PipelineRunExecutor.scala:172-173`, `PipelineRunService.scala:245` and
  `SparkJobSubmitter.scala:72`. That is three sites, not the "both" D4 names. All go through `deleteOldRunsInternal`,
  so the body change covers them.
- **RLS policies:** `pipeline_runs` (V35) and `pipeline_schedules` (V62) are owner-only. The `pipelines` SELECT policy
  (V39) is sharing-aware.
- **HEL-1575 tab stamping** (`dashboardTabsListeners.ts:88-110`, `hydrateTabs.ts` `planHydration`): stamping is
  route-independent. See the notes.

### Verdict: REFUTE

### Change Requests

1. **The summary queries drop the explicit owner predicate. On the shared dev DB and in CI they would return every
   user's pipelines, runs and schedules.**
   - D3 says "No explicit `owner_id` filter is added; scoping comes from the policies, as in `listByPipeline`". The
     citation is false: `listByPipeline` and `PipelineScheduleRepository.scala:63` both filter on
     `pipeline.ownerId === ownerUuid`.
   - CONTRIBUTING.md's ACL triad requires the explicit predicate. MISTAKES.md:154 records that dev and CI connect as a
     superuser.
   - I probed the dev DB the servers use: the app-pool role is `rolsuper = t`, and `pipelines` has 2710 distinct
     owners. A brand-new user's Home in local dev would therefore rank, list and offer Retry on other users' pipelines.
   - Effects on the plan:
     - The spec's "Brand-new user ... empty states" e2e and the 3.4 screenshots break.
     - The task 3.2 network-log run on the shared DB cannot pass deterministically.
     - The D4 `EXPLAIN ANALYZE` on the dev DB measures an unscoped, RLS-free plan unlike prod's.
   - Required, in D2, D3, tasks 1.3/1.6/3.1 and the `home-summary-api` scoping requirement:
     - Add `pipelines.owner_id = caller` to queries (1) and (2), as the existing repositories do.
     - Keep RLS as the second layer, and re-state the proof so the explicit filter cannot mask RLS: in the
       non-BYPASSRLS session (rolsuper and rolbypassrls asserted false), a raw `pipeline_runs` / `pipeline_schedules`
       select with no owner predicate returns none of A's rows for user B, and the same select via `withSystemContext`
       returns them.
     - Separately test that the repository method returns only the caller's rows on a bypassing connection. This
       proves the explicit filter.
     - Record the `EXPLAIN ANALYZE` under the non-bypassing role with `app.current_user_id` set, so the RLS EXISTS is
       in the measured plan, or state why the dev-role plan stands in for it.
2. **The phone shelf layout contradicts the owner-approved option.** D7 specifies "375 shelf 2×2". The `four-changed-first`
   option the owner chose reads "4 cards (one row at 1280; 2x2 at 768, 1 column at 375)". Owner rulings outrank
   DESIGN.md, HANDOFF.md and the board, and the board has no phone Home.
   - Required: change D7 to one column at 375 (2×2 at 768/820, one row at 1280).
   - Make task 3.4's 375 screenshots show it.
   - Alternatively, if 2×2 is preferred, record it as a deviation the PR asks the owner to confirm. Do not silently
     diverge.

### Non-blocking notes

- **Risks bullet is stale.** "Phone own-save gap: phone has no tabs, so no `ownWriteAt`" contradicts D5 Phase B, where
  `seen.ownWriteAt` is written from `noteOwnDashboardWrite` "tab or no tab". The listener is registered unconditionally
  (`dashboardTabsListeners.ts:34`), so phone own writes are covered. Drop or correct the bullet so the PR does not state
  a false caveat.
- **Proposal non-goal contradicts D5.** The proposal's Non-goals list "a new visit-tracking store", while D5 adds
  `helio.dashboardSeen`. Reword it to "no new server-side visit store; the keyed view stamps live in the existing
  recent-visit module".
- **Call-site count in D4.** D4 says "both call sites unchanged"; there are three (see above). The body change covers
  all of them, but list them accurately.
- **HEL-1575 stamping off the dashboard view.** HEL-1575 stamps a never-viewed active tab's `lastViewedAt` on hydration
  on any route. This happens for a user with no saved tab set (`planHydration` makes the auto-selected dashboard the
  only tab with `lastViewedAt: null`, and the activeId listener stamps it).
  - The first `/home` load after 1575 ships can therefore hide a pending change on the auto-selected dashboard, through
    the `max(tab.lastViewedAt, seen.viewedAt)` rule.
  - It happens once per user. Record it as a known edge in Phase B's deviation notes rather than re-implementing
    1575's stamping.
- **"Running now" outside the returned set.** "Running now" only works when the item's pipeline is in `pipelines`. With
  more than 8 pinned pipelines, an attention item's in-flight run (under 15 min) is not in the response. A server-side
  `inFlight` boolean on each attention item closes this without client inference.
- **Reusing the HEL-1575 predicate.** `selectTabHasChanged` is a Redux selector tied to tabs and `activeId`. Phase B
  needs its pure comparison extracted to a shared function, which D5 allows. Keep the active-tab exemption out of
  Home's use.
- **Home heading (DESIGN.md §9).** §9 says "Home and Pipeline top bars carry a small sans breadcrumb or label rather
  than a display `<h1>`". D6 should name the Home label and give the page landmark an accessible name.
