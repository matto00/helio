## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/home-page-run-timeline/HEL-1578`.
- **Owner answers (C1):** `.concertino/runs/HEL-1578/events.jsonl` line 5 `escalation.answered` sub_answers
  `["home-at-home","four-changed-first","top-8-failures-pinned","stuck-or-missed","keep-24h","build-now-wire-after-1575"]`
  (t=1792045690 = 2026-10-15 06:28 UTC, so the "2026-10-15" date in C1 is correct in UTC). Question text matches
  `planning-escalation-1.json`. HEL-1574 `home-points-to-dashboards` (line 5) and `keep-six-1583-decides` (line 12)
  confirmed; `data-or-edit` confirmed in HEL-1575 events line 5.
- **openspec:** `openspec validate home-page-run-timeline --strict` → "Change 'home-page-run-timeline' is valid". Every
  MODIFIED/REMOVED requirement header matches its live spec header exactly; the app-shell-rail "Context list" MODIFIED
  diff against the live text only adds "Home," and one scenario (no accidental drops).
- **Migration number:** live main tops at V134; another lane's worktree holds `V135__pipeline_run_step_row_counts.sql`,
  so V136 is the next free version (D4 is right).
- **RLS precedent:** `OutputHistoryRlsSpec.scala:90` asserts `rolbypassrls = false` on a `helio_app_test` pool, the
  same shape D3 plans. `DbContext.withUserContext` (DbContext.scala:50) runs on the app pool.
- **HEL-1575 reuse:** read its design D4/D6/D7 and `specs/dashboard-change-signals/spec.md`. D5's dot rule
  (`contentUpdatedAt > max(lastSeen, ownWrite)` or `dataUpdatedAt > lastSeen`) matches 1575 D7, and D5 reuses the
  1575 repository query rather than a second mechanism. Folding the change times into `/api/home-summary` is needed
  to keep AC 1's "one summary call".
- **/home spec coverage:** grepped `openspec/specs` for `/home`. Covered by deltas: nav-section-registry, app-shell-rail,
  marketing-landing-page, frontend-auth-ui, frontend-data-sources-page, frontend-pipelines-page,
  pipeline-proposal-review-ui, first-run-onboarding, mobile-dashboard-sheet. Still true after the move (no delta
  needed): mfa-login-verification-ui, google-oauth-callback-page, oauth-error-display, pwa-installability
  (`start_url: "/home"` stays). **Not covered:** `mobile-bottom-nav/spec.md:12` names `/home` as the Dashboards
  destination ("six section destinations ... (`/home`, `/sources`, ...)"), which this move makes false (CR6).
- **Frontend call sites:** 38 non-test `"/home"` sites in `frontend/src` (D1's "26" undercounts; the per-site table in
  task 1.8 covers it). Notably `shared/chrome/resourceNavigation.ts:69-70` (palette/assistant "open dashboard" goes to
  `/home`) and `features/auth/utils/postLoginReturnTo.ts:23` — both fall under the D1 purpose rule, fine.
- **e2e:** `grep -rln '/home' e2e` → 45 files, 177 references (78 `goto`/`toHaveURL` on `/home`), including
  `e2e/support/auth.ts` and `e2e/support/isolateLivePage.ts`. No task touches them (CR5).
- **Dashboard visit recording (D5 premise):** D5 says "Opening a dashboard records a visit
  (`RecentVisitsRouteObserver`)". False: `RecentVisitsRouteObserver.tsx` records only sources/pipelines; dashboards are
  recorded by `features/commandPalette/state/recentVisitsListeners.ts` on any **transition of
  `selectedDashboardId`**, including `fetchDashboards.fulfilled`. `App.tsx:165` dispatches `fetchDashboards()` at shell
  mount, and `dashboardsSlice.ts:439-444` auto-selects `getMostRecentDashboardId` = `dashboards[0]` (list sorted by
  `lastUpdated` desc). `recentHistoryStore.ts:149` stamps `visitedAt: Date.now()` (client clock). See CR1.
- **Schedule fire computation (D2 premise):** `CronSchedule.scala:40-49` — for `Interval` schedules
  `nextFireTime(after)` returns `after + interval`, i.e. it is anchored on whatever instant is passed, not on the
  schedule's real cadence. See CR2.
- **Retry on stuck runs:** no per-pipeline "already running" guard exists in `services/pipelines` (grep for
  `AlreadyRunning`/"already running" finds none; the only `Conflict`s are post-run). See CR4.
- **DESIGN.md:** §0 accent discipline is honoured in D7 (now line neutral) and the dot reuses 1575's token. §9 and §12
  both still say Home "is never marked current/active"; task 1.14 updates only §9 (CR6). §12 binds the 44px tap floor
  and tiling on phone; the plan has no phone/touch design for the timeline (CR3).
- **Board:** HANDOFF.md row 3 "B2 · Home" is a desktop board only; there is no phone Home reference.

### Verdict: REFUTE

### Change Requests

1. **D5 "last seen" is polluted by boot auto-select and mixes clocks — AC 4 and the dot rule are not reliably
   satisfiable as written.** (a) Correct the mechanism citation: dashboard visits come from
   `recentVisitsListeners.ts` (state transition of `selectedDashboardId`), not `RecentVisitsRouteObserver`. (b) Because
   every shell load on `/home` runs `fetchDashboards.fulfilled`, which auto-selects `dashboards[0]` (the most recently
   updated dashboard) and records a "visit" with `Date.now()`, the dashboard most likely to have changed would have its
   dot suppressed on every Home load without the user opening it. And if that dashboard is already selected, opening it
   from the shelf causes no transition, so no new visit is recorded. On phone, with no tab stamp, the dot then never
   clears. (c) `visitedAt` is client time while `contentUpdatedAt`/`dataUpdatedAt` and 1575's stamps are server time
   (1575 D4/D7 built `serverOffsetMs` for this reason). Revise D5 so that `lastSeen` comes only from an actual arrival
   at the dashboard view route (`/dashboards`, `/dashboards/:id`), not from a boot/auto-select transition, and is
   expressed in server time. Use 1575's tab stamps where they exist, plus a route-arrival stamp recorded in server time.
   Spell out where that stamp lives and how it converts. Add a spec scenario: "landing on Home does not clear any
   dashboard's dot", and "opening the already-selected dashboard from the shelf clears its dot (phone and desktop)".
2. **D2 computes upcoming fires from the wrong anchor.** "Iterate `CronSchedule.nextFireTime` from `serverNow`"
   is wrong for interval schedules: for a `1h` interval whose stored `next_run_at` is in 10 minutes, it yields
   now+1h, now+2h, and so on. `upNext` and the timeline's scheduled marks would then show times that never fire. The
   "hourly schedule → six fires" scenario passes either way, so it hides this. Revise D2 and the home-summary-api spec:
   the first fire is the stored `next_run_at` when it is at or after `serverNow`. Subsequent fires iterate
   `nextFireTime` from the previous fire. Define the overdue case (missed: `next_run_at` < serverNow−10min) explicitly,
   including what `upcoming`/`upNext` show for that schedule. Add an interval-schedule scenario whose
   `next_run_at` is not aligned to `serverNow`.
3. **No phone/touch design for the timeline (DESIGN.md §12, §3 tap floor; spec requires 375px).** At 375px a 30-hour
   axis gives about 12px per hour, so 44px tap targets cannot tile. Hover details are unavailable on touch, and the spec
   makes a tap navigate away ("open `/pipelines/:id` on click"), so a phone user can never read a run's details or
   error. Specify the coarse-pointer and phone behaviour in D6/D7 and the home-page spec. For example: the first tap
   shows details and an explicit Open action navigates; a phone layout that meets the tap floor (per-row summary or
   compressed marks with an expanded hit row); and how overlapping marks are reached. Without this, two competent
   implementers would build different things.
4. **Retry on `stuck` items can start a second concurrent run of a still-live pipeline.** A run that has been
   `running` for more than 15 minutes with a live heartbeat (HEL-1511 reaps only heartbeat-less runs) is not dead. No
   per-pipeline in-flight guard exists for manual submits, and HEL-1504 already avoids overlapping auto-runs. Meanwhile
   `missed` items, the natural "run it now" case, get no Retry. Revise the home-page "Needs attention and Retry"
   requirement: either drop Retry for `stuck` (offer Open only) and decide explicitly whether `missed` gets "Run now",
   or state the overlap behaviour and its write-back risk as a recorded decision with a test.
5. **Existing e2e suite not planned for the route move.** 45 e2e files (177 references, including
   `e2e/support/auth.ts` and `e2e/support/isolateLivePage.ts`) assume `/home` is the dashboard grid. Add a task to
   retarget them under the D1 purpose rule, recorded in the same site table as task 1.8. Run the affected e2e specs
   (≤2 workers) as a verification step; task 3.5's gate list currently omits e2e entirely.
6. **Spec and design-doc deltas still falsified by the move.** (a) Add a `mobile-bottom-nav` delta: its "Bottom tab bar
   provides section navigation on phone" requirement names `/home` as the Dashboards destination. (b) Extend task 1.14
   to update DESIGN.md §12's "Home tab (HEL-1574)" bullet ("aliases `/home` and is never marked active"), not only §9,
   since both become false. (c) Optional but cheap: add `/dashboards` to `frontend-protected-routes` "App routes wrapped
   with ProtectedRoute".
7. **New-user first-run path: state the decision.** Today a zero-dashboard user lands directly on the HEL-1209 drop
   zone. Under this plan they land on Home and need an extra click. The owner's `home-at-home` answer did not mention
   the first-run consequence. Either render the existing first-run drop zone and template chips inline in the Home
   empty shelf (reusing `FirstRunDropZone`, so a new user's first screen is still one step from a dashboard), or keep
   the link and record it in design.md as a decision the PR asks the owner to confirm, alongside the ticket's own
   "confirm the landing in the PR". Either way, update the "Brand-new user" scenario to name the chosen path.

### Non-blocking notes

- D1 says "26 `"/home"` targets"; the live count is 38 non-test sites. The task 1.8 table makes this harmless; just
  don't rely on the number.
- D3: also assert `rolsuper = false` in the non-BYPASSRLS session (a superuser bypasses RLS whatever its
  `rolbypassrls` says), and name the `helio_app_test` harness as the precedent.
- The "hourly → six fires" scenario depends on whether `serverNow` sits exactly on the hour (exclusive `horizonEnd`).
  Pin the fixture clock off the hour.
- Phase B: if HEL-1575's change-signal refresh runs from a shell-level hook on hydrate, it would add a second
  `/api/dashboard-changes` request on `/home` and break AC 1's network-log assertion. Check this when re-reading 1575.
- The ticket says "Click opens the run". No run deep link exists (`AppRoutes.tsx:118-119`), so Open goes to
  `/pipelines/:id`. Record this as a deviation in the PR and in a follow-up once HEL-1579 lands.
- The spec's `runs` says window-only, while D2 query (1) also selects queued/running rows outside the window (for
  stuck items). Make clear these feed `attention` only, never `runs`.
