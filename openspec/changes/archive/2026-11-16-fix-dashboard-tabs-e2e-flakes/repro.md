# HEL-1644 repro log

Tree measured: main at d9c6585a8 (includes HEL-1681 4f729eed7 and HEL-1631 c1add2394, so it differs from the tree that failed in CI).
Servers: `start-servers.sh <WT> 7076 9983 HEL-1644`; `assert-phase.sh servers` printed PASS servers.
Every run: `DEV_PORT=7076 BACKEND_PORT=9983 nice -n 19 npx playwright test e2e/hel1575-dashboard-tabs.spec.ts <scope> --workers=2 --trace retain-on-failure --reporter=dot|line`
Load (uptime, 1-min avg) was 4-15 throughout; other lanes were running.

## Decision 0: recorded CI failure (run 38987195427, d777803c1, test B at :627)
Failing step is NOT the count poll stuck above 0 and NOT the precondition. Log text:

    Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
      at warmEntryCount (hel1575-dashboard-tabs.spec.ts:210)
      at Object.generator (hel1575-dashboard-tabs.spec.ts:634:42)   <- the post-logout expect.poll after waitForURL("/login")

So the CI failure was a test race: a full-page navigation committed after `waitForURL("/login")` resolved, destroying
the context mid-`page.evaluate`. Candidate source (NOT probe-confirmed): the 401 interceptor in `main.tsx` calls
`window.location.assign("/login")` (a hard navigation) when an in-flight request returns 401 after the session is
cleared and the SPA has not yet pushed /login. No recorded failure of test A was found.

## Decision 1/2: measurements, unmodified tree (test titles escaped for -g regex)
| step | test | scope | result |
|---|---|---|---|
| 1.2 / 2a | B logout clears the warm copy | alone x40 | 40 passed (2.6m) |
| 1.1 / 2a | A expired tab (16 minutes) | alone x40 | 40 passed (3.1m) |
| 2b | B | alone x200 | 200 passed (13.1m) |
| 2b | A | alone x200 | 200 passed (13.4m) |
| 2c | whole spec file | x10 (210 tests) | 210 passed (54.8m) |
| 2d | B | alone x100, 4x CPU throttle (CDP Emulation.setCPUThrottlingRate) | 100 passed (11.5m) |
| 2d | A | alone x100, 4x CPU throttle | 100 passed (10.9m) |

Probe-only diff for 2d: a `test.beforeEach` in the "HEL-1575 dashboard tabs" describe opening a CDP session and setting
rate 4. Reverted with `git checkout`; `git diff --stat` empty and `git status --short` shows only the untracked change dir.
Raw logs: /home/matt/Development/helio/.concertino/scratch/HEL-1644/*.log

Total: 0 failures in 690 runs of the two tests plus 210 whole-file runs.

## Outcome (design Decision 6)
Neither flake can be reproduced on current main after the full budget. No fix was made; no code changed.
- A: consistent with HEL-1681 having fixed it (1-in-8 race the ticket's 1-in-40 likely was); 0/340 failures now.
- B: the only recorded failure is a navigation-destroyed-context race at :634, not a leftover warm entry, so the
  feared privacy defect (previous session data surviving logout) is not what failed; 0/340 failures now. HEL-1631
  changed logout since. Untested candidate for a hardening: wait on a settled post-logout state before `page.evaluate`.
Escalating per Decision 6 rather than inventing a fix for an unreproduced flake.

## Owner ruling (Decision 9 / C4) follow-through

### Test A: closed
Closed as fixed by HEL-1681 (4f729eed7). Evidence: 0 failures in 340 runs on current main (x40, x200, x100 at 4x CPU
throttle) plus 10 whole-file runs. The owner dropped test A's failing-first AC. No change to test A.

### Test B: forced race
Forcing harness: `page.route("**/api/auth/logout")` fulfilling 401, i.e. the session already expired when the user
signs out. The response interceptor (`httpClient.ts`) then dispatches `auth/clearAuth` and calls `navigate("/login")`
= `window.location.assign("/login")` (`main.tsx`), a hard navigation, while the SPA's own redirect pushes /login first.
`waitForURL("/login")` resolves on the pushState; the hard navigation then commits and destroys the context.
- RED, unfixed assertion (`expect.poll(async () => (await warmEntryCount(page)) ?? 0).toBe(0)`), same error class as CI
  (`page.evaluate: Execution context was destroyed, most likely because of a navigation` at warmEntryCount):
  20 of 20 failed (`--repeat-each=20 --workers=2`). Probe spec copy: scratch/HEL-1644/spec-with-probe.ts.
- Fix (test only): `warmEntryCountAfterSignOut` maps a destroyed-context error to -1 ("not yet 0"), so the poll reads again
  in the settled document and asserts the real state; any other error still throws. No sleep, no longer timeout, no
  retry of the test (C1). Applied to the existing test B and to the forced test.
- GREEN forced: 20/20, then 40/40. Real test B alone `--repeat-each=40`: 40/40 (2.3m, load 6-9).
- Harness kept as a regression test in the spec ("logout with an already-expired session ... still clears the warm
  copy"): it is deterministic, 2.3 s per run, and forces the same hard-navigation-after-pushState mechanism through
  the logout request's own 401 (CI's trigger was a different in-flight call, see below), so the fix stays red-able.
- Whole spec file once: 22 passed. eslint (zero warnings) and prettier clean on the spec.

### Why this setup and not the ruling's literal one
The ruling said to hold an API response until after the SPA has pushed /login. That cannot navigate:
(a) the interceptor callback in `frontend/src/main.tsx:32` calls `window.location.assign` only while
`window.location.pathname !== "/login"`, so a 401 processed after the pushState is a no-op. The 401 must land before the pushState.
(b) The forced test reaches that ordering through logout's own 401. CI's trigger was most likely a sibling in-flight
request (for example the change-signal poll or a rows fetch) that got 401 after the session ended and before the
pushState, inside `awaitWarmClear`'s window of up to 1 s. The trigger differs; the mechanism is the same.
(c) Attribution evidence: `main.tsx:33` is the only programmatic hard navigation in `frontend/src` (ErrorBoundary reload
and the login/register `href` assignments are click-only); the `dev` Playwright project registers no service worker;
the interceptor and the logout thunk are identical at d777803c1. The sibling-request trigger itself is inferred, not observed.

Forced RED persisted: scratch/HEL-1644/forced-red.log (poll reverted to the unfixed form, `--repeat-each=10`: 10 failed,
`Execution context was destroyed`). Reverted afterwards; `git diff --stat` empty. The optional app-mutation probe
(dropping the warm clear from the 401 sign-out path) was not run.

### App-defect check
The hard navigation is the 401 interceptor's designed behavior (any 401 other than /api/auth/me and /api/auth/mfa), and
the warm copy was cleared in every run (count reached 0). No app defect found; no privacy leak; no app change made.
