## Context

Line numbers are against main at 1d2fa5ab1 (after HEL-1723), not the ticket's pre-HEL-1723 numbers.

- `openDashboard` (:52-74) seeds 3 output panels (`seedWorld`) plus 1 markdown panel, then waits on
  `.mobile-panel-stack` count 1 and `.mobile-panel-stack__item--output` count 3. The output count is a real-content
  anchor (the phone skeleton `MobilePanelStackSkeleton` renders `.mobile-panel-stack__item--metric` stubs, never
  `--output`), but nothing waits for the skeleton layer (`.crossfade__skeleton`) to unmount. Every refresh-button test
  starts from here.
- "Full motion ..." (:289) reads `page.locator(".mobile-panel-stack__item").first().boundingBox()` at :308. `.first()`
  can be a skeleton stub that collapses/unmounts -> `null` -> `TypeError ... reading 'x'` (the main-CI failure). This
  is the only bare stack-item box read in the file; the ticket's ":288/:289 and :307" both name it.
- "no refresh button at 1280" (:325) asserts `.mobile-panel-stack` count 0 at :332 straight after `goto`, BEFORE
  `waitForPanelGrid(page, 3)` (:333). A count-0 check before mount is satisfied by an empty page: vacuous.
- "showing the button does not move the stack's resting position" (:244) samples via
  `document.querySelectorAll(".mobile-panel-stack__item").length >= 3`, which skeleton stubs can satisfy. It samples
  the stack top, not item geometry, and is not a reported flake; it is in the sweep (D5), not assumed fixed.
- Refresh button: `DashboardRefreshLine` renders `aria-disabled` from `usePullRefreshControl().busy`, a
  `useSyncExternalStore` over `PullRefreshRegistry`. `start()` returns false with no entries or a running round; a
  round ends when every panel in it has gone refreshing -> not refreshing, on timeout (15 s), or when panels
  unregister (`register()` cleanup deletes from the round and calls `settleIfDone`).
- CI flakes at :128 (Enter -> 0 rows requests within 5 s, #1133) and :164 (tap -> `aria-disabled` never `"true"`,
  #1100, #1132). Root cause unknown. Driver hypothesis (unverified): axios 1.21.1's async `cookieStore` XSRF read delays
  each XHR in Chromium, widening some race.

## Goals / Non-Goals

Goals: every stack-item read waits out the skeleton; the 1280 count-0 check is non-vacuous and shown failable; the
:128/:164 flake is root-caused by a probe and fixed at that cause; the whole spec is green at `--repeat-each 20`,
2 workers.

Non-goals: other specs, shard weighting, refresh-control behavior changes beyond a minimal race fix.

## Decisions

### D1 - `openDashboard` waits with `waitForPanelStack(page, 4)`

Replace the `.mobile-panel-stack` count-1 / `--output` count-3 waits with `waitForPanelStack(page, 4)` (3 output + 1
markdown, live layer only, then skeleton unmounted), then keep an explicit `--output` count-3 assertion scoped to
`LIVE_STACK_ITEMS` if still useful. The executor verifies the real count is 4 on a live run before relying on it.
Why: one wait in the helper covers every refresh-button test and the Full-motion test.

### D2 - Full-motion box read scoped to the live stack

The :308 read becomes `page.locator(LIVE_STACK_ITEMS).first().boundingBox()`, after D1's wait, and asserts the box is
non-null with a clear message instead of a `!` non-null assertion. Alternative (keep the bare selector, rely on D1) was
rejected: the AC forbids a bare read, and scoping is free.

### D3 - 1280 count-0 check after a positive anchor

Move `waitForPanelGrid(page, 3)` above the `.mobile-panel-stack` count-0 check. The check is then a one-shot read
taken after the real grid exists. Failability is shown by a recorded mutation in which a `.mobile-panel-stack` really
is present at that point (for example, temporarily forcing the stack to render at 1280 in the product, or a spec
mutation that resizes to 375 after the grid wait): red with the reorder, and the same mutation green against the
pre-fix ordering only where that demonstrates vacuity. Transcripts go to evidence; the mutation is reverted.

### D4 - :128/:164 root cause first, then fix at the cause

Probe before fixing (systematic-debugging law; at most `DEBUG_ATTEMPTS` = 2 fix attempts per symptom):
1. Pull the CI artifacts/traces for the failing runs (`gh run download`; #1100, #1132, #1133 and run 44014164481) if
   traces exist, and read the network/DOM timeline around the tap/Enter.
2. Instrument a local run: log `PullRefreshRegistry` entry count, `start()` return value, round begin/end and
   register/unregister events (e.g. an `addInitScript` hook or a temporary debug build), plus rows-request timing,
   under forced delays: a delayed panels/dashboard fetch, a stretched skeleton fade, a delayed rows response, and a
   cookieStore-delayed XHR, to find which ordering yields "busy never true" / "0 requests".
3. Candidate mechanisms to confirm or rule out (none assumed): (a) the tap/Enter lands before the button is
   interactive or while the skeleton layer still owns the input region; (b) output panels remount/unregister just
   after `openDashboard` returns (e.g. a late refetch), ending the round instantly with no requests; (c) each panel's
   `refresh()` is a no-op because its initial or a background request is still in flight, so the round "succeeds"
   with zero new GETs (only the in-flight one) and settles before the busy poll; (d) axios 1.21 delay only widens
   one of these.
Fix rule: a test-side race -> fix the spec's waits (e.g. wait for the precondition the product actually needs). A
product race -> if small and obvious (a few lines in the registry/button, unit-tested), fix it with a jest test that
is red first; otherwise raise ESCALATION with the evidence. Never "fix" by lengthening timeouts alone.

### D5 - Sweep the rest of the spec

Grep the spec for `mobile-panel-stack`, `boundingBox`, `toHaveCount(0)` and `querySelectorAll` and record a verdict
per hit (FIX / SAFE with reason) in `sweep.md` in this change dir. Fix every FIX hit.

### D6 - Proof

For each fixed failure: red first under a forced repro (skeleton fade stretched via injected style on
`.crossfade__skeleton` and/or a delayed panels fetch for D1/D2; the D3 mutation; the probe's forced ordering for D4),
then green. Final: the whole spec `--repeat-each 20 --workers=2 --trace retain-on-failure` under `nice -n 19`, zero
failures; record summary, load average and `free -g`. Confirm worktree `frontend/node_modules/axios` is 1.21.1 first.

## Risks / Trade-offs

- A forced repro that reorders events differently from CI can make a fix look proven when it is not. Mitigation: the
  D4 probe must reproduce the CI symptom text (0 requests / aria-disabled never true) before a fix is accepted.
- Local machine is faster than CI; repeat-each green locally is necessary, not sufficient.

## Planner Notes

- Self-approved: test-only scope; a small product fix only if D4 proves it, else escalate.
- Ticket comments could not be read by the planner (no comment-list tool); CI occurrences come from the driver brief.

## Design-gate notes (skeptic-design-1, CONFIRM; adopted)

- D4 fallback: if neither CI traces nor a forced local ordering reproduces "0 requests" / "aria-disabled never true",
  the outcome is an ESCALATION or a recorded not-reproduced finding in `root-cause.md`, never a speculative wait.
- D4 probe order: log the `start()` return value and the register/unregister timeline first ("0 requests" points at
  `start()` never fanning out more than at a slow XHR, since `page.on("request")` fires before routing).
- D5: the :244 shift-test sampler (:254-255) gets an explicit FIX or SAFE verdict with a reason (both stacks are mounted
  during the fade, so `querySelector(".mobile-panel-stack")` may pick the skeleton). :118, :359 and :364 are recorded.
- D3: run the same mutation on the old order (green = vacuity) and the new order (red); record both transcripts.
