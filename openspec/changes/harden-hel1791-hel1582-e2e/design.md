## Context

Main is cd23c664a. HEL-1826 (943b5dd73, archive `openspec/changes/archive/2026-11-22-deflake-hel1820-e2e-specs/`,
evidence `.concertino/runs/HEL-1826/evidence/` in the main checkout) is the method to reuse:

- **Rate-limit budget.** `InMemoryRateLimiter` is a fixed window of 120 requests per 60 s per principal (session user
  id), starting at the principal's FIRST request. HEL-1826 measured the shared hel1791 `owner` at 115-119 of 120 before
  it moved the `:290` test to its own owner (`t1-probe-evidence.txt`: a probe test spending `GET /api/auth/me` until
  429). Its trace counter (`probe-trace-request-count.py.txt`) grouped `/api/` requests by cookie with a sliding 60 s
  max. Its burn stress (`t1-stress-mechanism.py.txt`) spent the owner's remaining budget right before a request to
  turn the latent risk into a deterministic red.
- **Stale tap.** `t2-probe.spec.ts.txt` logged the "N fields" trigger's centre every animation frame, held the
  `steps/:id/preview` response, and tapped at the pre-reflow point: in the Preview tab the tap landed on a diff chip
  and opened nothing (`t2-stale-tap.txt`). The fix waits for `.step-preview__count` with a message.

Current state on main:

- hel1791: the `for role of [owner, editor] x THEMES` loop runs two owner tests (light, dark) and two editor tests on
  the beforeAll principals. The beforeAll `owner` also pays all seeding (3 sources, pipeline, output, run, dashboard,
  7 panels, 2 grants). Each theme test opens the stack at 390/768/1100 (3 page loads plus their polls). `measurer`
  and the `:290` test already have their own principals.
- hel1582 (~line 306-314): tap (b) opens the step sheet (`.spine-row__select` nth 0), waits for the sheet's
  animations, then taps `sheet(page).locator(".output-schema-disclosure__trigger").first()` with no wait for any row
  count. Whether the sheet's trigger shares the header layout that reflows (and whether a fresh preview request is
  even made for step 0, or the response is cached from tap (a)) is NOT known and is settled by probe.

## Goals / Non-Goals

**Goals:** item 1: no owner-role theme test shares its principal's window with another test, each owner-role test
logs its principal's request count, and the highest is well under 120. Item 2: a deterministic probe decides whether
tap (b) can go stale; the wait is added only if it can. Both full spec files 20/20 green (2 workers, `nice -n 19`).

**Non-Goals:** app code; other specs; assertion changes; the editor tests' principal (measured and reported, changed
only under Decision 2's rule; superseded by Decision 10's owner-approved fold-in).

## Decisions

Revised after design-gate round 1 (`skeptic-design-1.md`, REFUTE, items 1-6 plus non-blocking notes); each change
names the item it answers.

1. **Item 1 shape.** Extract the owner-side seeding of the beforeAll into one function (e.g.
   `seedBoard(owner, grantees)`) returning the dashboard id and the ids to delete. The beforeAll keeps a board for the
   editor tests and `measurer` (granted as today); each owner theme test registers its own owner (`newActor`, label
   per theme), seeds its own board with the same seven panels, and deletes what it created in `finally` (the `:290`
   test's pattern). Every owner-role call to `openStack` passes its target explicitly (`{ id, items: 7 }`); the
   default-target parameter is removed or kept only for the editor/measurer board, so no owner test can fall back to
   the module-level `dashboardId` (non-blocking note 3). Every geometry assertion and message is unchanged.
   Rejected: one owner per theme sharing one dashboard (a dashboard has one owner).
   **Run before first load (skeptic item 5).** After seeding, the owner test waits for its pipeline run to reach a
   terminal state before the first `openStack` (bounded, messaged: `${at}: seeded run finished`; poll interval at
   least 500 ms; its polls are charged to the principal and counted). The beforeAll board keeps its existing timing
   but also gets the same wait, so both boards are opened in the same state as today's.
   **Fallback shape (skeptic item 4).** Task 2.2's pre-fix counts are used to PROJECT the per-owner-test max-60s cost
   (seeding + run wait + `auth/me` + three page loads) before 2.3 is written. If the projection exceeds 50, the fix is
   one owner and board per (theme, width) instead (about seeding + one page load each), with the same assertions; the
   projection and the chosen shape are recorded in `root-cause.md`.
2. **Request counting (AC "logged"; skeptic item 3).** Count every `/api/` request the limiter charges to the test's
   principal: page-originated requests via `context.on("request")` on that principal's context (no service worker is
   active in dev and the config blocks service workers, so page traffic is complete there), plus the setup calls
   made through its `APIRequestContext`, counted in the helper that issues them (verify, by probe, whether an
   `APIRequestContext` request fires the context's `request` event, so nothing is double-counted or missed).
   `POST /api/auth/register` carries no session cookie and is not charged: it is excluded from the charged count and
   logged separately. Each request is timestamped, and the log line is
   `REQUEST-COUNT <test title> principal=<label> charged-total=<n> max-60s=<n> uncharged=<n>` (max-60s = the largest
   number of charged requests in any sliding 60 s span, an upper bound on any fixed-window count), via `console.log`
   and `testInfo.annotations`.
   Applies to every owner test, including the `:290` "owner: a status message..." test (non-blocking note 1), and to
   the editor principal (both editor tests together) and `measurer`.
   **Threshold.** "Well under" = max-60s at most 60 (half the 120 window) for every owner test, at CPU 1x AND in the
   stressed runs under CDP CPU throttle 4x (HEL-1826's slow-runner proxy), since owner spending is driven by client
   polling. The number is logged, not asserted (a geometry test must not fail on app polling growth).
   **Cross-check (one window).** Once, on a per-owner-test principal (short enough to fit one window), a temporary
   probe (committed as `.txt`) records the time of the principal's FIRST charged request, then spends
   `GET /api/auth/me` until 429 and records the remaining count and the 429's `Retry-After`. The check is accepted
   only if the window age (60 - Retry-After) matches the elapsed time since that first charged request within 2 s
   (no rollover), and then `charged count + remaining` is within 3 of 120. A rollover invalidates the run; it is
   repeated, not interpreted.
   **Editor.** The editor's two theme tests share one principal (six page loads, no seeding). If its max-60s is above
   60, that is reported to the orchestrator with the numbers, together with the same-shape fix (an editor principal
   per theme test, granted on the beforeAll board), for the orchestrator to decide; it is not changed silently.
3. **Item 1 red first (skeptic item 6).** Before the fix, on the unfixed spec: (a) Decision 2's counter applied to
   the shared `owner` (the counter is test instrumentation, not the fix), recording its max-60s across seeding and
   both owner theme tests; (b) the deterministic red: HEL-1826's burn mechanism (`t1-stress-mechanism.py.txt`
   adapted) spends the shared owner's remaining budget right before the dark owner theme test's first page load, and
   the unfixed spec fails at a named assertion. Commit the mechanism and `STRESS-ACTIVE` proof as `.txt`.
   After the fix, the analogue is an **isolation control, not a red/green pair**: the burn spends the remaining budget
   of the principal the LIGHT owner test used, right before the dark owner test's first page load, and the dark test
   stays green (it spends its own window). The non-vacuous evidence for item 1 is Decision 2's logged counts.
4. **Item 2 probe first (skeptic items 1-2).** A temporary probe spec (committed as `.txt` only,
   `t2-probe.spec.ts.txt` pattern) on the same seeded pipeline and both `SIZES.slice(0, 2)` viewports runs tap (a)'s
   sequence, opens the step sheet as tap (b) does, and logs every frame the sheet trigger's centre and the sheet
   header's children (`StepPreviewTable` header: count, caption, diff chips, disclosure). It records which request
   sets the sheet's `countText` (expected `GET .../steps/:sid/preview`, or the draft-preview stream if a draft
   preview is active; the probe names what it saw, nothing is hard-coded) and whether the sheet's fresh mount issues
   it or reuses tap (a)'s result.
   **Stale-tap evidence (HEL-1826 coordinate stand-in).** Hold that request's response, record the trigger centre,
   release it, wait for the reflow, then `page.touchscreen.tap` at the recorded point; record whether the panel
   opened and the element hit (`document.elementFromPoint`). The fixed counterpart is the same sequence with the
   coordinate taken after the chosen precondition is satisfied: the panel opens. As in HEL-1826, there is no natural
   red for the race itself (holding/releasing around a `locator.tap()` does not redden: `t2-delay-sweep*.txt`); this
   is stated in the evidence and PR.
   Outcomes:
   - **(i) Trigger moves and the stale-point tap misses, the mover being `.step-preview__count`** -> before tap (b)
     add `await expect(sheet(page).locator(".step-preview__count"), \`${theme}: sheet preview header settled\`).toBeVisible()`.
   - **(ii) Trigger moves and the stale-point tap misses, but the per-frame log shows a different late child moves it
     (diff chips / caption)** -> the bounded, messaged wait targets THAT child's arrival (or the last mover if
     several), named from the log; the count wait is added too only if the count also moves it.
   - **(iii) Trigger moves but a tap at the pre-reflow point still opens the panel** (the point is still on the
     trigger) -> no stale-tap risk: no wait is added; evidence records both centres, the trigger's box at each, and
     opened=true.
   - **(iv) Trigger never moves after it is first hit-testable (no late child, or the result is reused)** -> no wait;
     the per-frame log is the evidence.
   Outcomes (iii)/(iv) are reported plainly as "no stale-tap risk, with evidence" in `root-cause.md` and the PR.
5. **Fix rules (HEL-1826 Decision 2).** Allowed: bounded waits with messages on a real precondition, own principals.
   Not allowed: removing/loosening an assertion, widening a tolerance, retries, raising a timeout as the fix,
   `skip`/`fixme`.
6. **Mutations.** Item 1: a working-tree-only app mutation that proves the moved owner tests still guard geometry
   (e.g. revert the HEL-1791 form-card intrinsic-height rule or the HEL-1804 region collapse) reds an owner test at
   its geometry assertion; reverted, `git status --short` shows no app file (C17). Item 2, if a wait is added: the
   coordinate stand-in of Decision 4 is the stale-tap evidence (no "remove the wait under a hold" mutation, which
   cannot redden); additionally the HEL-1826 mutation (panel placed off screen) still reds at the `step sheet` cell,
   proving the cell still asserts after the change.
7. **20x.** Time one full-file run of each spec first; split batches so each Bash call ends under 600 s; 20 runs of
   each full file in a row, 2 workers, `nice -n 19`, Playwright never running two batches at once. Plus 5x of each
   file under the reproducing stress: hel1791 under CPU throttle 4x on every page (counts logged, Decision 2
   threshold) and the item-1 isolation control; hel1582 under CPU 4x (and the held-response mechanism only if a wait
   was added). The evidence records the highest owner max-60s across all runs, 1x and 4x separately.
8. **Environment.** Lane DB `helio_hel1830`, servers via `scripts/concertino/start-servers.sh` on this run's ports
   (dev 7262, backend 10169) with `ANTHROPIC_API_KEY` exported empty and
   `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1830` (`DB_USER=$USER`) in the SAME command; the same
   DATABASE_URL for Playwright and cleanup. `cd frontend && nice -n 19 npm ci` first (done by the orchestrator at
   Setup; re-run if package-lock changes). Scratch in the main checkout's `.concertino/scratch/HEL-1830/`. Binding:
   `driver-constraints.md` in this change dir.

9. **Design-gate round 2 notes (adopted as binding, `skeptic-design-2.md`).**
   - (a) A POST-fix measured owner max-60s above 60, at 1x or CPU 4x, triggers the per-(theme, width) fallback
     exactly as the pre-fix projection does; it is never just logged.
   - (b) The item-2 probe also logs, every frame, the `StepCardFocused` / `.mobile-step-sheet__content` box and the
     sheet's `scrollTop`, so a mover outside the preview header is named, not misattributed.
   - (c) Requests fulfilled by `page.route` (e.g. the `:290` test's routed `POST .../submit`) never reach the limiter:
     they are excluded from the charged count (or counted separately and labelled).
   - (d) Each per-test `finally` also deletes the seeded pipeline (and its output, if separately deletable), ordered
     so the deletes succeed; the beforeAll board's afterAll does the same.

10. **Fold-in: per-test editor principals (owner answer 2026-11-24, follow-up triage sub 1).** Measured on the
   delivered change: the shared `editor` principal (both editor theme tests) reaches max-60s 72-74 at 1x and 80 at CPU
   4x (`evaluation-1.md`, `skeptic-final-1.md`, `t4-1791-*.txt`), above Decision 2's threshold of 60.
   - Shape: each editor theme test registers its own editor principal (`newActor`, label per theme) at the start of
     the test, and the test's owner-side setup grants it `editor` on the beforeAll board (the beforeAll owner's
     `APIRequestContext`, counted against that owner, which then makes no page loads). The beforeAll no longer creates
     a shared `editor`. Cleanup: the grant goes with the board in afterAll; the editor context is closed in the test's
     `finally`.
   - If the per-theme editor projection (one theme test's measured share of 72-80, about 36-41, plus its own
     `auth/me`) or any post-fix measurement exceeds 60 at 1x or 4x, the same per-(theme, width) fallback as the owner
     tests applies (C19 extended to editors, C20).
   - Every geometry assertion and message is unchanged, including the editor-only caption check.
   - Counts: REQUEST-COUNT per editor principal, logged like the owners'. The beforeAll owner's count (seeding +
     grants) is logged too and must also be at most 60.
   - Red first (C12): the committed pre-fix measurement (72-80 shared, from the delivered runs) is the red for the
     count; additionally a deterministic red with the HEL-1826 burn mechanism spending the shared editor's remaining
     budget before the dark editor test's first page load, on the pre-fold-in spec, failing at a named assertion
     (committed `.txt` before the change). After the change the analogue is an isolation control (burn the light
     editor's principal; the dark editor test stays green).
   - Mutation: an editor-geometry mutation (e.g. hide the caption) reds an editor test at its caption assertion.
   - Verification: 20x the full hel1791 file at 1x and 5x at CPU 4x (fresh runs; earlier run counts do not
     count), plus 1 full run of the hel1582 file to show it is untouched. Highest editor and owner max-60s recorded
     at 1x and 4x separately.
11. **Discarded (owner answer, sub 2).** The hel1582 `:527` contrast-test timeout (one, untraced, host load 11-13) is
   not addressed; the PR mentions it as an untraced one-off.

## Risks

- Per-owner seeding adds a pipeline run per owner test; the run itself may lengthen the test. Measured in the 20x.
- The probe may show the sheet reuses tap (a)'s cached preview (no late count): Decision 4's second outcome.
- The editor principal may be the next shared-window risk: Decision 2 reports it with numbers. (Resolved: measured 72-80, folded in by Decision 10.)
