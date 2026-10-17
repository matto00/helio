## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/home-page-run-timeline/HEL-1578`.
- **Owner answers:** `.concertino/runs/HEL-1578/events.jsonl` line 5 `escalation.answered`
  `["home-at-home","four-changed-first","top-8-failures-pinned","stuck-or-missed","keep-24h","build-now-wire-after-1575"]`.
  These match the question order in `planning-escalation-1.json`. HEL-1574 `home-points-to-dashboards` (line 5) and
  `keep-six-1583-decides` (line 12) are confirmed. The plan keeps six phone tabs.
- **openspec:** `openspec validate home-page-run-timeline --strict` → valid. Every live spec that mentions `/home` is either
  covered by a delta or still true after the move.
- **Round-1 revisions, checked against the artifacts and the code:**
  - CR1 (boot auto-select, clocks): partly resolved. D5 now cites `recentVisitsListeners.ts` and drops `visitedAt`. It
    adds a server-time `viewedAt` that only the dashboard view writes, and the spec scenarios were added. Two new defects
    remain in the mechanism; see new CR1 and CR2 below.
  - CR2 (interval anchor): resolved. `PipelineSchedulerService.scala:177/223` computes `nextFireTime(schedule, now)` after
    a fire, and `CronSchedule.scala:40-49` adds the interval to `after`. So "first fire = max(next_run_at, serverNow),
    then iterate from the previous fire" mirrors the scheduler. The scenario values check out: 10:07 with stored 11:00
    every 2h gives 11/13/15 under a 16:07 horizon, and hourly cron gives the six fires 11-16.
  - CR3 (phone/touch): phone resolved (D7 uses ≥44px disclosure rows). The coarse-pointer non-phone path conflicts with
    DESIGN.md §3; see new CR3.
  - CR4 (stuck Retry): resolved for stuck (Open only) and missed (Run now). The same overlap applies to failed and
    missed items in another case; see new CR5.
  - CR5 (e2e): resolved. Task 1.8a and D1 cover the e2e retarget, and task 3.5 runs the full e2e suite.
  - CR6 (spec/doc deltas): resolved. A `mobile-bottom-nav` delta exists, and its header matches live
    `mobile-bottom-nav/spec.md:10` exactly. Task 1.14 covers §9 and §12. A `frontend-protected-routes` delta adds `/dashboards`.
  - CR7 (first-run): the decision is recorded (drop zone in the empty shelf, PR asks the owner) and the scenario is updated.
    The wiring is underspecified; see new CR4.
- **HEL-1575 reuse:** read its design D1/D4/D7 and its executed code. The dot predicate and the `serverClock`
  fallback (offset 0 until measured) are consistent with what 1578 plans to reuse.
- **`recentHistoryStore.ts:145-151`:** `recordVisit` builds a fresh `{kind,id,visitedAt,title}` entry and filters out the old
  one. The cap is `RECENT_HISTORY_MAX_ENTRIES = 10`, shared across dashboard, source and pipeline kinds.
- **HEL-1575 own-write bookkeeping** (`HEL-1575/frontend/src/features/dashboards/tabs/`):
  - `dashboardTabsSlice.ts:136-143` `tabOwnWrite` is a no-op when no tab has that id.
  - `dashboardTabsSlice.ts:103-105` `replaceActiveTab` replaces the active tab's id in place when the selection moves to a
    dashboard that is not open (1575 D1 "Otherwise").
  - `warm/warmCache.ts:83-91` `noteOwnDashboardWrite` also records an in-memory per-dashboard `ownWrites` map.
- **Layout unmount flush on main:** `useLayoutSave.ts:332` `useEffect(() => () => persistLayoutRef.current(), [])`
  fires when the grid unmounts on a dashboard switch or on leaving the view. Its PATCH success arrives after leaving.
- **DESIGN.md §3 (lines 267-305):** every touch-reachable control must clear 44x44, gated on
  `(max-width: 768px), (pointer: coarse)`. This is marked **[mechanical]**. §12 "Touch" applies §3 unchanged.
- **`FirstRunDropZone.tsx:12-21`:** requires an `onStepByStep` prop. In `PanelList.tsx:355-366` that prop sets local
  `stepByStep` state and dispatches `reopenOnboarding()`, which then renders `OnboardingChecklist` inside PanelList.

### Verdict: REFUTE

### Change Requests

1. **Own saves still light the dot on desktop, against owner ruling `data-or-edit`.** D5 Phase B sets
   `ownWrite(id) = tab.ownWriteAt`. Under HEL-1575 a plain switch from X to Y replaces X's tab in place
   (`dashboardTabsSlice.ts:103-105`).
   - X's own-write record then has nowhere to land: `tabOwnWrite` (`:136-143`) is a no-op for an id with no tab, and the
     layout unmount flush (`useLayoutSave.ts:332`) is acknowledged after the leave stamp.
   - Result: edit X's layout, click Y in the context list, open Home, and X shows "changed since your last visit" for your
     own save. That is the most common edit-then-move-on path.
   - The Risks section calls the own-save gap "phone only". That is false.
   - Required: have `ownWrite(id)` also take a per-dashboard own-write stamp that does not depend on a tab existing.
     Fed from 1575's `noteOwnDashboardWrite` path, this reuses its signal rather than adding a new one. Two ways to do it:
     - persist the stamp next to `viewedAt` in the same entry, written from that call;
     - or reuse 1575's per-dashboard `ownWrites` record, if it is persisted when merged.
   - Correct the risk statement.
   - Add a spec scenario: "edit dashboard X, switch to Y, return to Home → X shows no dot". Add an e2e for it in task 3.3.
2. **`recordVisit` erases `viewedAt`.** D5 adds `viewedAt` "to the existing recent-visit entry", but
   `recentHistoryStore.ts:145-151` rebuilds the entry from scratch on every `recordVisit`. Boot auto-select
   (`recentVisitsListeners.ts:48`, on `fetchDashboards.fulfilled`) would therefore wipe the newest dashboard's stamp on
   every Home load. With no stamp there is no dot, so the spec's own "Loading Home does not hide a change" scenario fails.
   - The 10-entry cap is shared with sources and pipelines. A few clicks on Home's "Open" links (pipeline visits) evict
     every dashboard stamp.
   - Required, in D5 and task 1.9a:
     - `recordVisit` carries an existing `viewedAt` forward, or the stamp lives in a keyed map that the palette's
       rewrite and cap do not touch (still the recent-visit data, per the ticket);
     - state the eviction rule and its bound explicitly;
     - add a test: given a stored `viewedAt`, boot auto-select of that dashboard leaves it intact. "Writes no stamp" alone
       does not catch this.
3. **The coarse-pointer timeline violates the 44px touch floor (DESIGN.md §3, [mechanical]).** D7 and the home-page spec
   give coarse-pointer marks "hit areas ≥24px". §3 requires 44x44 on `(pointer: coarse)` regardless of width, with
   expanders that tile. On an iPad (820/768/1024, coarse) a 30h axis gives about 17-30px per hour, so 44px expanders
   cannot tile and overlapping marks steal each other's taps.
   - Required: under `(pointer: coarse)`, use the same ≥44px per-pipeline disclosure rows as the phone layout.
     Tap-target behaviour may be device-gated per §3, while the phone layout itself stays width-gated. Alternatively,
     specify another design that provably meets 44px with tiling.
   - Update the spec sentence and task 1.11a. Add a test at 820px with coarse pointer emulation.
4. **First-run on Home: the "Set up step by step" path is undefined.** `FirstRunDropZone` cannot render "unchanged"
   without an `onStepByStep` handler. In PanelList that handler drives local state plus `reopenOnboarding()` to show
   `OnboardingChecklist` there. The `first-run-onboarding` delta scenario says the checklist is revealed on `/home` too.
   - Required: D6 and the home-page spec state what the control does on Home, and test it in 1.13. Either Home renders
     `OnboardingChecklist` in the shelf area, or it navigates to `/dashboards` with the checklist revealed.
5. **Retry / Run now can still overlap a live run.** D6 and the spec drop Retry for stuck items because "a second submit
   would run concurrently". The same holds when an unresolved failed or missed item belongs to a pipeline that has a
   `queued`/`running` run (under 15 minutes, so not yet stuck). For example, the scheduler or an auto-run is already
   re-running it.
   - Required: hide or disable Retry and Run now while the summary shows an in-progress run for that pipeline. Give it
     plain copy such as "Running now".
   - Add a spec scenario and a component test. This keeps the D6 rationale consistent.

### Non-blocking notes

- `viewedAt` written before any summary or 1575 change-signal response uses offset 0 (client time), the same fallback as
  1575's `serverClock.ts`. In Phase B, use 1575's `serverClock` as the single offset (D5 already says so) rather than a
  second offset module. In Phase A, reuse it if it is available after the merge.
- Retention caps at 300 per pipeline. A pipeline firing more than 300 times a day cannot show a full 24h. Tie
  `runsOmitted` and the timeline's "+N earlier" copy to "history starts at X" in that case.
- Under Phase B, 1575's shell refresh issues `/api/dashboard-changes` on `/home`. D5 records it as shell traffic. The PR
  network-log evidence should list it explicitly so AC 1's reviewer sees it was considered.
