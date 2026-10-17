## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `518ba0d9478892a07c58cf3a9c1a67aa86546993` against the live-resolved base `0d8bd55cf23a8c2a867614d7182d748ab6dde912`
(`resolve-review-base.sh` after `git fetch`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/home-page-run-timeline/HEL-1578`.

### What I verified (with evidence)

**Gates I ran myself on this head**
- Backend targeted (sbtfull.lock, nice 19, `-Xmx3g`): `testOnly com.helio.services.home.* com.helio.api.routes.home.* com.helio.infrastructure.persistence.home.* ...PipelineRunRepositorySpec`.
  - Result: `Total number of tests run: 71`, `Suites: completed 4`, `succeeded 71, failed 0`, EXIT 0.
  - The 4 suites are HomeSummaryBuilderSpec, HomeSummaryRoutesSpec, PipelineRunRepositorySpec and HomeSummaryScopingSpec.
  - Evidence ref: `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/.concertino/scratch/HEL-1578/skeptic-final-sbt-targeted.txt`
- Frontend jest (2 workers, nice 19) across home, dashboardSeenStore, useDashboardViewStamp, changeRule, warmCache.homeStamp, runToUpdate, navDestinations, sections, BottomNav, AppRail, dashboardTabsSelectors, the elevation/motion guards and recentVisitsListeners: `27 passed, 210 passed`.
- `typecheck` exit 0, `lint` exit 0, `check:schemas` exit 0, `prettier --check` on the changed ts/tsx/css/json files exit 0.
- Full `sbt testFull` and the full Playwright suite: I relied on the evaluator's pasted, persisted output rather than re-running.
  - `eval3-sbt-full-tail.txt`: 8210 succeeded, 0 failed, EXIT 0.
  - `eval3-e2e-full.txt`: 380 passed, 1 skipped, EXIT 0.
  - Both are unambiguous, and my own targeted runs agree with them.

**Seam: the live response matches the schema.** I fetched `GET /api/home-summary?dashboardIds=<id>` live from 7010 and validated it with ajv 2020 against `schemas/home/home-summary-response.schema.json`: `true`, no errors. `dashboardChanges` carried the HEL-1575 content time.

**Acceptance criteria, traced**
1. **One summary call, no per-pipeline fan-out.**
   - Live network log on a hard `/home` load with a seeded user (4 pipelines, 18 runs, 2 schedules): `auth/me` x2, `home-summary?dashboardIds=…` x1, `dashboards`, `dashboard-changes` (the HEL-1575 shell).
   - There were zero `/api/pipelines/<id>/…` requests.
   - The repository is 2 set-based SQL queries in one `withUserContext` transaction (`HomeSummaryRepository.scala`).
2. **Timeline.**
   - Real 24h runs render, and each status has its own shape: ok is a filled circle, failed a diamond, running a ring with a dot, scheduled a hollow ring.
   - The timeline has 27 marks and one tab stop (roving). ArrowRight moves between marks.
   - The focus ring is visible: `solid 2px` focus token, and `:focus-visible` is true.
   - Labels read like `billing-rollup, failed, 11:03, column "amount" could not be cast…`, and a tooltip shows status, duration, rows and trigger.
   - Evidence: `…/skeptic-home-markfocus-light.png`.
3. **A failed run appears with its error, and Retry works through the guards.**
   - billing-rollup's error showed under Needs attention.
   - Clicking Retry sent exactly one `POST /api/pipelines/df133932…/run` (200) through `runToUpdate`, followed by one summary refetch. The item then read "Resolved by a later run".
   - `submitPipelineRun` is untouched in the diff (C5). The 429 / `Retry-After` path is additive in `runToUpdate.ts`, with a unit test.
4. **The changed dot clears after opening.**
   - Setup: I viewed "Ops health" at `/dashboards/:id` and went Home. Then a separate curl session created 2 panels on it, and I reloaded Home.
   - Result: the dot appeared, and the sentence read "One dashboard changed since your last visit." (`…/skeptic-home-changed-dot-light.png`).
   - I opened the dashboard from the shelf and returned through the rail. The dot was gone and the sentence dropped the clause.
   - Server side, the signal is HEL-1575's `DashboardChangesService.changes`, called unchanged. Client side, `hasChangedSince` was extracted unchanged from `selectTabHasChanged`.
5. **Empty states.** The e2e `hel1578-home-page.spec.ts` covers the new-user case: "All quiet", "Set up step by step", "No pipeline runs yet", "Nothing needs attention.", "Nothing is scheduled.", no alert, and no horizontal overflow. It passed in the evaluator's full run. I read the spec's assertions; I did not re-render this case live.

**Constraints**
- **C2/C6 (route integration):**
  - `isDashboardViewPath` is now `/dashboards` or `/dashboards/…`.
  - AppRail's private `isActiveDestination` was replaced by one shared `isDestinationActive`, which BottomNav uses too. No parallel conditional was added.
  - On `/dashboards/:id`, HEL-1575's tab bar and ⌘K render, and only Dashboards is current (`…/skeptic-dashboard-route-dark.png`). On `/home`, only Home is current.
  - `git grep` finds no remaining `/home` that means the dashboard grid.
  - `PanelList` only adds the stamp hook and `stepByStep`, so the PanelGrid / skeleton key is untouched.
- **C3 (retention):**
  - `measurements.md` 1.1 records the red run on the old keep-10 code: 2 FAILED.
  - The tests assert 40 runs kept, and "had size 10" is impossible under the new code. 40 kept, 10 kept and 300 kept all pass now (my run).
- **C3/C4 (scoping):**
  - `HomeSummaryScopingSpec` asserts `rolbypassrls=false, rolsuper=false` in-session, and raw counts with no predicate are 0 for B. A positive control on the system context confirms the rows exist.
  - The owner filter is proven separately on a superuser `DbContext`.
  - Both queries carry `p.owner_id = $owner::uuid`.
- **CSS pins:** 147 CSS files with `find` here and 146 via `ls-tree` on the base. The only guard edits are the count and a comment. The focus and contrast guard specs only retarget to `/dashboards` and add a seeded `/home` cell. No allowlist or threshold changed.
- **V136:** it is still free on origin/main (latest is V135). `helio_hel1578` is at 136, and the shared `helio` DB is at 135, so it is not contaminated.

**Design judgment (both themes, 1440 and 375)**
- Light and dark at 1440 (`…/skeptic-home-light-1440.png`, `…/skeptic-home-dark-1440.png`):
  - The composition matches the B2 board: mono eyebrow, a plain templated sentence with error-coloured clauses, a shelf of 4 cards plus "All 5 →", the timeline card with the now line and hour labels, Needs attention with an error hairline, and Up next.
  - Accent discipline holds: the dot, the now line and the secondary buttons are neutral, and the accent appears only on the active rail item and the focus ring.
  - The buttons follow the §5 secondary and ghost recipes on tokens, with the dark-surface hover rung handled.
  - Dark parity is clean.
- 375 (`…/skeptic-home-light-375-scrolled.png`): the timeline becomes one disclosure row per pipeline with a plain summary line. There is no horizontal overflow (`scrollWidth - clientWidth = 0`).

**Cleanup.** I deleted my throwaway user from `helio_hel1578` by exact id and email (`buildUserDeleteSql`). A recount found 0 users, 0 pipelines, 0 dashboards and 0 sources for it. Servers were left running. No files were left in the worktree: I briefly copied evidence files into the worktree root by mistake, removed them by exact name, and `git status` now shows only the evaluator's untracked `evaluation-3.md`.

### Verdict: CONFIRM

### Non-blocking notes
- **Phone shelf.** At 375px the shelf stacks all four cards at full width, each about 200px tall. That puts the timeline and Needs attention roughly 900px down, below the most actionable content. A horizontally scrolling shelf, or 2 cards with "All N", would fit a phone better. This is worth folding into HEL-1583's mobile work.
- **"Stuck" threshold.** It is a flat 15 minutes (`HomeSummaryLimits.StuckAfter`), regardless of the HEL-1511 heartbeat. A legitimately long, heartbeating run is labelled "may be stuck". The copy hedges and offers Open only, which is acceptable as spec'd, but a heartbeat-aware rule would be more truthful.
- **Up next.** It lists one row per schedule (the first fire), so two schedules show only 2 rows, even though the timeline shows 9 upcoming fires. This is consistent with the spec, but it reads thin.
- **Narrow-row marks.** On the phone disclosure row, a dense upcoming series (web-events, hourly) draws its hollow rings touching and overlapping.
- **Retention clock.** `deleteOldRunsInternal` computes `windowStart` from the JVM clock (`Instant.now()`) rather than DB `now()`. This is harmless with a sane clock skew.
- **Home top bar.** The B2 board shows "Search, jump, or ask" in Home's top bar, but here it exists only in the dashboard tab bar. DESIGN §9 puts ⌘K in the tab bar, so this is not a defect, but the owner may expect it on Home.
- **Carried over from the evaluator:** the hel1572 "no flash" test title, and naming `DASHBOARD_CHANGES_MAX_IDS` instead of reusing `MAX_TABS`.
