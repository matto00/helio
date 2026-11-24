## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD cd23c664a76f9e51ad0d934bf0f860684ca47ba1 (the change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/hel1791-hel1582-e2e-hardening/hel-1830`.
- **hel1791 current shape.** I read `e2e/hel1791-compact-counter-stack-height.spec.ts`. The beforeAll `owner` seeds 3 sources, a pipeline, an output, a run, a dashboard, 7 panels and 2 grants (about 17 charged calls). The `for role x THEMES` loop runs owner light and owner dark on that principal, with 3 `openStack` loads each (lines 175-254). `measurer` and the `:290` owner-live-regions test already have their own principals. `playwright.config.ts:191` sets `fullyParallel: false`, so the file runs serially in one worker. The design's description of the file is accurate.
- **Limiter semantics.** `InMemoryRateLimiter.scala:29-51` is a fixed window. A new window starts at the first request after the old one expires, and rejected requests also increment the count. `RateLimitDirective.scala` keys on `user:<id>` from the `helio_session` cookie. A request with no cookie is not charged, so `POST /api/auth/register` (`e2e/support/auth.ts:56`, made before the cookie is set) is not charged. `GET /api/auth/me` (`auth.ts:72`) is charged.
- **No service-worker blind spot.** `frontend/vite.config.ts` sets `devOptions.enabled: false`, and the config sets `serviceWorkers: "block"` (line 185). Page `/api` traffic therefore all appears on `context.on("request")`.
- **HEL-1826 budget data.** `skeptic-final-1.md:34` (archive) says the shared owner had remaining=20 and 22 at CPU 1x and 25 at CPU 6x after the two owner theme tests. `t1-probe-evidence.txt` gives the probe's window age as 36-37 s at the end of the original file. That run took well over 60 s, so the window had rolled at least once: "remaining" is relative to the current window, not to the whole run. The CI trace shows the first 429 is a repeated `GET pipelines/<id>` poll by the owner client, so the owner's spending is driven by polling, which grows with time.
- **hel1582 tap (b).** I read the spec at lines 247-314. The sheet (`MobileStepSheet.tsx:103-117`) renders the same `StepPreviewTable` as the Preview tab. Its header (`StepPreviewTable.tsx:299-330`) has the same late children: `.step-preview__count` (when the preview row count arrives), the caption, the diff chips (`showDiff`, from analyze) and the `OutputSchemaDisclosure`. `useStepPreviewFetch.ts` seeds a fresh mount from the cache only when `paused` or `held`, and `dedupe` only shares in-flight requests. So the sheet's fresh mount most likely issues its own `GET /api/pipelines/:id/steps/:sid/preview` (`pipelineService.ts:322-328`) and starts with no count. The design's suspicion about a cached preview is reasonable, and Decision 4's "log whether a request is issued" settles it. This is a code reading; the probe must confirm it, per C18.
- **HEL-1826's T2 red method.** `root-cause.md:31-43,83` and `t2-delay-sweep.txt`: releasing the held preview 0-140 ms after the tap starts gave `OPENED=true` in every run, at 1x and at 6x. HEL-1826 states "T2 has no natural red"; its deterministic evidence was the coordinate stand-in: a tap at the recorded pre-reflow centre after the reflow (`t2-stale-tap.txt`: opened=false, hit a diff chip).

### Verdict: REFUTE

Decision 1 (one owner and one board per owner theme test) is the right shape: a dashboard has one owner, so a per-owner principal needs its own board. The Decision 2 counter design is also sound in principle. Four planned items will not work as written, though, and one would produce vacuous evidence.

### Change Requests

1. **Decision 4 / 6 / task 3.2: the planned red for tap (b) is contradicted by the precedent being reused.** Decision 4's red ("the unfixed spec with the sheet's preview response held/released around the tap fails at `checkPanel("step sheet")`") is the mechanism HEL-1826 measured and found does NOT redden: `t2-delay-sweep.txt` and `t2-delay-sweep-6x.txt` show OPENED=true at every release delay. While the response is held, Playwright's `locator.tap()` hits the trigger at its current position, which is still correct, so the panel opens. Decision 6's mutation ("removing the wait under the deterministic hold reds") has the same flaw.
   - Revise both to the HEL-1826 coordinate stand-in: hold the response, record the trigger centre, release it, wait for the reflow, then `page.touchscreen.tap` at the recorded point. Assert that the panel did not open and record what element was hit.
   - For the fixed spec, the counterpart is the same sequence with the wait in place: the coordinate is taken after `.step-preview__count` is visible, and the panel opens.
   - State, as HEL-1826 did, that there is no natural red for the race itself.

2. **Decision 4: the outcome rule is incomplete.** It covers only "moves and the stale tap misses" and "does not move / no late count". Two more outcomes must be defined:
   - (a) The trigger moves, but a tap at the pre-reflow centre still opens the panel (the sheet's header is narrower or laid out differently from the Preview tab's). Say whether a wait is added and what evidence states it.
   - (b) The probe's per-frame header log shows a late child other than `.step-preview__count` moving the trigger: the diff chips (`showDiff`/analyze), or the caption. Then the wait must target the precondition that actually moves the trigger, not the count by default.
   - Also name the request that delivers the count as "the request that sets `countText`" (`steps/:sid/preview`, or the draft-preview stream if `presentation.previewDraftFor` is active). Do not hard-code `steps/:id/preview`.

3. **Decision 2: the cross-check must prove it was measured inside one limiter window.** The window is fixed and restarts at the first request after it expires (`InMemoryRateLimiter.scala:37-38`). If the principal's window has rolled since its first request, `count + remaining ≈ 120` fails for the right counter, or passes by coincidence. HEL-1826's own probe shows a rolled window (age 36 s at the end of a run of more than 60 s).
   - Require the probe to record when the principal's first charged request was made and the `Retry-After` of the probe's 429. Accept the cross-check only when window age = 60 − Retry-After matches the elapsed time since that first request (that is, no rollover).
   - Run the cross-check on a per-owner-test principal, which is short enough to fit in one window.
   - Exclude `POST /api/auth/register` from the counted total (no cookie, so the limiter does not charge it), or count it separately.
   - Say which number the threshold applies to: the sliding `max-60s`, an upper bound on any fixed-window count. Do not use `total`, which can exceed one window for a test longer than 60 s.

4. **Decisions 1/2: "at most 60" is plausibly the expected value of the planned shape, and there is no contingency.**
   - From HEL-1826's numbers: about 17 seeding calls, plus 95-100 charged across seeding and two owner tests (remaining 20-22), gives roughly 40 per owner theme test. A per-test owner then spends about 17 seeding + 1 `auth/me` + about 40, which is about 58. That is at the threshold before any CI slowdown.
   - Require task 2.2's pre-fix counts to be used to project the per-owner-test cost before 2.3 is written. Name the fallback shape if the projection exceeds about 50, for example one owner and board per (theme, width), which costs about 17 + 14.
   - Because owner spending is polling-driven (CI trace: `GET pipelines/<id>` polls), also log the counts in the 5x stressed runs under CPU throttle 4x (HEL-1826's slow-runner proxy). The "well under" claim must hold there, not only at 1x.
   - With those two additions, 60 (half the window) is a defensible definition of "well under". Without them it is an untested guess at the boundary.

5. **Decision 1: per-test seeding moves `POST /run` to just before the first page load, and the design does not say whether the run must be finished first.** In the beforeAll today, the run finishes long before the owner tests open the board. If it is still in flight, the Output panel and the owner client's pipeline/status polling can behave differently. That changes both what the test observes and its request count.
   - Specify it: either wait for the run to reach a terminal state before `openStack` (a bounded, messaged wait whose polls are counted against the principal), or show with probe output that `LIVE_STACK_ITEMS` and the counts are unaffected.

6. **Decision 3: the post-fix stress as written is vacuous.** After the fix, "the same stress" burns the shared `owner`, which the owner theme tests no longer use, so their green proves nothing.
   - Define the post-fix stress as the analogue: burn the remaining budget of the principal the previous owner theme test used, right before the next owner test's page load, and show the next test stays green.
   - Label it in the evidence as an isolation control, not a red/green pair.
   - The non-vacuous evidence for item 1 is the logged counts in revisions 3 and 4.

### Non-blocking notes

- Say explicitly that the `:290` "owner: a status message..." test also logs its count. It is an owner test, and the AC says "each owner test".
- The editor principal spends two theme tests (6 page loads) in one window, the same shape as today's owner minus seeding. Reporting it under the 60 rule is fine. Expect it to land near the limit, and have the same-shape fix ready for the orchestrator's decision.
- `openStack`'s default target is the module-level `dashboardId`. When the owner tests move to their own boards, pass the target explicitly so no owner test can silently fall back to the beforeAll board.
