## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `1fef1d5a28d5f41b8fe73c2aff8c0532ef6bd5f9` against the live-resolved base `60086f02bb5b1ee48f2246bc09e3e66349199585`
(origin/main). Scope is Phase A only. Phase B (tasks 2.1, 2.2, 3.3: the changed dot, `dashboardChanges` wiring and
`ownWriteAt`) is deferred by the owner ruling `build-now-wire-after-1575` and was not counted against this verdict.

### Fresh evidence (my own runs, this worktree)

- `npm run lint`, `format:check`, `typecheck`, `check:schemas`, `check:tokens`, `check:scala-quality`, `check:openspec`:
  all exit 0.
- `npm test` (3 workers): root 51 suites / 469 tests, frontend 626 suites / 7360 tests, 0 failed.
- `npm --prefix frontend run build`: exit 0 (3538 modules).
- `sbt testOnly` shards (the log reads `set current project ... worktrees/feature/home-page-run-timeline/HEL-1578/backend`):
  infrastructure 1083, api 2334, domain 2552, services 2101 (4 canceled `HELIO_MEASURE` report-only), spark+testkit+testsupport 73.
  Every shard: `failed 0`.
- Playwright (2 workers, DEV_PORT=7010): `hel1578-home-page`, `hel1574-shell-rail`, `hel1562-landing-page`: 45 passed.
- Mutation runs in a throwaway detached worktree at the reviewed SHA. The worktree was removed afterwards and
  `git worktree list` shows no straggler.
  - **M1**: `PipelineRunRepository.scala` reverted to main's keep-10.
    - Result: `failed 4` of 74. The two new retention cases in `PipelineRunRepositorySpec` fail ("40 runs over 20h",
      "350 inside 24h"). So do the rewritten `FireTimeRunConfigGateSpec` and `PipelineRunEditorPersistenceSpec`
      keep-24h cases.
    - The red-first claim is genuine.
  - **M2**: `p.owner_id = $owner::uuid` replaced by `true` in both `HomeSummaryRepository` queries.
    - Result: `HomeSummaryScopingSpec` "exclude A's pipelines for B on a connection that bypasses RLS" FAILED.
    - `HomeSummaryRoutesSpec` (non-bypassing app pool) still passed, so RLS scopes the data on its own.
    - The mutation claim is genuine.
  - **M3**: the scheduled-skip prune disabled (`if (false && pruneOldRuns && ...)` in `PipelineRunService.recordUnrunnable`).
    - Result: `FireTimeRunConfigGateSpec` "keep every run of the last day over 12 fires ... (1.1a; guard for the
      prune call)" still PASSED.
    - The guard is no longer failable. See CR3.

### Phase 1: Spec Review — FAIL

Acceptance criteria:
- **AC1** (one summary call, no fan-out): met.
  - My network log on `/home`: `auth/me` ×2, one `home-summary`, `dashboards`, and the shell's existing
    `dashboards/:id/panels` for the auto-selected dashboard.
  - That panels request comes from `App.tsx:168-174`, the shell effect that already existed. It is not per-pipeline
    and not added by Home.
  - There were no `/api/pipelines/...` requests. The new-user run showed exactly one `home-summary`.
- **AC2** (timeline, shapes, keyboard, labels): met.
  - 28 marks rendered with exactly 1 roving tab stop.
  - Labels read like "orders-sync, failed, 00:31, source returned 0 rows".
  - Down, Down, End and Left moved focus across rows and showed the tooltip, which is linked by `aria-describedby`.
- **AC3** (failed run with its error; Retry goes through the HEL-505 guards): met. The e2e test shows one POST to
  `/api/pipelines/:id/run` through `runToUpdate`. A mocked 429 is covered in a unit test.
- **AC4** (dot clears): deferred to Phase B as expected. The Phase A seams are sound (see below).
- **AC5** (new-user empty states): the new-user view itself is met. But the home-page requirement "Designed states
  for a new user, loading and failure" is not met for Needs attention and Up next while loading or after a failed
  load. See CR1.
- Task checkboxes match the implementation. Phase B items are correctly left unchecked.

Constraints:
- C1, C2, C4 and C5 are honored.
  - C2: `isDashboardViewPath` is extended in place, and `isDestinationActive` replaces the rail-local predicate, so
    there are no parallel conditionals.
  - C5: `submitPipelineRun` is untouched.
- C3 is honored: retention is red-first (M1), and RLS is proven on a session where `rolbypassrls`/`rolsuper` are both
  false, with a `withSystemContext` positive control.

Phase B seams:
- `helio.dashboardSeen` is a separate keyed store, pruned on dashboards load and capped at 500.
- Live check: several `/home` loads with "Ops health" auto-selected wrote nothing. Opening "Revenue overview" from
  the shelf stamped only that dashboard.
- The response contract carries `dashboardChanges` (always `[]` for now), and `HomeSummaryLimits.MaxDashboardChangeIds = 20`
  leaves room for `dashboardIds`.
- No parallel change-signal mechanism was built: `useChangedDashboardIds` returns an empty set, and it is the one
  consumer seam.

Executor deviations:
1. Projecting a null `next_run_at` forward from now: **accept**. It mirrors `recomputeOnly`, is unit-tested and is
   outside every spec scenario.
2. Changes to existing retention tests:
   - `PipelineRunRepositorySpec` (two seeds moved more than 24h back): **legitimate**. The keep-N assertion is
     preserved for runs outside the window.
   - `PipelineRunEditorPersistenceSpec`: **legitimate**. Pruning-for-editors is re-proven on runs 3 days old, and a
     keep-24h case was added. M1 confirms both directions.
   - `FireTimeRunConfigGateSpec`: the assertion matches the new rule, but **its stated purpose is lost** (CR3).
3. `runToUpdate` gaining `rejected`/`retryAfterSeconds`: **accept**. The change is additive and unit-tested, and
   `submitPipelineRun` is unchanged.
4. Retargeting `waitForShell`: **accept**. All callers still wait for the dashboard view's shell.
5. Guards retargeted to `/dashboards`, leaving Home uncovered: **Home needs that coverage**. The state-surface guard
   would have caught CR2. See CR4.
6. In-flight dedupe in the thunk: **sound, does not mask a real double fetch**. In production the mount effect runs
   once. The `condition` only collapses overlapping dispatches (StrictMode, visibility during a Retry). One edge is
   listed under suggestions.

Call-site tables:
- A fresh `git grep` of `frontend/src` (non-test) matches the 1.8 table: the remaining `/home` hits are only the
  "kept" app-home sites and comments.
- `git grep 'goto("/home")' e2e` has zero hits. The remaining `waitForURL("/home")` calls are post-login landing
  assertions, each followed by a `goto` or isolation.

### Phase 2: Code Review — FAIL

Issues:
- **[mechanical] DESIGN.md §3 state rung (HEL-866 table)**: the hover backgrounds use the wrong rung on an
  `--app-surface` backdrop.
  - Sites: `frontend/src/features/home/ui/HomePage.css:227-231` (`.home-btn--secondary:hover`, `.home-btn--ghost:hover`)
    and `HomePage.css:503-505` (`.tl__mark:hover`) use `--app-surface-soft` on the `.home-card-panel` backdrop
    (`--app-surface`).
  - The table requires `--app-surface-strong` in dark and `--app-surface-soft` in light, via a
    `:root[data-theme="dark"]` override (precedents: `App.css:253`, `PipelineDetailPage.css:1288`).
  - Measured live in dark: hovered Retry `rgb(22,21,20)` on card `rgb(26,24,22)` is **1.03:1**, below the guard's
    1.10 threshold (`e2e/support/stateContrast.mjs:19`).
  - `--app-surface-strong` would give 1.13:1. Light is fine at 1.15:1. → CR2
- **Weakened test (spec-update made non-failable)**: `backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala:253-271`.
  - The test is still titled "guard for the prune call" but now asserts `rs.size shouldBe 12`, which is also the
    result when the prune never runs (M3 passed).
  - HEL-1384 D3a's protection ("a misconfigured cron cannot grow it without bound") on `recordUnrunnable(pruneOldRuns = true)`
    is now unguarded. No other test references `pruneOldRuns`. → CR3
- Everything else passes:
  - DRY: `runToUpdate`, `EmptyState`, `Skeleton`, `FirstRunDropZone` and `useIsPhoneShell` are all reused.
  - Typing: no `any`.
  - SQL is fully parameterised (`$owner::uuid`, `$window`).
  - The protocol writes explicit nulls deliberately.
  - Constants live in `HomeSummaryLimits`.
  - The pure builder has scenario tests that use a clock set off the hour.
  - Retention `IN (subquery LIMIT)` is correct, and dry runs are untouched.
  - No dead code or TODOs.

### Phase 3: UI Review — FAIL

I reviewed the running app (7010/9917) as a seeded user (4 pipelines, 5 dashboards, failed, stuck and missed items)
and as a brand-new user. I checked both themes at 1280/820/768/375, plus 820 with a real coarse pointer (Chromium
`hasTouch` + `isMobile`, `(pointer: coarse)` = true).

Passes:
- No horizontal overflow at any width or theme.
- The shelf is 4 columns at 1280, 2×2 at 820/768 and one column at 375.
- At 820 coarse there are 4 disclosure rows, each 64px high, no `.tl__mark` buttons, and a 44px `::after` expander
  on `.home-btn` with `position: relative`.
- At 375, expanding orders-sync shows "failed 00:31 source returned 0 rows" plus "Open pipeline", with rows at least
  44px. Up next clears the BottomNav (891 < 932).
- Exactly one `aria-current` item (Home) on `/home`, and Dashboards on `/dashboards/:id`.
- The top bar reads "Home" at desktop.
- No console errors in any happy-path flow.
- The new user sees the drop zone, the "No pipeline runs yet" `EmptyState`, and "All quiet: nothing has changed,
  failed or been missed."

Issues:
- **False empty states while loading and after a failed summary.**
  - `frontend/src/features/home/ui/HomePage.tsx:82-83` passes `data?.attention ?? []` and `data?.upNext ?? []`
    whatever the summary status is.
  - With `/api/home-summary` delayed, the seeded user's Needs attention reads **"Nothing needs attention."** (with a
    check icon) and Up next reads **"Nothing is scheduled. Schedule a pipeline to see it here."**. The spec asks for
    skeletons of the final layout.
  - With the summary returning 500, both claims stay on screen beside the timeline's error. That user has an
    unresolved failure, a stuck run and three schedules, so Home tells them something false.
  - This violates home-page spec "Designed states ... Loading SHALL show skeletons of the final layout; a failed
    summary SHALL show an error with a retry" and DESIGN §7 ("never a flash of empty content", "never swallow a
    failed fetch").
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/openspec/changes/home-page-run-timeline/eval-1/state-fail-dark-1280.png`.
    → CR1
- The hover contrast defect above (CR2) is visible in the running app.
- Evidence for the passing checks:
  - `.../eval-1/pop-dark-1280.png`
  - `.../eval-1/pop-light-1280.png`
  - `.../eval-1/pop-coarse-dark-820.png`
  - `.../eval-1/pop-dark-375-expanded.png`
  - `.../eval-1/new-dark-1280.png`
  - All are under `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/openspec/changes/home-page-run-timeline/`.
  - Every claim above rests on measured values (contrast ratios, element heights, request lists), not on file order
    or mtimes.

Data cleanup: both throwaway users (`hel1578-evalpop-…`, `hel1578-evalnew-…@example.com`) were deleted by exact
id+email through `userCleanupCore.buildUserDeleteSql`. Afterwards 0 users and 0 of the seeded pipeline ids remain.
Servers were stopped with `stop-servers.sh` (`STOPPED ports=7010,9917`).

### Overall: FAIL

### Change Requests

1. **Do not show empty-state copy for Needs attention and Up next unless the summary has loaded**
   (`frontend/src/features/home/ui/HomePage.tsx:82-83`, `NeedsAttention.tsx`, `UpNext.tsx`).
   - Pass the summary `status` (or `data === null`) into both components.
   - While loading (`data === null && status !== "failed"`), render `Skeleton` rows in the card shape, as
     `PipelineRunsCard` already does.
   - On a failed first load, render no "Nothing needs attention" / "Nothing is scheduled" claim. Use a short
     "Not available right now" note, or hide the list body and rely on the one retryable error.
   - Add unit tests to `HomePage.test.tsx`: with a pending summary, neither "Nothing needs attention." nor
     "Nothing is scheduled." is present. With a rejected summary, neither is present and the retry is.
2. **Fix the hover state rung on the Home card backdrop** (`HomePage.css:227-231` and `:503-505`).
   - Add `:root[data-theme="dark"]` overrides that set `background: var(--app-surface-strong)` for
     `.home-btn--secondary:hover`, `.home-btn--ghost:hover` and `.tl__mark:hover`, per the DESIGN §3 HEL-866 table.
     Light stays `--app-surface-soft`.
   - Re-measure: the dark hover must reach at least 1.10:1 against `--app-surface`.
3. **Restore the scheduled-skip prune guard** (`FireTimeRunConfigGateSpec.scala:253-271`).
   - Before the 12 fires, seed more than 10 real runs started more than 24h ago, as the editor spec now does.
   - Assert that afterwards only the 10 newest of all runs older than the window survive, alongside all 12 recent
     fires.
   - Verify by mutation that the test FAILS with `pruneOldRuns` ignored in `PipelineRunService.recordUnrunnable`, and
     record the red run in `measurements.md`.
4. **Give the Home page guard coverage.** Add a `/home` route key to `e2e/state-surface-contrast-guard.spec.ts` (and to
   `e2e/focus-presence-guard.spec.ts`).
   - Seed at least one unresolved failed run (with `homeSeed.ts`) so that Open, Retry, timeline marks and Up next
     links are present in `<main>`.
   - Keep the existing `/dashboards` key.
   - This is the rendered arbiter DESIGN §3 names for CR2's defect class. Executor note 10 left it as a follow-up,
     and that gap is exactly what allowed CR2 through.

### Non-blocking Suggestions

- `NeedsAttention` + thunk `condition`: if a `visibilitychange` refetch is already in flight when a Retry's run
  returns, the post-Retry refetch is dropped. The list can then show the pre-run state until the next visibility
  change. Consider queueing one trailing refetch.
- `HomePage.css` is 723 lines serving nine components. That is over CONTRIBUTING's ~400-line split threshold and
  against DESIGN §1's one-stylesheet-per-component. Split it by component, or state the split in the PR.
- `PipelineRunsCard.tsx:43-44`: the first-load error prints the server message (e.g. "boom") in muted `.home-note`
  text. DESIGN §7 asks for intent-error styling. Consider an `InlineError`/`StatusMessage` and plain-language copy.
- `RunDisclosureList.tsx`: `aria-controls` points at a list that is not in the DOM while collapsed. Every expanded row
  repeats an identical "Open pipeline" link name, so consider including the status and time in each link name.
- Up next and timeline times have no day cue: "23:30" can be tomorrow while the eyebrow reads today.
- The PR body should list the observed `/home` request set (D5), including the shell's existing panels fetch for
  the auto-selected dashboard.
