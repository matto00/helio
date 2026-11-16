## Standing Constraints

- [C1] No retries, no larger timeouts, no skip/fixme: a fix must remove the race, not mask it.
- [C2] Playwright workers <= 2, `nice -n 19`, `--trace retain-on-failure`; never read or print any `.env` file.
- [C3] Every Playwright run targets this lane's servers: `DEV_PORT=7076 BACKEND_PORT=9983` set explicitly on the command line, servers started by `scripts/concertino/start-servers.sh` and checked by `assert-phase.sh servers`; `repro.md` records the exact command.
- [C4] Owner ruling: test A closed as fixed by HEL-1681 (340-run record; failing-first AC dropped by the owner). Test B: forced race red, test fix, forced green plus 40/40; no red or an app defect means escalate.

### Tests

## 1. Reproduce on current main (no edits)

- [x] 1.0 Read the CI failure log for test B (`gh run view 38987195427 --log-failed`; full SHA d777803c1fbdf45f093584527ed4c052c8ad992f) and any recorded test A failure; record the error text and failing step in `repro.md` (an empty result is an error, not a finding)
- [x] 1.0a Start servers with `start-servers.sh` (7076/9983) and pass `assert-phase.sh servers`; record it
- [x] 1.1 Run test A ("an expired tab (16 minutes) refetches its panels") alone with `--repeat-each=40`; record command, pass/fail counts and load in `repro.md`
- [x] 1.2 Run test B ("logout clears the browser-stored warm copy") alone with `--repeat-each=40`; record in `repro.md`
- [x] 1.3 If either shows no failure, walk design Decision 2's budget (200 alone, whole file x10, 100 alone with 4x CPU throttle) and record each step
- [x] 1.4 If either test still cannot be made to fail, stop work on that test and escalate with the evidence (design Decision 6)

## 2. Root cause

- [x] 2.1 From a failing trace or an instrumented probe, state test A's mechanism in `repro.md` with the evidence that shows it
- [x] 2.2 Same for test B; state whether it is a test race or an app defect (previous session's data surviving logout)
- [x] 2.3 If test B's cause is in HEL-1634's caches or the fix exceeds the warm-copy clear path, escalate (Decision 7)

## 3. Fix

- [x] 3.1 Apply the minimal fix at the layer the cause lives in (test or app); verify by re-reading the mechanism
- [x] 3.2 For an app defect, add a unit or seam test; show it red with the fix reverted and green with it, recorded in `repro.md`

## 4. Verify

- [x] 4.1 Test A post-fix proof per design Decision 2 (i) 40/40 alone, (ii) zero failures re-running the exact step that first failed, (iii) forced-race red-before/green-after, or if impossible 200/200 alone; record in `repro.md`
- [x] 4.2 Test B post-fix proof, same three parts; record in `repro.md`
- [x] 4.3 The whole `e2e/hel1575-dashboard-tabs.spec.ts` passes once; lint, typecheck and affected unit tests pass

## 5. Owner ruling follow-through

- [x] 5.1 Test B: force the post-logout 401 hard navigation (fulfil `/api/auth/logout` with 401, so the interceptor's `window.location.assign` starts before the SPA's pushState; see repro.md for why the literal hold-after-push setup cannot navigate); show RED in `repro.md`, or stop and escalate
- [x] 5.2 Test B: fix the test to wait for the navigation to settle before `page.evaluate`; forced run GREEN and 40/40 alone recorded in `repro.md`
- [x] 5.3 Test A: record closure as fixed by HEL-1681 (4f729eed7) with the 340-run record and the owner ruling in `repro.md`
