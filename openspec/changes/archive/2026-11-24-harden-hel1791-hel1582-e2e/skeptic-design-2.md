## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD cd23c664a76f9e51ad0d934bf0f860684ca47ba1. The change dir holds untracked planning artifacts only, and no spec file differs from main.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/hel1791-hel1582-e2e-hardening/hel-1830`.
- **Round-1 items, each checked against the current design.md:**
  1. *The tap (b) red used a mechanism that cannot redden.* Fixed. Decision 4 now uses HEL-1826's coordinate stand-in: hold the response, record the centre, release, reflow, then `touchscreen.tap` at the recorded point with `elementFromPoint`. The fixed run is the counterpart. Decision 4 says there is no natural red and cites `t2-delay-sweep*.txt`. Decision 6 drops the "remove the wait under a hold" mutation and keeps the off-screen mutation. Both cited sweep files exist in the HEL-1826 archive.
  2. *The outcome rule was incomplete.* Fixed. Outcomes (i) to (iv) cover four cases: the count moves the trigger; another late child moves it; it moves but the stale point still hits; it never moves. The request that sets `countText` is observed, not hard-coded.
  3. *Cross-check inside one window.* Fixed. The design records the first charged request time and the 429's `Retry-After`, checks window age against elapsed time within 2 s, and repeats the run on a rollover. `POST /api/auth/register` is excluded. The threshold applies to the sliding `max-60s`. I checked this against `InMemoryRateLimiter.scala:29-51`: `Retry-After = max(1, 60 - floor(elapsed since windowStart))`, so `60 - Retry-After` is the window age to 1 s granularity. The 2 s tolerance is sound. The sliding 60 s maximum is a valid upper bound on any fixed-window count.
  4. *Threshold contingency.* Fixed. Task 2.2 projects the per-test cost before 2.3 is written. If the projection is above 50, the fallback is one owner per (theme, width). Counts are also logged under CPU 4x.
  5. *Run state before the first load.* Fixed. There is a bounded, messaged wait for a terminal run state, polled at 500 ms or slower, with the polls counted. It is applied to both boards. A pollable surface exists: `e2e/support/hel1575-dashboard-tabs.ts:276` already matches `/api/pipelines/:id/runs/latest`.
  6. *Vacuous post-fix stress.* Fixed. The post-fix stress is now an isolation control: it burns the light owner test's principal before the dark test runs. It is labelled as not a red/green pair. The non-vacuous evidence is the counts.
  - Round-1 non-blocking notes: the `:290` test is now counted, the editor is reported under the 60 rule with the same-shape fix offered, and `openStack` targets are explicit. All three are adopted.
- **hel1791 ground truth** (`e2e/hel1791-compact-counter-stack-height.spec.ts`):
  - The beforeAll seeds 3 sources, a pipeline, an output, a run, a dashboard, 7 panels and 2 grants (lines 61-142).
  - The `role x THEMES` loop runs at lines 168-254. Each test makes 3 `openStack` loads and uses `test.setTimeout(90_000)`.
  - `openStack`'s default target is `{ id: dashboardId, items: 7 }` (line 153), which matches the design's description.
  - The `:290` test already has its own principal and uses `finally` cleanup (lines 290-403).
  - `playwright.config.ts:191` sets `fullyParallel: false`.
- **Timing feasibility (AC3, C5/C15).** HEL-1826's `t1-plain.txt` shows the full hel1791 file at 36-54 s per run. Its `t2-plain.txt` shows the full hel1582 file at 2.5-2.6 min. Full-file runs fit the 600 s Bash timeout. Decision 7's batching and C15's fallback cover the slower stressed runs.
- **hel1582 tap (b) ground truth.**
  - The spec at lines 296-310 opens `.spine-row__select` nth 0, waits for the sheet's animations, then taps `sheet(page).locator(".output-schema-disclosure__trigger").first()` with no count wait.
  - `MobileStepSheet.tsx:79-119` renders `StepCardFocused` and then `StepPreviewTable`.
  - `OutputSchemaDisclosure` is used only in `StepPreviewTable.tsx:299-330`. So the sheet's `.first()` trigger is the one in the preview header, whose late children are count, caption, diff chips and schema. Decision 4's description is accurate.
  - The trigger itself renders only when `chipFields` exceeds the small threshold. If it first appears with the response, there is no pre-reflow point, and outcome (iv) covers that case.
- **Contract and scope.** E2E-only. No API or schema change, so no delta is needed. `skip_specs: true` is appropriate. Every AC maps to a task: AC1 to 2.1-2.3 and 4.1-4.2, AC2 to 3.1-3.3, AC3 to 4.1. Nothing goes beyond the ticket. I found no TODO/TBD placeholders.

### Verdict: CONFIRM

The revised design answers all six round-1 change requests concretely, and its premises check out against the live tree. The remaining points below are non-blocking.

### Non-blocking notes

1. **Measured counts above 60 after the fix.** The fallback shape is triggered only by the task 2.2 projection, which is measured pre-fix at 1x. If the post-fix measured `max-60s` is above 60, at 1x or under CPU 4x, treat it as the same trigger: switch to the per-(theme, width) shape. Do not just log the number and move on, because Decision 2 defines "well under" as at most 60 in both.
2. **Movers outside the preview header.** In the sheet, the trigger sits below `StepCardFocused`. A late height change in the editor above it, for example when analyze columns arrive, would move the trigger vertically without any header child changing. Have the per-frame probe also log the `StepCardFocused`/`.mobile-step-sheet__content` box and the sheet's `scrollTop`, so that an outcome (ii) mover outside the header can be named rather than misattributed.
3. **Counting `page.route`-fulfilled requests.** The `:290` test fulfils `POST .../submit` with `page.route`, so that request never reaches the limiter. `context.on("request")` still sees it. Counting it overcounts by one, which keeps the bound conservative. Either note this in the log or exclude route-fulfilled requests.
4. **Pipeline cleanup.** The current afterAll deletes the dashboard and sources but not the pipeline or output. Per-test seeding multiplies that residue. Consider deleting the pipeline in each per-test `finally`, if the API allows it with the sources gone; order the deletes accordingly.
5. **Round-1 rollover claim.** The round-1 report said HEL-1826's run "took well over 60 s", so the window had rolled. `t1-plain.txt` shows the full file at 36-54 s, so that premise looks wrong. This does not affect the design, which now checks for rollover explicitly instead of assuming it either way.
