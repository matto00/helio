## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/home-page-run-timeline/HEL-1578`.
- **Owner answers:** re-read from `.concertino/runs/HEL-1578/events.jsonl`, both the `escalation.raised` options and
  the `escalation.answered` event (answer_source human). The answers are home-at-home, four-changed-first,
  top-8-failures-pinned, stuck-or-missed, keep-24h and build-now-wire-after-1575. Nothing has been answered since
  round 4.
- **HEL-1574 rulings:**
  - `home-points-to-dashboards` is an interim alias, which this ticket replaces.
  - `keep-six-1583-decides`: the phone nav has six tabs with Home first, which matches the mobile-bottom-nav delta.

**Round-4 CR1 (a dot cleared for a dashboard that was never opened): resolved.**

- **(a) Phase A stamp target.**
  - D5 now stamps `viewedAt` only for the displayed dashboard, through an effect keyed on the displayed id.
  - On `/dashboards/:id` the stamp waits until `DashboardRoute` has applied the route id. I checked the code:
    `DashboardRoute.tsx:31-33` selects the route id in a parent `useEffect`, and the child `<PanelList />` renders first
    with the stale selection. So the "keyed on displayed id, not mount" rule is the correct one.
  - Home load, boot auto-select and tab restore stamp nothing.
  - Shelf cards link to `/dashboards/:id`. That route exists today (`AppRoutes.tsx:116`).
  - The new spec scenario "Opening another dashboard keeps a selected dashboard's dot" covers this path. Task 1.9a
    tests "opening X from Home while Y is selected stamps X only".
- **(b) Phase B.**
  - HEL-1575's tab `lastViewedAt` is excluded from `lastSeen`, in both D5 and the shelf requirement ("SHALL NOT be
    used").
  - I confirmed the cause in HEL-1575's worktree: `dashboardTabsListeners.ts:99-104` stamps the left tab whenever
    `activeId` changes.
  - The per-device risk is in Risks.
  - The comparison is still HEL-1575's own. `selectTabHasChanged` (`dashboardTabsSelectors.ts`) is a pure comparison
    behind the `activeId` exemption, and the plan extracts it rather than reimplementing it.
  - `noteOwnDashboardWrite` exists in `warm/warmCache.ts:83`, with all call sites in `warmListeners.ts:172`, so a single
    hook is enough for own writes.
  - Task 3.3 adds the multi-tab case [Y changed, X].

**Round-4 non-blocking notes: all folded in.**

- D7 uses `<section aria-label="Home">` inside the shell `<main>`, with no shell change.
- The scoping requirement now names only `pipeline_runs` and `pipeline_schedules`. Their policies are owner-only:
  - `pipeline_schedules`: V62:46-52, `EXISTS pipelines.owner_id = current_setting(...)`.
  - `pipeline_runs`: V35, FORCE.
- D3 says where the EXPLAIN runs: the test harness's `helio_app_test` role, or a `SET ROLE` on the dev DB to a
  NOBYPASSRLS role that the executor creates and then drops. D4 seeds and removes rows by exact id.

**Re-checked against code:**

- **V136 is free.** The branch ends at V134, and only HEL-1579's worktree holds V135. origin/main has nothing above V134.
- **Retention:** `deleteOldRunsInternal` (`PipelineRunRepository.scala`) is keep-N-newest over non-dry runs. D4's
  union-then-cap change is well defined, and dry-run retention is a separate function that stays untouched.
- **`row_count`:** the column exists on `pipeline_runs` (V24), so the response's `rowCount` field has a source.
- **Route and shell:** `isDashboardViewPath` (`sections.ts:158-159`) and `homeAlias` (`navDestinations.ts:35-46`)
  match D1's description. The registry stays at five nav-visible entries, and the Home item gets the active treatment.
- **The ticket's ACs all map to tasks:**
  - one call and no fan-out: 3.2
  - real 24h history (retention plus window query), shapes not hue, focusable labelled marks: 1.1, 1.3, 1.11
  - failed run with Retry under the HEL-505 guards: 1.12, 3.2
  - the dot clears on open: 1.9a, 2.2, 3.3
  - new-user empty states: 1.13, 3.2

### Verdict: CONFIRM

### Non-blocking notes

1. **Retry/Run now must not go through `submitPipelineRun`; use `runToUpdate`.**
   - D6 says Retry/Run now "dispatch the existing `submitPipelineRun`" and that the "429 copy uses `Retry-After`". That
     is not possible as written:
     - `submitPipelineRun` (`pipelinesThunks.ts:135-152`) catches every error as
       `rejectWithValue("Failed to start pipeline run.")`. This drops both the 429 status and the `Retry-After` header.
     - Its `pending`/`fulfilled` cases also mutate the pipeline-detail run state in `pipelinesSlice.ts:217-241` and
       `outputsSlice.ts:265`.
   - The existing shared guarded-submit path that keeps `Retry-After` is `runToUpdate`
     (`features/pipelines/services/runToUpdate.ts`, HEL-1096). It calls the same `POST /api/pipelines/:id/run` and
     branches on 429.
   - The executor should call `runToUpdate`, or the same `runPipeline` plus 429 branch, and must not change
     `submitPipelineRun`'s rejection shape.
   - The spec's 429 copy ("not started ... try again in 15 seconds") differs from `runToUpdate`'s message. Either pick
     one wording or map the outcome in Home.
2. **"Displayed id" on `/dashboards/:id` after a sidebar switch.**
   - `DashboardRoute` re-selects only when the route id changes. A sidebar or palette pick while on `/dashboards/X`
     shows Z while the URL still says X.
   - The displayed id should be the selection once it has matched the route id, not the route id permanently.
     Otherwise the leave stamp would land on X instead of Z.
   - D5's "effect keyed on the displayed id ... again on switching" implies this. State it in the 1.9a test.
3. **Deviation from the owner option text.** The owner-approved `build-now-wire-after-1575` text says the dot "must
   reuse its dashboard-change signal and per-tab lastViewedAt/ownWriteAt". The plan reuses the change signal, the
   predicate and the own-write source, but replaces tab `lastViewedAt` with `seen.viewedAt` (to satisfy AC 4). The PR
   should name this deviation explicitly for the owner. It should not be listed only as a per-device risk. The owner
   should also learn that the tab marker and the Home dot can disagree for a dashboard restored as a tab.
4. **The EXPLAIN target is named inconsistently.** D4's "< 50ms on the dev DB" conflicts with D3, which allows the test
   DB. Record which DB the number came from.
5. **A Retry may stay pending for the whole run.** `runPipeline` returns `rows`/`rowCount`, so `POST /run` may only
   respond after the run finishes. If so, Retry stays disabled for that long, and "Running now" appears only after a
   refetch. Check this in the e2e test and keep the pending state readable.
